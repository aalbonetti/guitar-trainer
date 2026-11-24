# Guitar Trainer — Games ("Arcade", working name)

A **game** section that turns the curriculum's skills into short replayable rounds (1–3 minutes each, ~10 minutes a day). It is inspired by fretboard-game apps in general, but it's our own design: our own names, art and rules. No other app's names, graphics, sounds or text get copied.

**What makes it ours:**
1. **Play mode.** Games can be answered on the real guitar, with the app listening (pitch and chord verification from `06-app-spec.md` §6), not just by tapping the screen.
2. **Worship-specific games.** Nashville numbers, capo math, dotted-eighth delay, and progressions taken from your church's actual set list.
3. **Connected to the curriculum.** Games unlock with lessons, count toward reviews, and feed the weak-spot data back into Today's queue.

## 1. Input modes
| Mode | How you answer | Available |
|---|---|---|
| **Tap** | Tap the fretboard, a number pad or a choice | v1, every game |
| **Play** | Play the note or chord; the app hears it | Single notes from M7 (pitch grader). Chords from M8 (chord verifier), with `assisted` fallback |

Each game remembers the mode you last used. Play-mode scores are kept apart from tap scores, because they're different skills.

**Play mode rules (G2, 2026-11-22; proposed, to confirm):**
- The app checks each played note against the answer it expects (exact octave), never open-ended. A note is a wrong answer only when it was clearly picked; a scrape, or the last note still ringing, never costs a life.
- **Note Drop:** a note name; any octave the highlighted zone holds is right (it's a note-names game). An octave outside the zone is a miss.
- **Fret Finder:** the app hears pitch, not strings, so it walks the strings (6 → 1) and you play every place on the lit string. On one string each place is a different octave, so the octave is checked.
- **Octave Jump:** answer with the octave (2 strings over, 2 frets up), played on its own: the high note sits on the low note's overtone, so it can't be heard under it (the same reason EL.04 is assisted). Playing the low note first is allowed and doesn't count either way. Tap mode is the fallback.
- **Box Runner** and **In the Pocket** are play only: tapping a screen in time isn't the same skill as picking or strumming in time.
- Either mode's ★★ opens the next level. A game's first-listed mode is its default: tap for the G1 games, play for Octave Jump (tap is its fallback).

**Chord play mode (G3, 2026-11-23; proposed, to confirm):**
- Every strum is checked against the chord the game expects with the M8 verifier (`chordTarget` + `StrumAnalyzer` + `verifyChord`), against the other chords the game offers. As with notes, a strum is a wrong answer only when it clearly sounds like another offered chord; a scrape or an unclear strum is ignored (own-pace games).
- **Chord families:** Call the Number and Song Run grade a chord's family (root + major/minor). G, G2, Gsus, G/B and G7 all count as G; Em7 counts as Em. Any voicing counts (open, E- or A-shape barre, a capo'd shape; Song Run also accepts the chart chord's own shape). The app can't hear which voicing you used.
- **Ringing chords:** for 0.6 s after a decided strum only a right answer counts, and the chord just heard (right or wrong) strummed again within 2 s isn't a new wrong answer (it's still ringing, or a second onset inside one slow strum).
- **Call the Number (play):** own pace; the next call comes as soon as a strum is decided, or after 12 s (a miss). Calling numbers on the click is what Song Run does.
- **Triad Hunt:** tap one fret on each string of the set, or strum those three strings. Any closed triad (one chord tone per string) inside the fret window counts. In play mode the app checks the chord, not the inversion (chroma can't tell), so the window is a guide.
- **Change Sprint:** one strum per chord. A strum verified as the next chord of the cycle is a change (points by speed: 2.0 at one change a second, 1.0 at one every 4 s). Strumming the chord you're on again counts for nothing. A strum heard as neither (a muddy change) is a miss, unless it's far quieter than your real strums (< 35 % of their median level), which is treated as noise.
- **Song Run:** click-timed like M8's timed grader: a bar is right when most of its strums are the bar's chord family; points 100 per bar × closeness of the first right strum to the 1 (2.0 within 60 ms, 1.0 at half a beat late) × combo. You pick key, capo (shared with the Song view) and ½ / 1 / 2 bars per chord (outlines have no bar lengths; at ½ bar each box is half a bar). With a capo, the same shapes without it are decoys (a forgotten capo fails). Every song is open from the start; its `practice_for` lessons are shown as "Taught in" pointers (this replaces "unlocks per song when its practice_for lessons are available" in the table below, to match the 2026-11-21 rule). Short songs go round 2–4 times so a round is at least ~30 s; 2 bars per chord is offered only when the round stays within 3 minutes.
- **Assisted mode** (Settings → Grading mode, the default until the phone chord check is done): own-pace games show "✓ I played it right" after a miss, which counts that answer as right; Change Sprint and Song Run ask at the end whether the round counts ("Doesn't count" saves nothing). Song Run (click-timed) is blocked by Bluetooth output; the other chord games have no click.

## 2. Games
Every game's **first level is open from the start**; each next level opens with ★★ on the level before it (decided 2026-11-21). The game's `unlock_lesson` is shown as "Taught in …", a pointer, not a lock.

| ID | Game | How it works | Skill / unlock lesson |
|---|---|---|---|
| `G_note_drop` | **Note Drop** | Note names fall toward the fretboard. Play or tap the note in the highlighted zone before it lands. Speed rises every 10 notes; 3 misses end the round | Note names · F.07 |
| `G_fret_finder` | **Fret Finder** | One note name, 20 seconds: find **every** place it appears in the zone | Fretboard map · T.01 |
| `G_call_the_number` | **Call the Number** | A key is set. A "band leader" calls numbers ("4", "6m", "5/7") at the click tempo, and you play or tap the chord in that key. Songs mode uses real progressions from `song_outlines` (the weekly pool) | Nashville numbers · T.03 |
| `G_hear_the_change` | **Hear the Change** | The app plays 1 and then another chord (synthesized, §9 of the spec), and you name the number. Starts with 1/4/5/6m, then adds 2m, 3m and slash chords | Ear: I–IV–V–vi · T.06 (T.05 for the major/minor-only level) |
| `G_capo_quick` | **Capo Quick** | "Song in Bb. You want G shapes. Capo?" and the reverse: "Capo 3, playing C shapes. Real key?" | Capo math · T.04 |
| `G_triad_hunt` | **Triad Hunt** | A chord name and a string set (3-2-1 or 4-3-2): tap or play the triad in a set fret window, any inversion | Triads · ER.04 (4-3-2 level: ER.05) |
| `G_octave_jump` | **Octave Jump** | A note on string 6 or 5: play its octave with the right shape, against the clock | Octaves · EL.04 |
| `G_box_runner` | **Box Runner** | The pentatonic box is shown; play the path (up, down, or a 3-note sequence) in time with the click. Graded by timing + pitch | Pentatonic · EL.01 (minor/positions: EL.02) |
| `G_in_the_pocket` | **In the Pocket** | Strum or chug to the click; a meter shows how far ahead of or behind the beat you are. **Gap Click** level: the click drops out for 1, 2 and then 4 bars, and you have to land on beat when it returns | Timing · A.05 (16ths level: ER.10) |
| `G_delay_math` | **Delay Math** | A BPM is shown: tap the dotted-eighth delay time in ms (within ±10 ms), or tap the delay "ghost" note in time | Delay time · T.07 |
| `G_change_sprint` | **Change Sprint** | 60 seconds of chord changes from a pair or family. Race your own ghost (best run so far) | Chord changes · A.01 |
| `G_song_run` | **Song Run** | **The boss level for each song.** A set-list song's sections scroll at chart BPM in your chosen key and capo, and you play each chord on its bar. Scored per bar. A 3-star Song Run on every song in the church list earns **Set Ready** | Song practice · every song open; its `practice_for` lessons are pointers (G3, proposed; was: unlocks when they're available) |

**Levels inside each game** come from parameters, not new code: fretboard zone (strings 6–5, frets 0–5 → whole neck), speed, key set (G/D/C/E/A → all 12), number vocabulary, and tap vs play.

## 3. Scoring
- **Points per correct answer** = 100 × speed bonus (1.0–2.0, by response time) × combo.
  - *Click-timed games (G2, proposed):* the bonus is how close to the beat (2.0 within ⅙ of the window for In the Pocket, 25 ms for Box Runner, 1.0 at the window's edge), and the 100 is per beat (an eighth note is worth 50, a sixteenth 25), so a 16th-note round doesn't score 4× a quarter-note one.
- **Combo** goes ×1 → ×2 → ×3 → ×4, stepping up after every 8 correct in a row. A miss resets it to ×1.
- **Stars per level:** ★ = finish the round · ★★ = 85% accuracy · ★★★ = 95% accuracy and beat the level's target score.
- **Ghost:** a bar during play shows your best run's progress at the same moment.
- **Personal bests** are kept per game, level and mode. There are no online leaderboards: this is a single-user offline app, so you only compete with yourself.

## 4. Progression (whole app, lessons included)
- **XP:**
  - Game score ÷ 500, at most 30 a round (G2 rebalance, proposed: ÷ 100 let one click-timed round give ~460 XP, ten lesson passes' worth).
  - Lesson pass +50.
  - Review passed +20.
  - Daily Challenge finished +30.
  - New personal best +10.
- **Player level:** level *n* needs 100 + 25·(n−1) XP to reach the next one. Levels are cosmetic: they unlock fretboard themes and click sounds, never lessons. The curriculum decides what unlocks.
- **Streak:** any day with ≥ 5 minutes of practice, games included.
  - **Sunday counts:** a "Played a service today" button keeps the streak on days you play at church without opening the app.
  - One **streak freeze** is earned per 7-day streak, holding at most 2.
  - *How it's counted (G2):* practice minutes come from an activity clock (app on screen and touched in the last minute, or the click, tuner or mic running; with the screen off, the time the click actually played or the mic actually listened is added when the app is seen again). A day counts as practiced only when it meets the rule, so opening the app isn't a practice day. Days logged before the clock existed still count. A freeze covers a missed day automatically; the frozen day doesn't add to the streak. Everything is recomputed from the day rows, so there's no streak row to drift.
- **Daily Challenge:** a 10-minute mix built from your weak spots: misses in `quiz_item_stats`, your slowest chord changes, and lessons whose reviews are due. It's the same every time it's opened that day.
  - *How it's built (G3, proposed):* up to 4 rounds adding up to 10 minutes, in this order: (1) fretboard hard spots (heatmap + note-name quiz misses) → Note Drop, else Fret Finder, on an open level whose zone holds them, with those notes asked about half the time; (2) quiz misses → the game whose level reviews that lesson; (3) the slowest chord changes (best rate ÷ goal, from one-minute lesson attempts and Change Sprint) → the Change Sprint level with those chords; (4) reviews due → a game round for quiz lessons (★★ counts), else the lesson; (5) open levels below ★★★, fewest stars first. Song Run is never in the mix. An item is done when a round of that level (or an attempt at that lesson) is finished after the challenge was made. Stored in `daily_challenge` the first time it's opened that day.
- **Fretboard heatmap** (Progress screen): your own accuracy and speed for each string and fret, from Note Drop and Fret Finder. Hard spots get weighted into the Daily Challenge.
  - *Data (G3):* every Note Drop / Fret Finder answer (tap and play) at a position, in `quiz_item_stats` under `quiz_id = 'arcade:fretboard'`, `item_key = 's5f7'`, plus `ms_sum` (time to right answers). A wrong tap counts against the tapped spot; a note that wasn't found counts against its spots. Hard spot = seen ≥ 3 times and under 75 % right, or right but slower than 1.5× your median time.

**Connection to reviews:** for `quiz` lessons only, a ★★ or better round of the matching game counts as that lesson's due review (Fret Finder → T.01, Capo Quick → T.04, Hear the Change → T.05/T.06, Delay Math → T.07). Note Drop on the strings-6-and-5 zone counts for F.07, and Call the Number counts for T.03. Games never count as the *initial* pass of a lesson; the lesson's own pass rules (§5 of the spec) decide that.

## 5. Badges (examples)
| Badge | Earned by |
|---|---|
| **Set Ready** | 3-star Song Run on every song in the church list |
| **All Twelve** | Call the Number with ★★ in all 12 keys |
| **Whole Neck** | Note Drop ★★★ on the full-neck zone in play mode |
| **Five Boxes** | Box Runner ★★ in all 5 pentatonic positions |
| **In the Pocket** | Gap Click: land within 20 ms after a 4-bar gap, 5 times in a row |
| **Capo Brain** | Capo Quick: 30 correct in a row |
| **Faithful** | 30-day streak |

*G3 (proposed):* badges are catalog data (`badges.json`, checked by `build_catalog.py`) and are never taken away. All Twelve: a key counts once a ★★-or-better round had ≥ 3 calls in it with ≥ 85 % right. Five Boxes: a ★★ Box Runner round in each position number 1–5 (major or minor box; level `br6` adds minor boxes 3 and 4). In the Pocket: the last 5 Gap Click (pk3) rounds in a row landed within 20 ms after the 4-bar gap. Set Ready: the church list is the set list saved on the phone (songs with outlines), else the song library (as for the song of the week). Faithful: longest streak ≥ 30.

## 6. Screens
- **Arcade home:** game tiles (locked tiles show the lesson that unlocks them), Daily Challenge banner, streak, level/XP bar.
- **Game screen:** shared frame with score, combo, ghost bar, timer, mode toggle and pause. The fretboard sits on the bottom half.
  - Unfolded: the game board on the left, with the target, combo and live pitch/chord read-out on the right.
  - Tabletop: board on top, answer pad on the bottom.
- **Results:** stars, score versus best, XP gained, misses to review ("you missed G on string 5, fret 10 twice"), and Replay / Next level.
- The tuner and metronome sheets (spec §3b) are available from the pause menu. The game owns the click while a round is running.

## 7. Data
**Catalog** — new `games.json`, generated and checked by `build_catalog.py`:
```
{id, name, unlock_lesson, review_for[] (lesson ids), modes[] (tap|play),
 levels[] {id, name, unlock_lesson?, params{zone{strings[],frets[]}?, keys[]?, numbers[]?,
                                            bpm?, speed?, gap_bars?, string_sets[]?, positions[]?,
                                            G2: show_fret? (Octave Jump), scale/path/sub/passes (Box Runner),
                                            pattern/window_ms/click_bars (In the Pocket; bars is generated),
                                            G3: string_sets/qualities/window (Triad Hunt), cycle/target_per_min/voicings (Change Sprint;
                                            voicings + target_score generated), outline/bpm/meter/passes/bars_per_chord/targets (Song Run,
                                            one level per outline, generated by build_song_outlines.py)},
            target_score, round_s?, lives?}}
```
The build checks that every `unlock_lesson` and `review_for` ID exists in `lessons.json`, that every key and number is valid, and that every Song Run level references an existing outline.

**On-device (IndexedDB)** — added to the tables in `catalog/SCHEMA.md`:
| Table | Columns |
|---|---|
| `game_run` | `id PK, session_id FK, game_id, level_id, mode (tap\|play), score, accuracy, max_combo, max_streak? (G3), stars, duration_s, misses_json, extra_json? (G3: keys called, box position, Gap Click landings, Change Sprint rate, Song Run key/capo), grader_mode? (G3 chord games), counted_review_for?, at` |
| `game_best` | PK `(game_id, level_id, mode)`, `best_score, best_stars, ghost_json, at` |
| `xp_ledger` | `id PK, at, source (game\|lesson_pass\|review\|daily\|pb), ref_id, xp` |
| `streak` | `id=1, current, longest, last_day, freezes` + `service_day(day PK)` for "Played a service" |
| `badge` | `badge_id PK, earned_at` |
| `daily_challenge` | `day PK, items_json, created_at, completed_at?` |

## 8. Build order
| # | Milestone | Done when |
|---|---|---|
| G1 | After M5: Arcade home, shared game frame, scoring/XP/streak, **tap mode** for Note Drop, Fret Finder, Capo Quick, Delay Math, Hear the Change, Call the Number | Six games playable by tapping; XP and streak update |
| G2 | After M7: play mode for single-note games (Note Drop, Fret Finder, Octave Jump, Box Runner); In the Pocket | Answering on the guitar works |
| G3 | After M8: play mode for chord games (Call the Number, Triad Hunt, Change Sprint) + **Song Run** + Daily Challenge + heatmap + badges | Full Arcade |
