import * as fs from 'fs';
import * as path from 'path';
import type { Pose } from './types';

export const POSES: Pose[] = ['idle', 'wave', 'water', 'stretch', 'happy', 'sleepy'];

/** If an image for a pose isn't there yet, reuse another one and add a CSS effect instead. */
const FALLBACK: Partial<Record<Pose, { use: Pose; fx: string }>> = {
  happy: { use: 'wave', fx: 'bounce' },
  sleepy: { use: 'idle', fx: 'dim' },
};

/** Which image file to show for a pose (without extension), plus an optional CSS effect class. */
export function resolvePose(assetsDir: string, pose: Pose): { use: Pose; fx: string } {
  const has = (p: Pose) => fs.existsSync(path.join(assetsDir, `${p}.png`));
  if (has(pose)) return { use: pose, fx: '' };
  const fb = FALLBACK[pose];
  return { use: fb && has(fb.use) ? fb.use : 'idle', fx: fb?.fx ?? '' };
}
