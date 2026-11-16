import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
// @ts-ignore - resolved to the bundled engine by tests/build.js
import { Companion, Store, fake } from '../.test-build/engine.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
let now = new Date('2026-11-16T10:00:00').getTime();
const realNow = Date.now;
Date.now = () => now;
const advance = (ms: number) => (now += ms);

function setup() {
  for (const k of Object.keys(fake.config)) delete fake.config[k];
  fake.shown.length = 0;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-')), 'state.json');
  const store = new Store(file);
  const c = new Companion(store);
  c.start();
  return { c, store, file };
}
const tick = (c: any) => c.tick();
const act = (c: any) => c.noteActivity();

test.after(() => {
  Date.now = realNow;
});

test('first run shows an intro; answering yes reacts with a happy pose', () => {
  const { c, store } = setup();
  c.returnCheck(now);
  assert.equal(c.model().nudge?.pose, 'wave');
  assert.match(c.model().nudge.text, /I'm Suriya/);
  assert.doesNotMatch(c.model().nudge.text, /aaganum/, 'no Tamil in the intro');
  c.answer(c.model().nudge.id, 'yes');
  assert.equal(c.model().nudge, undefined);
  assert.equal(c.model().reaction.pose, 'happy');
  assert.ok(store.read().lastActive > 0);
  c.dispose();
});

test('water reminder fires when due, only while active, and respects min gap', () => {
  const { c, store } = setup();
  c.returnCheck(now); c.answer(c.model().nudge.id, 'yes'); // intro done
  advance(46 * MIN); // water (45) is due, break (30) is overdue too
  tick(c);
  assert.equal(c.model().nudge, undefined, 'idle (no activity for 46 min) => no nudge');
  act(c); // back from idle
  advance(4 * MIN); act(c); tick(c); // grace pushed overdue items 1-3 min out; 4 min later they're due (and 4 < the 5 min idle limit)
  const first = c.model().nudge;
  assert.ok(first, 'a nudge fires once active again');
  c.answer(first.id, 'yes');
  advance(MIN); act(c); tick(c);
  assert.equal(c.model().nudge, undefined, 'min gap (10 min) blocks an immediate second nudge');
  c.dispose();
});

test('"Not now" snoozes; consecutive misses snooze longer', () => {
  const { c, store } = setup();
  c.returnCheck(now); c.answer(c.model().nudge.id, 'yes');
  c.nudgeNow('water');
  const t0 = now;
  c.answer(c.model().nudge.id, 'no');
  assert.equal(c.model().reaction.pose, 'sleepy');
  assert.equal(store.read().nextDue.water - t0, 10 * MIN);
  c.nudgeNow('water'); c.answer(c.model().nudge.id, 'no');
  assert.equal(store.read().nextDue.water - now, 15 * MIN);
  c.dispose();
});

test('welcome-back after 10h away, not after 9h; shared across windows via the state file', () => {
  const { c, store, file } = setup();
  c.returnCheck(now); c.answer(c.model().nudge.id, 'yes');
  c.dispose();
  advance(9 * HOUR);
  const w2 = new Companion(new Store(file)); w2.start();
  w2.returnCheck(now);
  assert.equal(w2.model().nudge, undefined, '9h < 10h threshold');
  w2.dispose();
  advance(10 * HOUR + MIN);
  const w3 = new Companion(new Store(file)); w3.start();
  w3.needsReturnCheck = true; w3.returnCheck(now);
  assert.match(w3.model().nudge.text, /hours/);
  assert.equal(w3.model().nudge.kind, 'welcome');
  w3.dispose();
});

test('disabled companion does not auto-nudge, but "nudge me now" still works', () => {
  const { c } = setup();
  fake.config.enabled = false;
  c.returnCheck(now);
  advance(2 * HOUR); act(c); tick(c);
  assert.equal(c.model().nudge, undefined);
  assert.match(c.model().ambient, /resting/);
  c.nudgeNow('stretch');
  assert.ok(c.model().nudge);
  c.dispose();
});

test('stale answers (old notification buttons) are ignored', () => {
  const { c } = setup();
  c.nudgeNow('water');
  const old = c.model().nudge.id;
  advance(5);
  c.nudgeNow('walk');
  c.answer(old, 'yes');
  assert.ok(c.model().nudge, 'current nudge still pending');
  assert.equal(c.model().yesToday.water, 0);
  c.dispose();
});

test('ignored for 10 minutes counts as a miss and clears the pending nudge', () => {
  const { c, store } = setup();
  c.returnCheck(now); c.answer(c.model().nudge.id, 'yes');
  c.nudgeNow('water');
  advance(11 * MIN); act(c); tick(c);
  assert.equal(c.model().nudge, undefined);
  assert.equal(store.read().missStreak.water, 1);
  c.dispose();
});

test('unfocused window ignores activity and does not nudge', () => {
  const { c } = setup();
  c.returnCheck(now); c.answer(c.model().nudge.id, 'yes');
  fake.window.state.focused = false; c.focused = false;
  advance(2 * HOUR); act(c); tick(c);
  assert.equal(c.model().nudge, undefined);
  fake.window.state.focused = true;
  c.dispose();
});

test('"Nudge Me Now" rotates through the reminder types and never repeats one back-to-back', () => {
  const { c } = setup();
  const seen: string[] = [];
  for (let i = 0; i < 9; i++) { c.nudgeNow(); seen.push(c.model().nudge.kind); }
  assert.deepEqual(seen, ['water', 'break', 'stretch', 'walk', 'water', 'break', 'stretch', 'walk', 'water']);
  c.nudgeNow('walk'); // picking a type explicitly doesn't disturb the rotation
  c.nudgeNow();
  assert.equal(c.model().nudge.kind, 'break');
  c.dispose();
});
