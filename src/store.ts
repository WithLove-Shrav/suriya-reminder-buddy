import * as fs from 'fs';
import * as path from 'path';
import type { NextDue } from './schedule';

/**
 * State shared by every Antigravity window. Lives in a JSON file in the extension's global storage
 * (one per user, not per workspace) so that all windows see the same timers and the same "last active" time.
 */
export interface SharedState {
  lastActive: number; // 0 = never seen (first run)
  lastNudgeAt: number;
  lastWelcomeAt: number;
  nextDue: NextDue;
  day: string;
  yes: Record<string, number>; // per kind, today
  no: Record<string, number>;
  activeMinutes: number; // today
  missStreak: Record<string, number>;
  yesStreak: number;
  recent: string[];
  /** Which reminder type "Nudge Me Now" shows next (rotates through all of them). */
  demoNext: number;
}

export const emptyState = (): SharedState => ({
  lastActive: 0,
  lastNudgeAt: 0,
  lastWelcomeAt: 0,
  nextDue: {},
  day: '',
  yes: {},
  no: {},
  activeMinutes: 0,
  missStreak: {},
  yesStreak: 0,
  recent: [],
  demoNext: 0,
});

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export class Store {
  constructor(private readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  read(): SharedState {
    try {
      return { ...emptyState(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      return emptyState();
    }
  }

  /** Read-modify-write. Writes atomically (temp file + rename) so another window never reads a half-written file. */
  update(fn: (s: SharedState) => void): SharedState {
    const s = this.read();
    fn(s);
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(s));
      fs.renameSync(tmp, this.file);
    } catch {
      // Storage problems must never break the editor; the in-memory result is still returned.
    }
    return s;
  }
}
