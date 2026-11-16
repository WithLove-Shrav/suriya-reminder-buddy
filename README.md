# 🎸 Suriya – My Reminder Buddy

A tiny, cheeky companion who lives in your IDE and looks after you while you code.
Suriya floats on your screen with a speech bubble and nudges you — gently, and never the same way twice — to:

- 💧 **drink water**
- 👀 **rest your eyes** (the 20-20-20 rule)
- 🙆 **stretch**
- 🚶 **take a walk**

…and welcomes you back after you've been away for 10+ hours.

You answer with a simple **Yes** / **Not now**. Yes earns a happy reaction (and streak shout-outs); *Not now* snoozes the reminder, a little longer each time you say it.

> *"Hi Shravya, I'm Suriya. Na unta soliye aaganum, nee romba nerama screen paakura. 👀 Take a break?"*

## What makes it feel alive

- **Messages that aren't repetitive** – 7–11 variants per reminder type, picked by time of day, how long you've been working and your tone setting (`cheerful` / `calm`). Recently shown lines are skipped.
- **A dash of Tamil** – one Tanglish line per reminder type; the screen-break catchphrase is reserved for eye breaks. Everything else is English.
- **Aware of you** – reminders only fire while the window is focused and you've been active; they pause when you're idle; and they're re-staggered when you come back so you never get a pile-up.
- **Quiet by design** – a minimum gap between any two reminders, and the floating window never steals keyboard focus, so you can answer without leaving your editor or terminal.

## How it works

```
 ┌─ Antigravity / VS Code window(s) ──────────────┐        ┌─ companion-buddy (macOS) ─┐
 │  extension (TypeScript)                        │  unix  │  transparent, always-on-  │
 │   • activity detection (typing, scroll, focus, │ socket │  top, non-activating      │
 │     terminal, tasks, debug)                    │◄──────►│  window: avatar + bubble  │
 │   • scheduler, snooze/back-off logic           │  JSON  │  + Yes / Not now buttons  │
 │   • message engine                             │        │  (Swift + WKWebView)      │
 │   • sidebar view (stats, controls)             │        └───────────────────────────┘
 └──────────────┬─────────────────────────────────┘
                │ shared state file (per user, not per workspace)
```

- **Global across projects:** the extension is installed per user, so it runs in every workspace and window. All windows share one state file (timers, "last active", streaks) and one floating buddy, so you get one nudge at a time.
- **Away detection:** a heartbeat of "last active" is stored; the first activity after a gap ≥ 10h triggers the welcome-back message (the threshold is configurable).
- **Fallback:** if the floating helper can't run (non-macOS, launch failure), nudges appear as notifications with **Yes / Not now** buttons, and in the sidebar.

## Install

Requires Node 20+, and Xcode command-line tools for the floating buddy (`swiftc`).

```bash
npm install
npm run package          # builds the helper (arm64 + x86_64), bundles, and writes reminder-companion.vsix

# Antigravity IDE
"/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide" --install-extension reminder-companion.vsix
# VS Code
code --install-extension reminder-companion.vsix
```

Then run **Developer: Reload Window**.

## Try it

| Command | What it does |
| --- | --- |
| `Companion: Nudge Me Now (next reminder type)` | Demo: cycles water → eye break → stretch → walk |
| `Companion: Nudge Me (Choose Type)` | Pick the reminder to see |
| `Companion: Simulate Welcome-Back` | Shows the "been away 10h" greeting |
| `Companion: Enable / Disable` | Also: click the status-bar item |

## Settings (`reminderCompanion.*`)

`enabled`, `name`, `companionName`, `tone`, `waterMinutes` (45), `breakMinutes` (30), `stretchMinutes` (60), `walkMinutes` (90), `idleMinutes` (5), `awayHours` (10), `snoozeMinutes` (10), `minGapMinutes` (10), `notify`, `floatingBuddy`, `buddyCorner`. Set an interval to `0` to turn that reminder off.

## Develop

```bash
npm run typecheck
npm test            # logic + engine (fake `vscode`, controllable clock) + real-helper integration tests
npm run build       # bundle only
```

Layout: `src/` (extension), `buddy/` (Swift helper + its web UI), `assets/` (avatar poses), `tests/`.

## Avatar art

The poses in `assets/` are personal artwork made for this project. Don't reuse them without permission.
