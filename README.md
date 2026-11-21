# Guitar Trainer

Personal web app for learning worship guitar (acoustic basics, electric rhythm and lead), built for Chrome on a OnePlus Open and installable to the home screen.

- **App:** `web/` (Preact + Vite + TypeScript). Lessons, tuner, metronome, song charts (key / capo / Nashville numbers, chord diagrams).
- **Audio test (M0):** `m0/`, served at `/m0/`.
- **Knowledge base + spec:** `guitar-kb/` (start with `06-app-spec.md`).
- **Deploy:** GitHub Actions builds `web/` and publishes to GitHub Pages on every push to `main`.

Song data is facts only (keys, chords, Nashville numbers, CCLI numbers); no lyrics. Chord library: chords-db, MIT License, Copyright (c) 2016 David Rubert.
