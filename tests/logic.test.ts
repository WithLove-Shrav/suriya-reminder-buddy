import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureNextDue, pickDue, snoozeMs, graceOverdue, isActive, resetAll } from '../src/schedule.ts';
import { compose, react, timeOfDay, BANK } from '../src/messages.ts';

const iv = { water: 45, break: 30, stretch: 60, walk: 0 };
const T = 1_000_000_000_000;

test('ensureNextDue fills enabled kinds, drops disabled, clamps shortened intervals', () => {
  const nd: any = { walk: 5, water: T + 999 * 60_000 };
  ensureNextDue(nd, iv, T);
  assert.equal(nd.walk, undefined);
  assert.equal(nd.break, T + 30 * 60_000);
  assert.equal(nd.water, T + 45 * 60_000);
});

test('pickDue returns the most overdue kind, undefined when none due', () => {
  assert.equal(pickDue({ water: T + 1, break: T + 1 }, iv, T), undefined);
  assert.equal(pickDue({ water: T - 1000, break: T - 5000 }, iv, T), 'break');
  assert.equal(pickDue({ walk: T - 1000 }, iv, T), undefined); // disabled
});

test('snooze grows with misses but never exceeds the interval', () => {
  assert.equal(snoozeMs(10, 1, 45), 10 * 60_000);
  assert.equal(snoozeMs(10, 3, 45), 20 * 60_000);
  assert.equal(snoozeMs(10, 50, 45), 45 * 60_000);
});

test('graceOverdue re-staggers only overdue entries to 1-3 minutes out', () => {
  const nd: any = { water: T - 10, break: T + 99 };
  graceOverdue(nd, T, () => 0.5);
  assert.equal(nd.water, T + 120_000);
  assert.equal(nd.break, T + 99);
});

test('resetAll pushes everything a full interval out', () => {
  const nd: any = { water: T - 10 };
  resetAll(nd, iv, T);
  assert.equal(nd.water, T + 45 * 60_000);
});

test('isActive needs focus and recent activity', () => {
  assert.equal(isActive(T, T - 1000, 300_000, true), true);
  assert.equal(isActive(T, T - 1000, 300_000, false), false);
  assert.equal(isActive(T, T - 400_000, 300_000, true), false);
});

const ctx = { name: 'Sam', tone: 'cheerful' as const, hour: 10, activeMinutes: 0, yesStreak: 0, recent: [] as string[] };

test('compose fills tokens and respects tone / time-of-day / minActive', () => {
  for (let i = 0; i < 200; i++) {
    const m = compose('water', ctx);
    assert.ok(!m.text.includes('{'), m.text);
    assert.ok(!['w5', 'w6'].includes(m.id), 'calm-only messages must not appear in cheerful tone');
    assert.notEqual(m.id, 'w8'); // afternoon-only (it is 10am here)
    assert.notEqual(m.id, 'w10'); // needs 90 active minutes
  }
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) seen.add(compose('water', { ...ctx, activeMinutes: 150 }).id);
  assert.ok(seen.has('w10'));
});

test('compose avoids recently shown messages', () => {
  const all = new Set<string>();
  for (let i = 0; i < 400; i++) all.add(compose('water', ctx).id);
  const ids = [...all];
  assert.ok(ids.length >= 5, 'a healthy variety is eligible');
  const keep = ids[0];
  const recent = ids.slice(1);
  for (let i = 0; i < 100; i++) assert.equal(compose('water', { ...ctx, recent }).id, keep);
  // when everything eligible was shown recently it still returns something rather than failing
  assert.ok(compose('water', { ...ctx, recent: ids }).text.length > 0);
});

test('every kind has enough variety in both tones, no unfilled tokens, and Suriya speaks', () => {
  for (const kind of ['water', 'break', 'stretch', 'walk'] as const) {
    for (const tone of ['cheerful', 'calm'] as const) {
      const seen = new Set<string>();
      for (let i = 0; i < 400; i++) {
        const m = compose(kind, { ...ctx, tone, activeMinutes: 200 });
        assert.ok(!/[{}]/.test(m.text), m.text);
        seen.add(m.id);
      }
      assert.ok(seen.size >= 5, `${kind}/${tone} has ${seen.size} messages`);
    }
  }
});

test('the signature line is used for screen breaks, with name and buddy filled in', () => {
  const m = compose('break', { ...ctx, name: 'Shravya', buddy: 'Suriya', recent: ['b2','b3','b4','b5','b6','b7','b8','b9'] }, () => 0.99);
  assert.equal(m.text, "Hi Shravya, I'm Suriya. Na unta soliye aaganum, nee romba nerama screen paakura. 👀 Take a break?");
});

test('welcome uses hoursAway and time of day', () => {
  const m = compose('welcome', { ...ctx, hour: 8, hoursAway: 10.4 }, () => 0);
  assert.match(m.text, /Good morning, Sam/);
  assert.match(m.text, /10\.5 hours/);
  assert.equal(m.pose, 'wave');
});

test('react: streak milestone and poses', () => {
  const y = react('water', 'yes', { ...ctx, yesStreak: 3 });
  assert.equal(y.pose, 'happy');
  assert.match(y.text, /3 in a row/);
  assert.equal(react('water', 'no', ctx).pose, 'sleepy');
});

test('timeOfDay boundaries', () => {
  assert.equal(timeOfDay(4), 'night');
  assert.equal(timeOfDay(5), 'morning');
  assert.equal(timeOfDay(12), 'afternoon');
  assert.equal(timeOfDay(17), 'evening');
  assert.equal(timeOfDay(21), 'night');
});

// Anything that reads as Tamil/Tanglish rather than English.
const TAMIL = /\b(konjam|thanni|kudi|udambu|romba|mukkiyam|nadandhu|varalaama|aaganum|aachu|semma|seri|naan|inga|nerama|paakura|vera level)\b/i;

test('language rules: one Tamil message per task, catchphrase for screen break only, welcome/intro/reactions all English', () => {
  const tamilIds = (k: keyof typeof BANK) => BANK[k].filter((m) => TAMIL.test(m.t)).map((m) => m.id);
  assert.deepEqual(tamilIds('water'), ['w4']);
  assert.deepEqual(tamilIds('break'), ['b1']);
  assert.deepEqual(tamilIds('stretch'), ['s5']);
  assert.deepEqual(tamilIds('walk'), ['k2']);
  assert.deepEqual(tamilIds('welcome'), []);
  assert.deepEqual(tamilIds('intro'), []);
  const catchphrase = Object.values(BANK).flat().filter((m) => /aaganum/i.test(m.t)).map((m) => m.id);
  assert.deepEqual(catchphrase, ['b1']);
  for (const kind of ['water', 'break', 'stretch', 'walk', 'welcome', 'intro'] as const) {
    for (const answer of ['yes', 'no'] as const) {
      for (const tone of ['cheerful', 'calm'] as const) {
        for (let i = 0; i < 60; i++) assert.doesNotMatch(react(kind, answer, { ...ctx, tone, yesStreak: [0, 3, 5, 10][i % 4] }).text, TAMIL);
      }
    }
  }
});
