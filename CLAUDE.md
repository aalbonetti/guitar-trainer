# Guitar Trainer (personal web app)

Personal-use **website / installable web app** for learning worship guitar (acoustic basics, electric rhythm and lead). Single user, offline-capable, no backend. Runs in Chrome on a **OnePlus Open** (foldable, Android 16+), added to the home screen. Hosted on GitHub Pages from this public repo.

## Read first
1. `guitar-kb/06-app-spec.md`: **the build spec** (stack, screens, grading, audio engine, milestones M0–M8)
2. `guitar-kb/07-games.md`: the Arcade (milestones G1–G3)
3. `guitar-kb/catalog/SCHEMA.md`: catalog JSON format and the IndexedDB tables
4. `guitar-kb/01-curriculum.md` … `05-worship-guitar.md`: teaching content (read when a task needs it)
5. `m0/`: the audio feasibility test page. Its `dsp.js` is the proven DSP to port into `web/src/dsp/`.

## Current state
- **M0** audio test: built, served at `/m0/`. Connor chose to skip entering the numbers for now, so chord graders default to `assisted` mode until real measurements exist.
- **M1 + M2** (first cut): `web/` app shell with Today / Path / Lesson / Songs / Tools / Settings, adaptive nav, tuner + metronome engine, lesson tool bar, song charts with key/capo/Nashville and chord diagrams, set-list CSV import (stored on the phone only), offline service worker.
- **M3** (done, first cut): all 48 lessons written as in `guitar-kb/content/{lesson}.md` (markdown + embed tokens, renderer in `web/src/ui/Content.tsx`, token IDs checked by `web/test/progress.test.ts`); IndexedDB progress (`web/src/db.ts`, rules in `web/src/progress.ts`); quiz engine (`web/src/quiz.ts`); self-check passing. Lessons whose grader isn't built yet (timing/pitch/chord) can be self-marked, recorded as `grader_mode: self`.
- **M4** (done, first cut): timing grader for the 13 `timing` lessons. Engine has one shared mic capture (`acquireCapture`/`releaseCapture`/`onBlock`) used by the tuner and graders, plus fixed click plans on the AudioContext clock. `web/src/grading/timing.ts` (pure: expected-strum grid incl. rests from the lesson's pattern, onset matching, ladder, calibration math), `runner.ts` (count-in learns click-bleed level and arrival, then grades), `ui/Timing.tsx` (calibration card, attempt runner, result card with per-strum chart). Strum calibration is stored per input route + posture in IndexedDB `calibration` (DB v2). Strums in a pattern's rests count against "slots right". Bluetooth output blocks graded attempts. Self-mark stays available under "Can't use the mic right now?".
- **M5** (done, first cut): daily loop. `web/src/practice.ts` (pure `buildQueue`: warm-up F.05 → due reviews → passed-once/current lesson per visible track → 1 song picked at random (stable per day) from **this week's** set (newest week column on/before the coming Sunday, `thisWeekIndex` in `setlist.ts`), else from the whole church list → ear quiz in 20 min; **10/20/free** routines, minutes always add up to the total; session store in localStorage `gt_session`, closes after 30 min idle, rows in IndexedDB `practice_session` (DB v3); attempts carry `session_id`). `ui/Practice.tsx` (Today practice card, session bar pinned above the nav with item timer and Next/Finish, summary, due-review nav badge). `ui/Progress.tsx` (streak calendar, minutes/week, lessons by track, tempo ladders, recent attempts). Backup saves/restores a .json file including the `gt_*` localStorage prefs (set list, input, routine).
- **Guided, not free** (Connor's call): locked lessons can be read but not attempted (quizzes there are practice-only) and point to the current lesson; timing attempts run only at the tempo-ladder BPM (no skip-to-goal button).
- **Tempo ladder fast track:** a *great* attempt (mean error ≤ ½ target, ≥ 97% right) jumps +8 BPM at once (`ladderStep` in `grading/timing.ts`, spec §5).
- **M6** (done, first cut): `web/src/chordpro.ts` (pure: ChordPro + chords-over-words parser, `toNumber` mirrors `build_song_outlines.py`, minor keys numbered from the relative major, `matchOutline` by CCLI then title), `charts.ts` (IndexedDB `imported_chart`, DB v4; raw text only, parsed when shown), `ui/Charts.tsx` (Import with preview, My charts tab, chart view with key/capo/numbers/words, chord diagrams, metronome). Tests build la-la fixtures from every outline.
- **G1** (done, first cut): `games.json` generated + checked by `build_catalog.py` (all 12 games; the 6 G1 ones have levels, the rest show "coming later"). `web/src/games/core.ts` (pure: scoring, stars, XP levels, fretboard math, question generators), `arcade.ts` (game_run, game_best with ghost, review credit for ★★ on quiz lessons, "Played a service today"), `xp.ts` (xp_ledger; lesson pass +50, review +20), `ui/Arcade.tsx` (home, shared game frame, tap fretboard, Note Drop, Fret Finder, Call the Number incl. songs mode from this week's set, Hear the Change, Capo Quick, Delay Math). DB v5. Arcade tab in the nav; level shown on Today.
- **Next:** M7 pitch grader (note matching) → G2 play mode for single-note games + In the Pocket. Then M8 chord graders → G3 (Song Run, Daily Challenge, badges, heatmap). Real-phone check of M4 still to do (calibration folded/unfolded, phone mic vs USB).

## Build and deploy
- `cd web && npm ci && npm test && npm run build`. Then `python3 test/m4_e2e.py`, `m5_e2e.py`, `m6_e2e.py` and `g1_e2e.py` (headless Chrome; `?sim` in the URL swaps the mic for synthesized strums fed through the real capture + onset path) (copies the catalog, builds chords-lib.json from chords-db, adds m0 at /m0/, writes sw.js).
- GitHub Actions (`.github/workflows/pages.yml`) builds and deploys `web/dist` to Pages on every push to `main`.

## Hard rules
- **The catalog is read-only to the app.** The JSON in `guitar-kb/catalog/` is generated. To change content, edit the Python build scripts and regenerate, never hand-edit the JSON:
  ```
  cd guitar-kb/catalog
  python3 build_catalog.py .
  python3 build_song_outlines.py .
  ```
  `build_setlist.py` is for local use only: the church set list (CSV and setlist.json) is personal and is gitignored. In the app, the set list is imported on the phone.
  The scripts check the music data. A failing check is a real error: fix the source data, never the check.
- **Catalog IDs are stable and never reused.** User progress is keyed by them.
- **Public repo:** song outlines are facts only (key, BPM, meter, chord progressions, Nashville numbers). Never add lyrics, melodies or signature riffs, test fixtures included (use placeholder words like "la la"). Imported ChordPro charts live only in the phone's IndexedDB. No secrets in the repo.
- **Audio:** clicks are scheduled on the AudioContext clock, never by timers. Mic opened with echoCancellation/noiseSuppression/autoGainControl **off**. Graders verify against the *expected* note or chord; they never run open-ended recognition.
- **Foldable:** a fold is a resize. The audio engine lives outside UI components, and layouts use breakpoints, never fixed sizes.
- chords-db (MIT, https://github.com/tombatossals/chords-db) gets merged at build time. Keep its copyright notice: "Copyright (c) 2016 David Rubert".

## Conventions
- TypeScript + Preact + Vite; Vitest. Hand-written service worker (generated in `web/scripts/postbuild.mjs`). IndexedDB (Dexie) arrives with M3; small settings use localStorage for now.
- Per-string arrays are ordered string 6 → 1 (low E first); `-1` = muted, `0` = open. Standard tuning MIDI 40 45 50 55 59 64.
- Keep Connor informed in plain language. He's technical but not a web-audio specialist.
