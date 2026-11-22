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

**Play mode rules (G2, 2026-11-22; proposed, Connor to confirm):**
- The app checks each played note against the answer it expects (exact octave), never open-ended. A note is a wrong answer only when it was clearly picked; a scrape, or the last note still ringing, never costs a life.
- **Note Drop:** a note name; any octave the highlighted zone holds is right (it's a note-names game). An octave outside the zone is a miss.
- **Fret Finder:** the app hears pitch, not strings, so it walks the strings (6 → 1) and you play every place on the lit string. On one string each place is a different octave, so the octave is checked.
- **Octave Jump:** answer with the octave (2 strings over, 2 frets up), played on its own: the high note sits on the low note's overtone, so it can't be heard under it (the same reason EL.04 is assisted). Playing the low note first is allowed and doesn't count either way. Tap mode is the fallback.
- **Box Runner** and **In the Pocket** are play only: tapping a screen in time isn't the same skill as picking or strumming in time.
- Either mode's ★★ opens the next level.

## 2. Games
Every game's **first level is open from the start**; each next level opens with ★★ on the level before it (decided 2026-11-21). The game's `unlock_lesson` is shown as "Taught in …", a pointer, not a lock.

| ID | Game | How it works | Skill / unlock lesson |
|---|---|---|---|
| `G_note_drop` | **Note Drop** | Note names fall toward the fretboard. Play or tap the note in the highlighted zone before it lands. Speed rises every 10 notes; 3 misses end the round | Note names · F.07 |
| `G_fret_finder` | **Fret Finder** | One note name, 20 seconds: find **every** place it appears in the zone | Fretboard map · T.01 |
| `G_call_the_number` | **Call the Number** | A key is set. A "band leader" calls numbers ("4", "6m", "5/7") at the click tempo, and you play or tap the chord in that key. Songs mode uses real progressions from `song_outlines` (*This month* first) | Nashville numbers · T.03 |
| `G_hear_the_change` | **Hear the Change** | The app plays 1 and then another chord (synthesized, §9 of the spec), and you name the number. Starts with 1/4/5/6m, then adds 2m, 3m and slash chords | Ear: I–IV–V–vi · T.06 (T.05 for the major/minor-only level) |
| `G_capo_quick` | **Capo Quick** | "Song in Bb. You want G shapes. Capo?" and the reverse: "Capo 3, playing C shapes. Real key?" | Capo math · T.04 |
| `G_triad_hunt` | **Triad Hunt** | A chord name and a string set (3-2-1 or 4-3-2): tap or play the triad in a set fret window, any inversion | Triads · ER.04 (4-3-2 level: ER.05) |
| `G_octave_jump` | **Octave Jump** | A note on string 6 or 5: play its octave with the right shape, against the clock | Octaves · EL.04 |
| `G_box_runner` | **Box Runner** | The pentatonic box is shown; play the path (up, down, or a 3-note sequence) in time with the click. Graded by timing + pitch | Pentatonic · EL.01 (minor/positions: EL.02) |
| `G_in_the_pocket` | **In the Pocket** | Strum or chug to the click; a meter shows how far ahead of or behind the beat you are. **Gap Click** level: the click drops out for 1, 2 and then 4 bars, and you have to land on beat when it returns | Timing · A.05 (16ths level: ER.10) |
| `G_delay_math` | **Delay Math** | A BPM is shown: tap the dotted-eighth delay time in ms (within ±10 ms), or tap the delay "ghost" note in time | Delay time · T.07 |
| `G_change_sprint` | **Change Sprint** | 60 seconds of chord changes from a pair or family. Race your own ghost (best run so far) | Chord changes · A.01 |
| `G_song_run` | **Song Run** | **The boss level for each song.** A set-list song's sections scroll at chart BPM in your chosen key and capo, and you play each chord on its bar. Scored per bar. A 3-star Song Run on every song in *This month* earns **Set Ready** | Song practice · unlocks per song when its `practice_for` lessons are available |

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
  - Game score ÷ 100.
  - Lesson pass +50.
  - Review passed +20.
  - Daily Challenge finished +30.
  - New personal best +10.
- **Player level:** level *n* needs 100 + 25·(n−1) XP to reach the next one. Levels are cosmetic: they unlock fretboard themes and click sounds, never lessons. The curriculum decides what unlocks.
- **Streak:** any day with ≥ 5 minutes of practice, games included.
  - **Sunday counts:** a "Played a service today" button keeps the streak on days you play at church without opening the app.
  - One **streak freeze** is earned per 7-day streak, holding at most 2.
  - *How it's counted (G2):* practice minutes come from an activity clock (app on screen and touched in the last minute, or the click, tuner or mic running). Days logged before the clock existed still count. A freeze covers a missed day automatically; the frozen day doesn't add to the streak. Everything is recomputed from the day rows, so there's no streak row to drift.
- **Daily Challenge:** a 10-minute mix built from your weak spots: misses in `quiz_item_stats`, your slowest chord changes, and lessons whose reviews are due. It's the same every time it's opened that day.
- **Fretboard heatmap** (Progress screen): your own accuracy and speed for each string and fret, from Note Drop and Fret Finder. Hard spots get weighted into the Daily Challenge.

**Connection to reviews:** for `quiz` lessons only, a ★★ or better round of the matching game counts as that lesson's due review (Fret Finder → T.01, Capo Quick → T.04, Hear the Change → T.05/T.06, Delay Math → T.07). Note Drop on the strings-6-and-5 zone counts for F.07, and Call the Number counts for T.03. Games never count as the *initial* pass of a lesson; the lesson's own pass rules (§5 of the spec) decide that.

## 5. Badges (examples)
| Badge | Earned by |
|---|---|
| **Set Ready** | 3-star Song Run on every song in *This month* |
| **All Twelve** | Call the Number with ★★ in all 12 keys |
| **Whole Neck** | Note Drop ★★★ on the full-neck zone in play mode |
| **Five Boxes** | Box Runner ★★ in all 5 pentatonic positions |
| **In the Pocket** | Gap Click: land within 20 ms after a 4-bar gap, 5 times in a row |
| **Capo Brain** | Capo Quick: 30 correct in a row |
| **Faithful** | 30-day streak |

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
                                            pattern/window_ms/click_bars (In the Pocket; bars is generated)},
            target_score, round_s?, lives?}}
```
The build checks that every `unlock_lesson` and `review_for` ID exists in `lessons.json`, that every key and number is valid, and that every Song Run level references an existing outline.

**On-device (IndexedDB)** — added to the tables in `catalog/SCHEMA.md`:
| Table | Columns |
|---|---|
| `game_run` | `id PK, session_id FK, game_id, level_id, mode (tap\|play), score, accuracy, max_combo, stars, duration_s, misses_json, counted_review_for?, at` |
| `game_best` | PK `(game_id, level_id, mode)`, `best_score, best_stars, ghost_json, at` |
| `xp_ledger` | `id PK, at, source (game\|lesson_pass\|review\|daily\|pb), ref_id, xp` |
| `streak` | `id=1, current, longest, last_day, freezes` + `service_day(day PK)` for "Played a service" |
| `badge` | `badge_id PK, earned_at` |
| `daily_challenge` | `day PK, items_json, completed_at?` |

## 8. Build order
| # | Milestone | Done when |
|---|---|---|
| G1 | After M5: Arcade home, shared game frame, scoring/XP/streak, **tap mode** for Note Drop, Fret Finder, Capo Quick, Delay Math, Hear the Change, Call the Number | Six games playable by tapping; XP and streak update |
| G2 | After M7: play mode for single-note games (Note Drop, Fret Finder, Octave Jump, Box Runner); In the Pocket | Answering on the guitar works |
| G3 | After M8: play mode for chord games (Call the Number, Triad Hunt, Change Sprint) + **Song Run** + Daily Challenge + heatmap + badges | Full Arcade |
