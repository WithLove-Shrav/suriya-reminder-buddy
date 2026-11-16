import * as vscode from 'vscode';
import { Store, SharedState, dayKey } from './store';
import { KINDS, Intervals, ensureNextDue, resetAll, pickDue, snoozeMs, graceOverdue, isActive } from './schedule';
import { compose, react, MessageKind } from './messages';
import type { Answer, Kind, Pose, Tone } from './types';

const TICK_MS = 30_000;
const EXPIRE_MS = 10 * 60_000;
const REACTION_MS = 9_000;
const MIN = 60_000;

export interface Nudge {
  id: string;
  kind: Kind | 'welcome';
  text: string;
  pose: Pose;
  at: number;
}

export interface ViewModel {
  enabled: boolean;
  nudge?: { id: string; text: string; pose: Pose; kind: string };
  reaction?: { text: string; pose: Pose };
  ambient: string;
  ambientPose: Pose;
  yesToday: Record<Kind, number>;
  activeMinutes: number;
}

const LABEL: Record<Kind, string> = { water: '💧 water', break: '👀 eye break', stretch: '🙆 stretch', walk: '🚶 walk' };

interface Config {
  enabled: boolean;
  name: string;
  buddy: string;
  tone: Tone;
  iv: Intervals;
  idleMs: number;
  awayMs: number;
  snoozeMin: number;
  minGapMs: number;
  notify: 'whenHidden' | 'always' | 'never';
}

export class Companion implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  /** True while some other surface (sidebar or floating buddy) is already showing nudges, so toasts can be skipped. */
  hasSurface: () => boolean = () => false;

  private readonly disposables: vscode.Disposable[] = [];
  private lastActivity = Date.now();
  private lastTick = Date.now();
  private focused = vscode.window.state.focused;
  private needsReturnCheck = true;
  private current?: Nudge;
  private reaction?: { text: string; pose: Pose; until: number };
  private reactionTimer?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;

  constructor(private readonly store: Store) {}

  // ---------- configuration ----------
  private cfg(): Config {
    const c = vscode.workspace.getConfiguration('reminderCompanion');
    return {
      enabled: c.get('enabled', true),
      name: c.get('name', '').trim(),
      buddy: c.get('companionName', 'Suriya').trim() || 'Suriya',
      tone: c.get<Tone>('tone', 'cheerful'),
      iv: {
        water: c.get('waterMinutes', 45),
        break: c.get('breakMinutes', 30),
        stretch: c.get('stretchMinutes', 60),
        walk: c.get('walkMinutes', 90),
      },
      idleMs: c.get('idleMinutes', 5) * MIN,
      awayMs: c.get('awayHours', 10) * 60 * MIN,
      snoozeMin: c.get('snoozeMinutes', 10),
      minGapMs: c.get('minGapMinutes', 10) * MIN,
      notify: c.get('notify', 'whenHidden'),
    };
  }

  // ---------- lifecycle ----------
  start(): void {
    const d = this.disposables;
    d.push(
      vscode.window.onDidChangeWindowState((e) => {
        this.focused = e.focused;
        if (e.focused) this.noteActivity();
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length && (e.document.uri.scheme === 'file' || e.document.uri.scheme === 'untitled')) this.noteActivity();
      }),
      vscode.window.onDidChangeTextEditorSelection(() => this.noteActivity()),
      vscode.window.onDidChangeTextEditorVisibleRanges(() => this.noteActivity()),
      vscode.window.onDidChangeActiveTextEditor(() => this.noteActivity()),
      vscode.window.onDidOpenTerminal(() => this.noteActivity()),
      vscode.window.onDidChangeActiveTerminal(() => this.noteActivity()),
      vscode.tasks.onDidStartTask(() => this.noteActivity()),
      vscode.debug.onDidStartDebugSession(() => this.noteActivity()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('reminderCompanion')) return;
        const c = this.cfg();
        if (e.affectsConfiguration('reminderCompanion.enabled') && c.enabled) {
          // Re-enabling starts fresh rather than firing everything that went overdue while it was off.
          this.store.update((s) => resetAll(s.nextDue, c.iv, Date.now()));
        }
        this.emitter.fire();
      }),
    );
    const shell = (vscode.window as any).onDidStartTerminalShellExecution;
    if (typeof shell === 'function') d.push(shell(() => this.noteActivity()));

    this.timer = setInterval(() => this.tick(), TICK_MS);
    // Give the window a moment to settle before deciding whether to say hello.
    setTimeout(() => this.returnCheck(Date.now()), 3000);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.reactionTimer) clearTimeout(this.reactionTimer);
    this.disposables.forEach((x) => x.dispose());
    this.emitter.dispose();
  }

  // ---------- activity detection ----------
  private noteActivity(): void {
    if (!this.focused) return; // background tasks / formatters in an unfocused window aren't you
    const now = Date.now();
    const gap = now - this.lastActivity;
    if (gap < 1000) return;
    this.lastActivity = now;
    const c = this.cfg();
    if (gap >= c.idleMs) {
      this.needsReturnCheck = true;
      // You've been idle: don't hit you with every overdue reminder at once.
      this.store.update((s) => graceOverdue(s.nextDue, now));
    }
    if (this.needsReturnCheck) this.returnCheck(now);
  }

  /** Decides whether this is a first run or a return after a long absence, using the cross-window "last active" time. */
  private returnCheck(now: number): void {
    if (!this.needsReturnCheck) return;
    this.needsReturnCheck = false;
    const c = this.cfg();
    let nudge: Nudge | undefined;
    this.store.update((s) => {
      const first = s.lastActive === 0;
      const gap = now - s.lastActive;
      s.lastActive = now;
      if (!c.enabled || this.current || now - s.lastWelcomeAt < MIN) return;
      if (first) nudge = this.build('intro', s, c, now);
      else if (gap >= c.awayMs) nudge = this.build('welcome', s, c, now, gap / (60 * MIN));
      if (nudge) {
        s.lastWelcomeAt = now;
        s.lastNudgeAt = now;
        resetAll(s.nextDue, c.iv, now);
      }
    });
    if (nudge) this.present(nudge, c);
  }

  // ---------- scheduler ----------
  private tick(): void {
    const now = Date.now();
    const elapsed = Math.min(now - this.lastTick, 2 * TICK_MS);
    this.lastTick = now;
    const c = this.cfg();
    if (c.enabled && isActive(now, this.lastActivity, c.idleMs, this.focused)) {
      if (this.current && now - this.current.at > EXPIRE_MS) this.expire(c, now);
      let nudge: Nudge | undefined;
      this.store.update((s) => {
        this.rollDay(s);
        s.lastActive = now;
        s.activeMinutes += elapsed / MIN;
        ensureNextDue(s.nextDue, c.iv, now);
        if (this.current || now - s.lastNudgeAt < c.minGapMs) return;
        const kind = pickDue(s.nextDue, c.iv, now);
        if (kind) {
          nudge = this.build(kind, s, c, now);
          s.lastNudgeAt = now; // claim, so other windows hold off
        }
      });
      if (nudge) this.present(nudge, c);
    }
    this.emitter.fire(); // refresh countdown text / status bar
  }

  private rollDay(s: SharedState): void {
    const today = dayKey();
    if (s.day !== today) {
      s.day = today;
      s.yes = {};
      s.no = {};
      s.activeMinutes = 0;
    }
  }

  private build(kind: MessageKind, s: SharedState, c: Config, now: number, hoursAway?: number): Nudge {
    const m = compose(kind, {
      name: c.name,
      buddy: c.buddy,
      tone: c.tone,
      hour: new Date(now).getHours(),
      activeMinutes: s.activeMinutes,
      yesStreak: s.yesStreak,
      recent: s.recent,
      hoursAway,
    });
    s.recent = [...s.recent, m.id].slice(-8);
    return { id: `${now}-${kind}`, kind: kind === 'intro' ? 'welcome' : kind, text: m.text, pose: m.pose, at: now };
  }

  private present(n: Nudge, c: Config): void {
    this.current = n;
    this.reaction = undefined;
    this.emitter.fire();
    if (c.notify === 'always' || (c.notify === 'whenHidden' && !this.hasSurface())) {
      void vscode.window.showInformationMessage(n.text, 'Yes', 'Not now').then((choice) => {
        if (choice) this.answer(n.id, choice === 'Yes' ? 'yes' : 'no');
      });
    }
  }

  // ---------- interaction ----------
  answer(id: string, answer: Answer): void {
    const n = this.current;
    if (!n || n.id !== id) return; // stale button (e.g. an old notification)
    const c = this.cfg();
    const now = Date.now();
    let text = '';
    let pose: Pose = 'idle';
    this.store.update((s) => {
      this.rollDay(s);
      if (n.kind === 'welcome') {
        resetAll(s.nextDue, c.iv, now);
      } else if (answer === 'yes') {
        s.yes[n.kind] = (s.yes[n.kind] ?? 0) + 1;
        s.yesStreak += 1;
        s.missStreak[n.kind] = 0;
        s.nextDue[n.kind] = now + c.iv[n.kind] * MIN;
      } else {
        s.no[n.kind] = (s.no[n.kind] ?? 0) + 1;
        s.yesStreak = 0;
        s.missStreak[n.kind] = (s.missStreak[n.kind] ?? 0) + 1;
        s.nextDue[n.kind] = now + snoozeMs(c.snoozeMin, s.missStreak[n.kind], c.iv[n.kind]);
      }
      const r = react(n.kind, answer, {
        name: c.name,
        buddy: c.buddy,
        tone: c.tone,
        hour: new Date(now).getHours(),
        activeMinutes: s.activeMinutes,
        yesStreak: s.yesStreak,
        recent: s.recent,
      });
      text = r.text;
      pose = r.pose;
    });
    this.current = undefined;
    this.showReaction(text, pose);
  }

  private expire(c: Config, now: number): void {
    const n = this.current;
    this.current = undefined;
    if (!n || n.kind === 'welcome') return;
    const kind = n.kind;
    // Ignored for 10 minutes counts as "not now".
    this.store.update((s) => {
      s.missStreak[kind] = (s.missStreak[kind] ?? 0) + 1;
      s.nextDue[kind] = now + snoozeMs(c.snoozeMin, s.missStreak[kind], c.iv[kind]);
    });
  }

  private showReaction(text: string, pose: Pose): void {
    this.reaction = { text, pose, until: Date.now() + REACTION_MS };
    if (this.reactionTimer) clearTimeout(this.reactionTimer);
    this.reactionTimer = setTimeout(() => {
      this.reaction = undefined;
      this.emitter.fire();
    }, REACTION_MS);
    this.emitter.fire();
  }

  // ---------- commands ----------
  async toggle(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('reminderCompanion');
    await cfg.update('enabled', !cfg.get('enabled', true), vscode.ConfigurationTarget.Global);
  }

  /**
   * Fire a reminder right now, even if the companion is disabled or a gap hasn't elapsed. With no kind given it
   * steps through water -> break -> stretch -> walk -> water ... so repeated demos never show the same type twice in a row.
   */
  nudgeNow(kind?: Kind): void {
    const c = this.cfg();
    const now = Date.now();
    let nudge!: Nudge;
    this.store.update((s) => {
      this.rollDay(s);
      let k = kind;
      if (!k) {
        k = KINDS[s.demoNext % KINDS.length];
        s.demoNext = (s.demoNext + 1) % KINDS.length;
      }
      nudge = this.build(k, s, c, now);
      s.lastNudgeAt = now;
    });
    this.present(nudge, c);
  }

  simulateWelcomeBack(): void {
    const c = this.cfg();
    const now = Date.now();
    let nudge!: Nudge;
    this.store.update((s) => {
      nudge = this.build('welcome', s, c, now, 10.5);
    });
    this.present(nudge, c);
  }

  // ---------- view model ----------
  model(): ViewModel {
    const c = this.cfg();
    const s = this.store.read();
    const today = s.day === dayKey();
    const yes = (k: Kind) => (today ? s.yes[k] ?? 0 : 0);
    let ambient: string;
    if (!c.enabled) {
      ambient = `${c.buddy} is resting 😴 Enable me from the status bar to get nudges.`;
    } else {
      const now = Date.now();
      let next: { k: Kind; at: number } | undefined;
      for (const k of KINDS) {
        const at = s.nextDue[k];
        if (c.iv[k] > 0 && at !== undefined && (!next || at < next.at)) next = { k, at };
      }
      const who = c.name || 'friend';
      ambient = next
        ? `All good, ${who}. ${c.buddy} is watching the clock 🎸 Next up: ${LABEL[next.k]} in ${Math.max(1, Math.round((next.at - now) / MIN))} min.`
        : `Hi ${who}! All reminders are switched off in settings.`;
    }
    return {
      enabled: c.enabled,
      nudge: this.current && { id: this.current.id, text: this.current.text, pose: this.current.pose, kind: this.current.kind },
      reaction: this.reaction && { text: this.reaction.text, pose: this.reaction.pose },
      ambient,
      ambientPose: c.enabled ? 'idle' : 'sleepy',
      yesToday: { water: yes('water'), break: yes('break'), stretch: yes('stretch'), walk: yes('walk') },
      activeMinutes: today ? Math.round(s.activeMinutes) : 0,
    };
  }

  statusText(): { text: string; tooltip: string } {
    const m = this.model();
    if (!m.enabled) return { text: '$(circle-slash) Companion', tooltip: 'Companion is off. Click to enable.' };
    if (m.nudge) return { text: '$(bell) Companion', tooltip: m.nudge.text };
    return { text: '$(coffee) Companion', tooltip: `${m.ambient}\nClick to disable.` };
  }
}
