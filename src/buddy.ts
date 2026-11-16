import * as vscode from 'vscode';
import * as net from 'net';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolvePose } from './poses';
import type { ViewModel } from './companion';
import type { Answer } from './types';

const NUDGE_TTL_MS = 10 * 60_000;
const REACTION_TTL_MS = 9_000;
const RETRY_BACKOFF_MS = 30_000;

/**
 * Client for the floating desktop buddy (a small native macOS helper). Every IDE window connects to one shared
 * helper over a unix socket; whichever window needs it first launches it. If the helper can't run (other OS,
 * missing binary, launch failure) everything falls back to notifications + the sidebar.
 */
export class Buddy implements vscode.Disposable {
  private sock?: net.Socket;
  private connecting?: Promise<boolean>;
  private lastKey = '';
  private shownByMe = false;
  private lastFailure = 0;
  private buf = '';
  private readonly sockPath = `/tmp/rc-buddy-${os.userInfo().uid}.sock`; // short path: unix sockets cap at ~104 chars

  constructor(
    private readonly root: string,
    private readonly onAnswer: (id: string, answer: Answer) => void,
  ) {}

  private get binary(): string {
    return path.join(this.root, 'buddy', 'companion-buddy');
  }

  get supported(): boolean {
    return process.platform === 'darwin' && fs.existsSync(this.binary);
  }

  get connected(): boolean {
    return !!this.sock && !this.sock.destroyed;
  }

  private tryConnect(): Promise<net.Socket | undefined> {
    return new Promise((resolve) => {
      const s = net.connect(this.sockPath);
      s.once('connect', () => resolve(s));
      s.once('error', () => resolve(undefined));
    });
  }

  /** Connects to the running helper, launching it first if needed. */
  ensure(): Promise<boolean> {
    if (this.connected) return Promise.resolve(true);
    if (!this.supported) return Promise.resolve(false);
    if (Date.now() - this.lastFailure < RETRY_BACKOFF_MS) return Promise.resolve(false);
    this.connecting ??= this.connect().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private async connect(): Promise<boolean> {
    let s = await this.tryConnect();
    if (!s) {
      try {
        fs.chmodSync(this.binary, 0o755); // the packaged file may have lost its executable bit
        const child = cp.spawn(this.binary, ['--socket', this.sockPath, '--root', this.root], { detached: true, stdio: 'ignore' });
        child.on('error', () => {});
        child.unref();
      } catch {
        this.lastFailure = Date.now();
        return false;
      }
      for (let i = 0; i < 25 && !s; i++) {
        await new Promise((r) => setTimeout(r, 150));
        s = await this.tryConnect();
      }
    }
    if (!s) {
      this.lastFailure = Date.now();
      return false;
    }
    s.setEncoding('utf8');
    s.on('data', (chunk: string) => this.onData(chunk));
    s.on('close', () => {
      if (this.sock === s) this.sock = undefined;
      this.lastKey = ''; // re-send the current state after a reconnect
    });
    s.on('error', () => {});
    this.sock = s;
    return true;
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      try {
        const m = JSON.parse(line);
        if (m.type === 'answer' && (m.answer === 'yes' || m.answer === 'no')) this.onAnswer(String(m.id), m.answer);
      } catch {
        /* ignore malformed lines */
      }
    }
  }

  private send(obj: unknown): void {
    if (this.connected) this.sock!.write(JSON.stringify(obj) + '\n');
  }

  /** Mirror the companion's current state onto the floating window. Only sends on change. */
  async sync(m: ViewModel): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('reminderCompanion');
    if (!cfg.get('floatingBuddy', true)) {
      if (this.shownByMe) this.hide();
      return;
    }
    const corner = cfg.get<string>('buddyCorner', 'bottom-right');
    const assets = path.join(this.root, 'assets');
    const want = m.nudge
      ? { id: m.nudge.id, text: m.nudge.text, ask: true, ...resolvePose(assets, m.nudge.pose), ttl: NUDGE_TTL_MS }
      : m.reaction
        ? { id: 'reaction', text: m.reaction.text, ask: false, ...resolvePose(assets, m.reaction.pose), ttl: REACTION_TTL_MS }
        : undefined;
    const key = want ? JSON.stringify([want, corner]) : '';
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (!want) {
      // Only take down a bubble this window put up; another window may own the current one.
      if (this.shownByMe) this.hide();
      return;
    }
    if (!(await this.ensure())) {
      this.lastKey = '';
      return;
    }
    this.send({ type: 'show', corner, ...want });
    this.shownByMe = true;
  }

  private hide(): void {
    this.shownByMe = false;
    this.send({ type: 'hide' });
  }

  dispose(): void {
    if (this.shownByMe) this.hide();
    this.sock?.destroy();
  }
}
