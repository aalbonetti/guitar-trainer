# Sources & Licensing — What the App Can Use

## Approach
I can't be trained or fine-tuned on this material. Instead, these Project docs act as the reference knowledge for building the app, and they double as the app's lesson content. Everything in docs 01–04 is **original writing** based on standard music-theory facts (chord shapes, scales, and intervals are not copyrightable), so the app can use it freely.

## Downloaded / usable open data
| Source | What | License | How to use |
|---|---|---|---|
| **chords-db** (github.com/tombatossals/chords-db) | `lib/guitar.json`: 828 chords, 3,283 voicings, with frets, fingers, barres, baseFret, and MIDI notes. Also ukulele.json and piano.json | **MIT.** Free for commercial use; keep the copyright notice ("Copyright (c) 2016 David Rubert") in the app's licenses screen | Bundle as the full chord library. **Curate the beginner voicings.** Some first-listed voicings are odd or broken (e.g. Em7's first entry has inconsistent frets and fingers, and Cmaj7's first entry has a G in the bass). Use the curated set in doc 02 for lessons |

To fetch it again in a build session: `git clone --depth 1 https://github.com/tombatossals/chords-db.git`

## Other open sources worth considering
| Source | Content | License caveat |
|---|---|---|
| IMSLP / Mutopia Project | Classical guitar studies by Carcassi, Sor, Giuliani, Aguado | The compositions are public domain. Check each **edition**, since modern typeset editions can carry their own copyright. Mutopia files are PD or CC |
| Wikibooks "Guitar" | General method text | CC BY-SA. If you copy it, the share-alike terms apply to that content. Fine for reference, but awkward to ship inside a closed app |
| Traditional / public-domain songs | Song material for lessons | See the list below. Use traditional versions, **not** famous recorded arrangements |

## Public-domain song material for lessons (traditional or very old)
In the US, works published in 1930 or earlier are public domain as of 2026. Still check each specific arrangement.
- **2–3 chord:** Down in the Valley, Tom Dooley, Clementine, He's Got the Whole World, Skip to My Lou, Oh! Susanna
- **3–4 chord:** Amazing Grace, Red River Valley, Home on the Range, When the Saints Go Marching In, Will the Circle Be Unbroken (1907 hymn version), Shenandoah, Swing Low Sweet Chariot
- **Minor / fingerpicking:** Scarborough Fair, Greensleeves, House of the Rising Sun (traditional melody only, *not* the Animals' arrangement), Wayfaring Stranger
- **Melody / single-note reading:** Ode to Joy, Twinkle Twinkle, Danny Boy (Londonderry Air)
- **Hymns:** A Mighty Fortress, Holy Holy Holy, Be Thou My Vision, Come Thou Fount, It Is Well With My Soul, Abide With Me
- **Blues/folk standards:** use original 12-bar exercises rather than recordings

## Modern worship songs: how we handle them (personal-use app)
- **Song outlines** (`catalog/song_outlines.json`) store facts only: title, artist, CCLI number, key, BPM, time signature, section chord progressions as Nashville numbers, and lesson links. Keys, tempos, and time signatures come from MultiTracks' original-master listings. Chord progressions were read from published charts for reference (WorshipTogether, Essential Worship, WorshipChords and a few others) and are checked against the key. The `sources` links in each outline are citations only; no chart content is copied. **No lyrics, melody, or signature riffs are stored.**
- **Full charts** are not in the app (it has no import). Use your own SongSelect/CCLI access and the outline's SongSelect link.
- If the app ever goes public, review this with your own CCLI license or a lawyer.

## Avoid (copyrighted — don't scrape or bundle)
- Lessons and courses from JustinGuitar, Fender Play, Yousician, Marty Music, Guitar Tricks, and similar
- Tabs from Ultimate Guitar or Songsterr, and any tab of a copyrighted song. Printing tabs or lyrics of commercial songs requires a print license from the publisher
- Published method books (Hal Leonard, Berklee, etc.)
- YouTube lesson audio or video
- Modern worship song charts, lyrics, or tabs (CCLI/SongSelect-licensed). Link out to these instead

Linking out to these resources from the app ("watch a lesson on this") is fine. Copying their content into the app is not.
