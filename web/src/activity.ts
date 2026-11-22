// Activity clock: practice minutes per day for the streak's 5-minute rule (07-games.md §4).
// Every 10 s, if the app is on screen and you've touched it in the last minute, or the click, tuner, mic or a
// graded click is running, today gets 10 more seconds. Reading a lesson, playing a game, practicing to the
// click all count; leaving the phone on the stand with nothing running doesn't.
import { addActive, progress } from './progressStore';
import { metro, capture } from './audio/engine';

import { counts, TICK_S } from './streak';

let lastInput = Date.now(), timer: number | null = null;
export function startActivityClock() {
  if (timer !== null) return;
  const poke = () => { lastInput = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) addEventListener(ev, poke, { passive: true, capture: true });
  timer = window.setInterval(() => {
    if (!progress.get().ready) return;
    const audio = metro.get().running || capture.get().on;
    if (counts({ visible: document.visibilityState === 'visible', sinceInputMs: Date.now() - lastInput, audio })) void addActive(TICK_S);
  }, TICK_S * 1000);
}
