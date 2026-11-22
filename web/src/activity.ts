// Activity clock: practice minutes per day for the streak's 5-minute rule (07-games.md §4).
// Every 10 s, if the app is on screen and you've touched it in the last minute, or the click, tuner, mic or a
// graded click is running, today gets 10 more seconds. Reading a lesson, playing a game, practicing to the
// click all count; leaving the phone on the stand with nothing running doesn't.
// With the screen off, timers stop ticking; when the app is seen again, the time the click actually played or
// the mic actually listened in between is added (hiddenCredit in streak.ts).
import { addActive, progress } from './progressStore';
import { metro, capture, audioProgress } from './audio/engine';

import { counts, hiddenCredit, TICK_S, type AudioMark } from './streak';

let lastInput = Date.now(), timer: number | null = null;
export function startActivityClock() {
  if (timer !== null) return;
  const poke = () => { lastInput = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) addEventListener(ev, poke, { passive: true, capture: true });
  const mark = (): AudioMark => ({ wallMs: Date.now(), ...audioProgress(), micOn: capture.get().on });
  let hidden: AudioMark | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hidden = mark(); return; }
    if (hidden) { const s = hiddenCredit(hidden, mark()); hidden = null; if (s > 0 && progress.get().ready) void addActive(s); }
  });
  timer = window.setInterval(() => {
    if (!progress.get().ready) return;
    const audio = metro.get().running || capture.get().on;
    if (counts({ visible: document.visibilityState === 'visible', sinceInputMs: Date.now() - lastInput, audio })) void addActive(TICK_S);
  }, TICK_S * 1000);
}
