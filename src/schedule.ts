import type { Kind } from './types.ts';

export const KINDS: Kind[] = ['water', 'break', 'stretch', 'walk'];
/** Minutes between reminders per kind; 0 disables that kind. */
export type Intervals = Record<Kind, number>;
export type NextDue = Partial<Record<Kind, number>>;

const MIN = 60_000;

/** Fill in missing due times, drop disabled kinds, and clamp to the current interval (so shortening it takes effect). */
export function ensureNextDue(nextDue: NextDue, iv: Intervals, now: number): void {
  for (const k of KINDS) {
    if (iv[k] <= 0) {
      delete nextDue[k];
      continue;
    }
    const latest = now + iv[k] * MIN;
    const cur = nextDue[k];
    if (cur === undefined || cur > latest) nextDue[k] = latest;
  }
}

export function resetAll(nextDue: NextDue, iv: Intervals, now: number): void {
  for (const k of KINDS) delete nextDue[k];
  ensureNextDue(nextDue, iv, now);
}

/** The most overdue reminder that is due now, if any. */
export function pickDue(nextDue: NextDue, iv: Intervals, now: number): Kind | undefined {
  let best: Kind | undefined;
  let bestOverdue = -1;
  for (const k of KINDS) {
    const due = nextDue[k];
    if (iv[k] <= 0 || due === undefined || due > now) continue;
    const overdue = now - due;
    if (overdue > bestOverdue) {
      best = k;
      bestOverdue = overdue;
    }
  }
  return best;
}

/** Snooze length after a "Not now". Grows gently with consecutive misses, never beyond the reminder's own interval. */
export function snoozeMs(snoozeMinutes: number, misses: number, intervalMinutes: number): number {
  const factor = 1 + Math.max(0, misses - 1) * 0.5;
  return Math.min(snoozeMinutes * factor, Math.max(intervalMinutes, snoozeMinutes)) * MIN;
}

/** After coming back from idle, don't dump overdue reminders at once: re-stagger them 1-3 minutes out. */
export function graceOverdue(nextDue: NextDue, now: number, rnd: () => number = Math.random): void {
  for (const k of KINDS) {
    const due = nextDue[k];
    if (due !== undefined && due <= now) nextDue[k] = now + (60 + rnd() * 120) * 1000;
  }
}

export function isActive(now: number, lastActivity: number, idleMs: number, focused: boolean): boolean {
  return focused && now - lastActivity < idleMs;
}
