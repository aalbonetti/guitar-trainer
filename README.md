# Guitar Trainer

Personal web app for learning worship guitar (acoustic basics, electric rhythm and lead), built for Chrome on a OnePlus Open.

- **Live site:** this repo's GitHub Pages URL. Right now it hosts the **M0 audio test** (tuner, click, latency, timing, chord check, fold test).
- **Spec:** `guitar-kb/06-app-spec.md` · **Games:** `guitar-kb/07-games.md` · **Data:** `guitar-kb/catalog/SCHEMA.md`
- **M0 source:** `m0/` (`python3 m0/build.py` rebuilds the page; `node m0/test/test_dsp.js` runs the DSP tests)

Song data is facts only (keys, chords, Nashville numbers, CCLI numbers); no lyrics. Chord library: chords-db, MIT, Copyright (c) 2016 David Rubert.
