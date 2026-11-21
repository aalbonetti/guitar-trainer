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
- **Next:** M4 timing grader (strum calibration + onset grading from m0's DSP), then M5 daily loop polish, then G1 Arcade tap-mode games.

## Build and deploy
- `cd web && npm ci && npm test && npm run build` (copies the catalog, builds chords-lib.json from chords-db, adds m0 at /m0/, writes sw.js).
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
