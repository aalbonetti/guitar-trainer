# Music Theory Reference for Guitar

## Notes & intervals
The chromatic scale: C C#/Db D D#/Eb E F F#/Gb G G#/Ab A A#/Bb B. One fret = one semitone (half step).
| Semitones | Interval | Guitar shortcut |
|---|---|---|
| 0 | Unison | |
| 1 | m2 | +1 fret |
| 2 | M2 | +2 frets |
| 3 | m3 | |
| 4 | M3 | |
| 5 | P4 | Same fret, next higher string (except G→B) |
| 6 | Tritone (b5) | |
| 7 | P5 | +2 frets, next higher string (power chord) |
| 8 | m6 | |
| 9 | M6 | |
| 10 | m7 | |
| 11 | M7 | |
| 12 | Octave | +2 frets, two strings higher (strings 6→4 and 5→3) |
The G→B pair is tuned a major 3rd apart, not a 4th, so shapes that cross from string 3 to string 2 shift up one fret.

## Major scale & keys
- Formula: W W H W W W H (degrees 1 2 3 4 5 6 7)
- Diatonic chords: I ii iii IV V vi vii° (maj, min, min, maj, maj, min, dim)
- As 7th chords: Imaj7 ii7 iii7 IVmaj7 V7 vi7 viiø7

| Key | I | ii | iii | IV | V | vi | vii° | Sharps/flats |
|---|---|---|---|---|---|---|---|---|
| C | C | Dm | Em | F | G | Am | B° | 0 |
| G | G | Am | Bm | C | D | Em | F#° | 1# |
| D | D | Em | F#m | G | A | Bm | C#° | 2# |
| A | A | Bm | C#m | D | E | F#m | G#° | 3# |
| E | E | F#m | G#m | A | B | C#m | D#° | 4# |
| F | F | Gm | Am | Bb | C | Dm | E° | 1b |
| Bb | Bb | Cm | Dm | Eb | F | Gm | A° | 2b |

The circle of fifths, clockwise: C G D A E B F#/Gb Db Ab Eb Bb F. Each step adds one sharp, or removes one flat.
Relative minor = the 6th degree of a major key (C major ↔ A minor). Both share the same notes and key signature.

## Common progressions (Nashville numbers)
| Name | Numbers | In G |
|---|---|---|
| Three-chord | I–IV–V | G–C–D |
| Pop axis | I–V–vi–IV | G–D–Em–C |
| 50s / doo-wop | I–vi–IV–V | G–Em–C–D |
| Minor start | vi–IV–I–V | Em–C–G–D |
| Jazz turnaround | ii–V–I | Am7–D7–Gmaj7 |
| Circle | I–vi–ii–V | G–Em–Am–D |
| 12-bar blues | I I I I · IV IV I I · V IV I V | Usually all dominant 7ths: G7 C7 D7 |
| Andalusian (minor) | i–bVII–bVI–V | Am–G–F–E |

## Chord formulas
| Type | Symbol | Formula |
|---|---|---|
| Major | C | 1 3 5 |
| Minor | Cm | 1 b3 5 |
| Diminished | C° | 1 b3 b5 |
| Augmented | C+ | 1 3 #5 |
| Sus2 / Sus4 | Csus2 / Csus4 | 1 2 5 / 1 4 5 |
| Power | C5 | 1 5 |
| Major 7 | Cmaj7 | 1 3 5 7 |
| Dominant 7 | C7 | 1 3 5 b7 |
| Minor 7 | Cm7 | 1 b3 5 b7 |
| Half-diminished | Cm7b5 / Cø | 1 b3 b5 b7 |
| Diminished 7 | C°7 | 1 b3 b5 bb7 |
| Add9 | Cadd9 | 1 3 5 9 |
| 6 / m6 | C6 / Cm6 | 1 3 5 6 / 1 b3 5 6 |
| 9 | C9 | 1 3 5 b7 9 |

## Modes (relative to the major scale)
| Mode | Degree | Formula | Sound / use |
|---|---|---|---|
| Ionian | 1 | 1 2 3 4 5 6 7 | Major |
| Dorian | 2 | 1 2 b3 4 5 6 b7 | Minor with a bright 6. Funk, rock, jazz minor |
| Phrygian | 3 | 1 b2 b3 4 5 b6 b7 | Dark, Spanish/metal |
| Lydian | 4 | 1 2 3 #4 5 6 7 | Dreamy major |
| Mixolydian | 5 | 1 2 3 4 5 6 b7 | Dominant. Blues-rock, country |
| Aeolian | 6 | 1 2 b3 4 5 b6 b7 | Natural minor |
| Locrian | 7 | 1 b2 b3 4 b5 b6 b7 | Unstable. Over m7b5 chords |
Other scales: harmonic minor (1 2 b3 4 5 b6 7), melodic minor (1 2 b3 4 5 6 7), minor pentatonic (1 b3 4 5 b7), major pentatonic (1 2 3 5 6), blues (1 b3 4 b5 5 b7).

## Capo math
Each capo fret raises the pitch one semitone, and the shapes keep their names relative to the capo.
- Sounding key = the key of the shape + the capo fret. For example, G shapes with capo 2 sound in A.
- To play in key X using shape key Y, put the capo on fret (X − Y) mod 12. For example, to play in Bb with G shapes: capo 3.
- Common shape keys: G, C, D, E, A.

## CAGED system
The open C, A, G, E, and D chord shapes link up the neck in that order, and each one is a movable voicing of the same chord. C major goes: C shape (open) → A shape (fret 3) → G shape (fret 5) → E shape (fret 8) → D shape (fret 10) → C shape (fret 12). Each chord shape has a matching scale and pentatonic box around it, which is how the app can tie chord lessons to scale lessons.

## Tuning reference (for the tuner)
| String | Note | Freq (Hz, A4 = 440) | MIDI |
|---|---|---|---|
| 6 | E2 | 82.41 | 40 |
| 5 | A2 | 110.00 | 45 |
| 4 | D3 | 146.83 | 50 |
| 3 | G3 | 196.00 | 55 |
| 2 | B3 | 246.94 | 59 |
| 1 | E4 | 329.63 | 64 |
Fretted pitch: MIDI = open-string MIDI + fret. Frequency = 440 × 2^((MIDI − 69)/12).
Common alternate tunings: Drop D (D A D G B E), DADGAD, Open G (D G D G B D), Open D (D A D F# A D), half-step down (Eb Ab Db Gb Bb Eb).
