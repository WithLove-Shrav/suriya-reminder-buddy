import type { Answer, Kind, Pose, Tone } from './types.ts';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
export type MessageKind = Kind | 'welcome' | 'intro';

export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

interface Tpl {
  id: string;
  t: string;
  tone?: Tone;
  when?: TimeOfDay[];
  /** Only when at least this many active minutes today. */
  minActive?: number;
}

export interface Ctx {
  name: string;
  /** The character's own name (Suriya). */
  buddy?: string;
  tone: Tone;
  hour: number;
  activeMinutes: number;
  yesStreak: number;
  recent: string[];
  hoursAway?: number;
}

export interface Composed {
  id: string;
  text: string;
  pose: Pose;
}

// Suriya's voice: warm, a little cheeky, guitar jokes. Language rules:
//  - every reminder type has exactly ONE Tamil ("Tanglish") message; everything else is English
//  - the catchphrase ("Na unta soliye aaganum ...") is used for the screen break only
//  - welcome / intro messages and all reactions are English
export const BANK: Record<MessageKind, Tpl[]> = {
  water: [
    { id: 'w1', t: 'Hey {name}! 💧 Time for a water break?', tone: 'cheerful' },
    { id: 'w2', t: 'Even rockstars hydrate, {name}. 🎸💧 Sip time?', tone: 'cheerful' },
    { id: 'w3', t: 'My guitar needs tuning, you need water. Fair deal? 💧', tone: 'cheerful' },
    { id: 'w4', t: 'Konjam thanni kudi, {name}. Your future self says thanks. 💧' }, // the Tamil one
    { id: 'w5', t: 'A quiet little reminder: one glass of water keeps the focus flowing. 💧', tone: 'calm' },
    { id: 'w6', t: 'A quick sip? Your future self will thank you. 💧', tone: 'calm' },
    { id: 'w7', t: 'Good morning {name}! ☀️ Start the day with a glass of water?', when: ['morning'] },
    { id: 'w8', t: 'Afternoon slump? Water beats a third coffee. ☕➡️💧', when: ['afternoon'] },
    { id: 'w9', t: 'Evening check, {name}: have you had enough water today? 💧', when: ['evening', 'night'] },
    { id: 'w10', t: '{hours}h at the keyboard today! Time for some water? 💧 {buddy} says so.', minActive: 90 },
    { id: 'w11', t: 'Psst… {name}. Is your water bottle nearby? A sip, maybe? 💧' },
  ],
  break: [
    // the catchphrase, screen break only (also the Tamil message for this type)
    { id: 'b1', t: "Hi {name}, I'm {buddy}. Na unta soliye aaganum, nee romba nerama screen paakura. 👀 Take a break?" },
    { id: 'b2', t: 'Eyes need a breather, {name}! 👀 Look 20 feet away for 20 seconds?', tone: 'cheerful' },
    { id: 'b3', t: 'Blink blink! 👀 Your eyes are doing overtime. A little rest?', tone: 'cheerful' },
    { id: 'b4', t: 'A gentle pause for your eyes. Look far away, blink slowly. 👀 Okay?', tone: 'calm' },
    { id: 'b5', t: 'Look away from the screen and gaze out of the window. 20 seconds only! 👀 Done?' },
    { id: 'b6', t: '{hours}h of screen time today. Give your eyes a mini vacation? 👀', minActive: 90 },
    { id: 'b7', t: "It's getting late, {name}. 🌙 Tired eyes? Quick screen break?", when: ['night'] },
    { id: 'b8', t: 'Rest your eyes for a moment, {name}. Look somewhere far, somewhere green. 🌿', tone: 'calm' },
    { id: 'b9', t: '20-20-20 time! 20 seconds, 20 feet, and a break from that screen. 👀' },
  ],
  stretch: [
    { id: 's1', t: 'Stand up, shake it out, guitar-solo style! 🎸 Stretch break?', tone: 'cheerful' },
    { id: 's2', t: 'Time to unfold! 🙆 Roll your shoulders and reach for the ceiling?', tone: 'cheerful' },
    { id: 's3', t: 'Your neck is calling, {name}. Stretch break? 🙆' },
    { id: 's4', t: 'Shoulders back, deep breath, slow stretch. Ready when you are. 🙆', tone: 'calm' },
    { id: 's5', t: 'Udambu romba mukkiyam, {name}. A tiny stretch, please? 🙆' }, // the Tamil one
    { id: 's6', t: '{hours}h of sitting today! Time to unfold. Quick stretch? 🙆', minActive: 120 },
    { id: 's7', t: 'Morning stretch? Say good morning to your body too. ☀️', when: ['morning'] },
  ],
  walk: [
    { id: 'k1', t: 'A short walk means fresh ideas. 🚶 Take a 5-minute stroll?', tone: 'cheerful' },
    { id: 'k2', t: 'A short walk, fresh ideas! Konjam nadandhu varalaama? 🚶' }, // the Tamil one
    { id: 'k3', t: 'Stuck? Walks are the best debuggers. Take a little stroll?' },
    { id: 'k4', t: 'A slow walk can untangle a stubborn problem. Shall we?', tone: 'calm' },
    { id: 'k5', t: '{hours}h in today. A walk would do wonders, {name}. Go now? 🚶', minActive: 150 },
    { id: 'k6', t: 'Golden-hour walk? 🌇 Stretch your legs a bit.', when: ['evening'] },
    { id: 'k7', t: 'Step away from the screen, {name}. A small walk can spark a big idea! 🚶' },
    { id: 'k8', t: 'Walk break! 🎶 Put on your favourite song and take a stroll.', tone: 'cheerful' },
  ],
  welcome: [
    { id: 'h1', t: 'Good morning, {name}! ☀️ About {hours} hours since we last spoke. Slept well? Ready to start the day?', when: ['morning'] },
    { id: 'h2', t: 'Welcome back, {name}! 👋 You were away for about {hours} hours — I missed you! Ready to dive in?', when: ['afternoon'] },
    { id: 'h3', t: 'Hey {name}, good to see you this evening! 🌆 {hours} hours since we last spoke. Ready to get going?', when: ['evening'] },
    { id: 'h4', t: "Burning the midnight oil, {name}? 🌙 It's been {hours} hours. Ready?", when: ['night'] },
    { id: 'h5', t: "Look who's back! 🎸 {hours} hours away — I kept your seat warm, {name}. Ready?" },
  ],
  intro: [
    { id: 'i1', t: "Hi {name}, I'm {buddy}! 🎸 I'll remind you to drink water, rest your eyes, stretch and walk. Shall we start?" },
  ],
};

const YES: Record<MessageKind, string[]> = {
  water: ["That's the spirit, {name}! 💧 Gulp counted.", 'Hydration +1. Nice one! 💦', 'Ahh, refreshing! 💦 Proud of you.'],
  break: ['Eyes recharged! 👀 Nicely done!', 'Fresh eyes, fresh code. Well done, {name}!'],
  stretch: ['Ahh, that feels better, right? 🙆', 'Loose as a guitar string! 🎸'],
  walk: ['Fresh air achieved! 🚶 Nice one!', 'Ideas love a good walk.'],
  welcome: ["Let's go, {name}! 🎸 I'll be right here if you need me.", "Let's make today count! 🎸"],
  intro: ["Great! 🎸 I'll check in now and then."],
};

const NO: string[] = [
  "No worries — I'll check back in a bit.",
  "Okay, later then. I'll be right here. 🎸",
  "Fair enough. I'll remind you again soon. 😉",
];
const NO_CALM: string[] = ['No pressure. Whenever you are ready.', 'That is fine. Take your time.'];
const NO_WELCOME = ["Take your time, {name}. I'll be here whenever you're ready."];

const STREAKS: Record<number, string> = {
  3: '3 in a row! 🔥',
  5: '5 in a row — you are on a roll! 🔥',
  10: '10 in a row! Wellness legend. 🏆',
};

const POSE: Record<MessageKind, Pose> = {
  water: 'water',
  break: 'idle',
  stretch: 'stretch',
  walk: 'stretch',
  welcome: 'wave',
  intro: 'wave',
};

function fmtHours(x: number): string {
  const r = Math.round(x * 2) / 2;
  return String(r < 1 ? 1 : r);
}

function fill(t: string, ctx: Ctx): string {
  const hours = ctx.hoursAway !== undefined ? fmtHours(ctx.hoursAway) : fmtHours(ctx.activeMinutes / 60);
  return t
    .replaceAll('{name}', ctx.name || 'friend')
    .replaceAll('{buddy}', ctx.buddy || 'Suriya')
    .replaceAll('{hours}', hours);
}

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))];
}

export function compose(kind: MessageKind, ctx: Ctx, rnd: () => number = Math.random): Composed {
  const tod = timeOfDay(ctx.hour);
  const eligible = BANK[kind].filter(
    (m) =>
      (!m.tone || m.tone === ctx.tone) &&
      (!m.when || m.when.includes(tod)) &&
      (m.minActive === undefined || ctx.activeMinutes >= m.minActive),
  );
  const fresh = eligible.filter((m) => !ctx.recent.includes(m.id));
  const pool = fresh.length ? fresh : eligible.length ? eligible : BANK[kind];
  // Context-specific messages (time of day / long session) are favoured so it feels aware of the moment.
  const contextual = pool.filter((m) => m.when || m.minActive !== undefined);
  const chosen = contextual.length && rnd() < 0.6 ? pick(contextual, rnd) : pick(pool, rnd);
  return { id: chosen.id, text: fill(chosen.t, ctx), pose: POSE[kind] };
}

export function react(kind: MessageKind, answer: Answer, ctx: Ctx, rnd: () => number = Math.random): { text: string; pose: Pose } {
  if (answer === 'yes') {
    const streak = STREAKS[ctx.yesStreak];
    const base = fill(pick(YES[kind], rnd), ctx);
    return { text: streak ? `${base} ${streak}` : base, pose: 'happy' };
  }
  const pool = kind === 'welcome' || kind === 'intro' ? NO_WELCOME : ctx.tone === 'calm' ? NO_CALM : NO;
  return { text: fill(pick(pool, rnd), ctx), pose: 'sleepy' };
}
