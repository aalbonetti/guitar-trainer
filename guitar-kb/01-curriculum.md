# Guitar Trainer — Curriculum (Worship Focus)

**Scope:** acoustic and electric guitar, with a worship focus. Acoustic covers solid basics for leading and accompanying songs. Electric covers worship **rhythm** and **lead** playing. Shredding, jazz, and advanced classical technique are out of scope.
The machine-readable version of this curriculum is `catalog/lessons.json`. This doc is the human-readable overview.

## Track map
```
F  Foundations (shared) ──┬── A  Acoustic Worship (basic)
                          ├── ER Electric Worship Rhythm ──┐
                          └── EL Electric Worship Lead  ◄──┘ (EL.04+ needs ER.04)
T  Theory & Ear (shared, runs alongside every track)
```
A student picks acoustic, electric, or both after Foundations. Theory lessons chain on their own prerequisites, and some track lessons require them (A.08 needs T.04, ER.03 needs T.07, ER.11 needs T.03).

## Pass criterion types (what the app measures)
| Type | Measured by | Example |
|---|---|---|
| `changes_per_min` | Chord detection + timer | G↔Cadd9 at 30/min |
| `timing` | Onset detection vs click | 8 bars at 80 BPM, mean error ≤ 40 ms |
| `pitch` | Pitch detection | Bend to target ±15 cents |
| `chord_accuracy` | Chroma/chord detection | 90% of strums detected as the right chord |
| `quiz` | In-app quiz | 90% correct, ≤ 3 s per answer |
| `self_check` | Student confirms (+ optional recording) | Dynamics, tone, feel |

---

## F — Foundations (shared)
| ID | Lesson | Pass |
|---|---|---|
| F.01 | Parts of the guitar, string numbers, standard tuning E A D G B E | quiz |
| F.02 | Tuning: in-app tuner plus the 5th-fret method | pitch: all strings ±5 cents |
| F.03 | Posture, fret-hand shape, pick grip | self_check |
| F.04 | Reading chord diagrams, tab, and chord charts | quiz |
| F.05 | Spider warm-up 1-2-3-4 | timing: 60 BPM eighths |
| F.06 | Playing with a click: count-ins, quarter-note downstrums | timing: 70 BPM, 8 bars |
| F.07 | Note names on strings 6 and 5 | quiz |

## A — Acoustic Worship (basic)
| ID | Lesson | Pass |
|---|---|---|
| A.01 | Em and G (3-finger, then 4-finger 320033) | changes_per_min: 30 |
| A.02 | **The G family:** G, Cadd9, Dsus4, Em7, with ring and pinky anchored | changes_per_min: 30 per pair |
| A.03 | D family: D, A, Asus4, A7sus4, Bm (partial) | changes_per_min: 25 |
| A.04 | C family: C, Am, Fmaj7, G | changes_per_min: 25 |
| A.05 | Eighth-note strum with accents on 2 & 4 | timing: 80 BPM |
| A.06 | Worship pattern: D – D U – U D U | timing: 90 BPM, 8 bars |
| A.07 | Hymn meters: 3/4 waltz strum and 6/8 feel | timing: 3/4 at 90 BPM |
| A.08 | Capo and keys: play any key from G, C, D, E, A shapes | quiz (T.04) + chord_accuracy |
| A.09 | Dynamics: single "whole-note" strums for verses, full strumming for choruses, percussive chunk | self_check |
| A.10 | Simple arpeggio picking for intros and quiet verses | timing: 70 BPM |
| A.11 | First hymns: Amazing Grace and the 3-chord hymn set | chord_accuracy 90% at tempo |
| A.12 | Intro to barre chords: F (E-shape), Bm (A-shape) | chord_accuracy 80% |
| **Milestone** | Lead a hymn on acoustic in a key someone names, using a capo, with the click | |

## ER — Electric Worship Rhythm
| ID | Lesson | Pass |
|---|---|---|
| ER.01 | Electric basics: clean tone, pick attack, muting with the fret hand and palm | self_check |
| ER.02 | Root-6 and root-5 power chords, with a palm-muted eighth-note chug | timing: 90 BPM |
| ER.03 | Eighth-note root pulse plus a **dotted-eighth delay**, including delay-time math | timing: 100 BPM, 16 bars |
| ER.04 | Major and minor triads on strings 3-2-1 (three inversions) | chord_accuracy + changes_per_min 20 |
| ER.05 | Triads on strings 4-3-2 | chord_accuracy |
| ER.06 | Drone voicings: key-of-E and key-of-D sets with ringing open strings | changes_per_min: 25 |
| ER.07 | Swells and pads: volume knob or pedal swells with reverb | self_check |
| ER.08 | Song dynamics map: what electric plays in the intro, verse, chorus, bridge, and tag | self_check |
| ER.09 | Full barre chords (E and A shapes) for big choruses | chord_accuracy 90% |
| ER.10 | Sixteenth-note muted groove locked to the kick drum and hi-hat | timing: 90 BPM, ≤ 30 ms |
| ER.11 | Playing from Nashville-number charts in any key | quiz + chord_accuracy |
| **Milestone** | Play a full song arrangement to the click, switching parts by section | |

## EL — Electric Worship Lead
| ID | Lesson | Pass |
|---|---|---|
| EL.01 | Major pentatonic scale, position 1 (worship is mostly in major keys) | timing: 80 BPM eighths |
| EL.02 | Relative minor pentatonic, plus positions 2 and 5 | timing: 80 BPM |
| EL.03 | Hammer-ons, pull-offs, slides | self_check + timing |
| EL.04 | **Octave melodies**: the four octave shapes, muting the middle string | pitch: correct notes 90% |
| EL.05 | Bends (half and whole step) and vibrato | pitch: ±15 cents |
| EL.06 | Double stops: 3rds and 6ths over chords | pitch |
| EL.07 | Playing the hymn melody as a lead line or intro | pitch + timing |
| EL.08 | Lead lines with dotted-eighth delay | timing |
| EL.09 | Major scale in one position, plus targeting chord tones | quiz + pitch |
| EL.10 | Writing intro, turnaround, and tag hooks: motif, repeat, vary | self_check |
| EL.11 | Ambient lead: natural harmonics, swelled melody notes | pitch |
| **Milestone** | Intro hook plus an 8-bar instrumental over I–V–vi–IV in 3 keys | |

## T — Theory & Ear (shared)
| ID | Lesson | Prerequisites (catalog is the source of truth) |
|---|---|---|
| T.01 | Intervals and the fretboard | F.07 |
| T.02 | Major scale and diatonic chords | T.01 |
| T.03 | Nashville Number System | T.02 |
| T.04 | Capo math and transposing | T.01 (A.08 needs it) |
| T.05 | Ear: major vs minor chords | F.06 |
| T.06 | Ear: hearing I, IV, V, and vi movement | T.03, T.05 |
| T.07 | Tempo, subdivisions, and delay time | F.06 (ER.03 needs it) |

## Practice routines (suggested)
| Length | Acoustic | Electric |
|---|---|---|
| 15 min | 3 spider · 5 chord changes · 7 song with click | 3 spider · 5 current part · 7 song section with click |
| 30 min | 5 warm-up · 8 changes · 7 strum/picking · 8 song · 2 ear quiz | 5 warm-up · 8 rhythm part · 8 lead skill · 7 song · 2 ear quiz |

## Progress logic
- A lesson passes when its target is met in 2 separate sessions.
- Review at 1, 3, 7, 14, and 30 days after passing.
- Tempo ladder: start at 60–70% of the target BPM and raise it 4 BPM after 3 clean passes. If 2 passes in a row are sloppy, drop back 8 BPM.
