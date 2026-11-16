import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as net from 'node:net';
import * as cp from 'node:child_process';
import * as path from 'node:path';
// @ts-ignore - resolved to the bundled engine by tests/build.js
import { Buddy } from '../.test-build/engine.js';

const root = path.resolve(import.meta.dirname, '..');
const binary = path.join(root, 'buddy', 'companion-buddy');
const sockPath = `/tmp/rc-buddy-${os.userInfo().uid}.sock`;
const skip = process.platform !== 'darwin' || !fs.existsSync(binary) ? 'needs macOS and the built helper' : false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const nudge = { enabled: true, ambient: '', ambientPose: 'idle', yesToday: {}, activeMinutes: 0,
  nudge: { id: 'n1', text: 'Water time?', pose: 'water', kind: 'water' } } as any;
const reaction = { ...nudge, nudge: undefined, reaction: { text: 'Nice!', pose: 'happy' } } as any;
const empty = { ...nudge, nudge: undefined } as any;

function visibleBuddyWindows(): number {
  const swift = `import Cocoa
let l = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
print(l.filter { ($0[kCGWindowOwnerName as String] as? String ?? "").contains("companion-buddy") && ($0[kCGWindowLayer as String] as? Int) == 3 && ($0[kCGWindowAlpha as String] as? Double ?? 0) > 0.5 }.count)`;
  const f = path.join(os.tmpdir(), `rc-wins-${process.pid}.swift`);
  fs.writeFileSync(f, swift);
  try { return Number(cp.execFileSync('swift', [f], { encoding: 'utf8' }).trim()); } finally { fs.rmSync(f, { force: true }); }
}

test('two windows share one launched-on-demand helper; answers reach the owner; hide works', { skip }, async () => {
  const answers: string[][] = [[], []];
  const a = new Buddy(root, (id: string, ans: string) => answers[0].push(`${id}:${ans}`));
  const b = new Buddy(root, (id: string, ans: string) => answers[1].push(`${id}:${ans}`));
  try {
    assert.equal(await a.ensure(), true, 'window A launches and connects');
    assert.equal(await b.ensure(), true, 'window B connects to the same helper');
    const procs = cp.execSync('pgrep -x companion-buddy || true', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    assert.equal(procs.length, 1, 'only one helper process');

    await a.sync(nudge);
    await sleep(1200);
    assert.equal(visibleBuddyWindows(), 1, 'bubble is on screen');

    // press the "Yes" button inside the helper (self-test hook), as a click would
    const s = net.connect(sockPath);
    await new Promise((r) => s.once('connect', r));
    s.write(JSON.stringify({ type: 'selftest', answer: 'yes' }) + '\n');
    await sleep(600);
    s.destroy();
    assert.deepEqual(answers[0], ['n1:yes']);
    assert.deepEqual(answers[1], ['n1:yes'], 'every window hears the answer; the companion ignores ids it does not own');

    await a.sync(reaction);
    await sleep(500);
    assert.equal(visibleBuddyWindows(), 1, 'reaction replaces the question');
    await a.sync(empty);
    await b.sync(empty); // B never showed anything, so it must not hide A's bubble
    await sleep(900);
    assert.equal(visibleBuddyWindows(), 0, 'hidden after A clears');
  } finally {
    const s = net.connect(sockPath);
    s.on('error', () => {});
    await new Promise((r) => { s.once('connect', r); s.once('error', r); });
    s.write(JSON.stringify({ type: 'quit' }) + '\n');
    await sleep(300);
    a.dispose(); b.dispose();
  }
});

test('a window that never showed a bubble does not hide another window\'s bubble', { skip }, async () => {
  const a = new Buddy(root, () => {});
  const b = new Buddy(root, () => {});
  try {
    await a.sync(nudge);
    await b.ensure();
    await b.sync(empty);
    await sleep(900);
    assert.equal(visibleBuddyWindows(), 1);
  } finally {
    const s = net.connect(sockPath);
    s.on('error', () => {});
    await new Promise((r) => { s.once('connect', r); s.once('error', r); });
    s.write(JSON.stringify({ type: 'quit' }) + '\n');
    await sleep(300);
    a.dispose(); b.dispose();
  }
});
