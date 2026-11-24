"""Build song_outlines.json: modern worship songs stored as FACTS ONLY
(title, artist, CCLI #, key, BPM, meter, section chord progressions as Nashville numbers,
lesson links, source links). No lyrics, no melody, no signature riffs.
Chords are entered as letter names in the key of the chart they came from, then
converted to numbers relative to that chart key and checked for diatonic fit.
Usage: python3 build_song_outlines.py <catalog_dir>   (run after build_catalog.py)"""
import json, os, re, sys

OUT = sys.argv[1]
NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
PC = {n: i for i, n in enumerate(NOTES)}
PC.update({'Db': 1, 'D#': 3, 'Gb': 6, 'G#': 8, 'A#': 10, 'Cb': 11, 'Fb': 4, 'E#': 5, 'B#': 0})
MAJOR = [0, 2, 4, 5, 7, 9, 11]
DEG = {s: i + 1 for i, s in enumerate(MAJOR)}
DIATONIC_QUAL = {1: 'maj', 2: 'min', 3: 'min', 4: 'maj', 5: 'maj', 6: 'min', 7: 'dim'}
errors, warnings = [], []
CHORD_RE = re.compile(r'^([A-G][b#]?)(.*?)(?:/([A-G][b#]?))?$')

def to_number(chord, key):
    m = CHORD_RE.match(chord)
    if not m:
        errors.append(f'unparseable chord {chord}'); return chord
    root, qual, bass = m.groups()
    iv = (PC[root] - PC[key]) % 12
    minor = qual.startswith('m') and not qual.startswith('maj')
    if iv not in DEG:
        num = {1: 'b2', 3: 'b3', 6: 'b5', 8: 'b6', 10: 'b7'}[iv]
        warnings.append(f'{chord} in {key}: non-diatonic root ({num})')
        deg = None
    else:
        deg = DEG[iv]; num = str(deg)
        expected_minor = DIATONIC_QUAL[deg] == 'min'
        is_sus_or_power = qual.startswith(('sus', '5', '2', '(add', 'add', '(no3'))
        if deg != 7 and not is_sus_or_power and minor != expected_minor:
            warnings.append(f'{chord} in {key}: borrowed quality ({"minor" if minor else "major"} {deg})')
    suffix = qual
    if minor:
        suffix = 'm' + qual[1:]
    if suffix[:1].isdigit():          # G2 -> 4(2), keeps degree and extension distinct
        suffix = f'({suffix})'
    out = num + suffix
    if bass:
        biv = (PC[bass] - PC[key]) % 12
        out += '/' + (str(DEG[biv]) if biv in DEG else spelled_degree(bass, key))
    return out

MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]
def spelled_degree(note, key):
    """Degree of a non-diatonic note, spelled from its letter name: F# in C -> #4, A# in D -> #5, Bb in C -> b7."""
    deg = ('CDEFGAB'.index(note[0]) - 'CDEFGAB'.index(key[0])) % 7 + 1
    diff = ((PC[note] - PC[key]) - MAJOR_STEPS[deg - 1] + 6) % 12 - 6
    return ('#' * diff if diff > 0 else 'b' * -diff) + str(deg)

def song(id, title, artist, ccli, key, bpm, meter, chart_key, sections, practice_for,
         sources, notes=None, chords_verified='full'):
    secs = []
    for name, chords in sections:
        secs.append(dict(name=name, chords_in_chart_key=chords,
                         numbers=[to_number(c, chart_key) for c in chords]))
    # capo suggestions: open-chord shape keys that reach the original key with capo 0-7
    capo = []
    for shape in ['G', 'C', 'D', 'E', 'A']:
        c = (PC[key] - PC[shape]) % 12
        if c <= 7:
            capo.append(dict(shapes=shape, capo=c))
    capo.sort(key=lambda x: x['capo'])
    return dict(id=id, title=title, artist=artist, ccli=ccli, original_key=key, bpm=bpm, meter=meter,
                chart_key=chart_key, sections=secs, capo_options=capo[:3], practice_for=practice_for,
                links=dict(songselect=f'https://songselect.ccli.com/songs/{ccli}' if ccli else None),
                sources=sources, chords_verified=chords_verified, notes=notes,
                content_policy='facts only: no lyrics, melody, or signature riffs')

MT = 'https://www.multitracks.com/songs/'
WT = 'https://www.worshiptogether.com/songs/'
SONGS = [
    song('MS_goodness_of_god', 'Goodness of God', 'Bethel Music / Jenn Johnson', 7117726, 'Ab', 63, '4/4', 'Ab',
         [('Intro', ['Ab', 'Db', 'Ab']),
          ('Verse', ['Ab', 'Db', 'Ab', 'Eb/G', 'Fm', 'Db', 'Eb', 'Fm', 'Db', 'Ab', 'Eb/G', 'Fm', 'Db', 'Eb', 'Ab']),
          ('Chorus', ['Db', 'Ab', 'Db', 'Ab', 'Eb', 'Db', 'Ab', 'Eb/G', 'Fm', 'Db', 'Eb', 'Ab']),
          ('Bridge', ['Ab/C', 'Db', 'Eb', 'Ab', 'Ab/C', 'Db', 'Eb', 'Ab', 'Ab/C', 'Ab', 'Eb', 'Fm', 'Ab/C', 'Db', 'Eb', 'Ab'])],
         ['A.04', 'A.06', 'A.09', 'ER.07', 'EL.04'],
         {'meta': MT + 'Bethel-Music/Victory/Goodness-of-God/', 'chords': WT + 'goodness-of-god-bethel/'}),
    song('MS_build_my_life', 'Build My Life', 'Housefires / Pat Barrett', 7070345, 'G', 70, '4/4', 'G',
         [('Intro/Verse', ['G', 'C/G', 'G/B', 'C/G']),
          ('Chorus', ['Cmaj9', 'Am7', 'G', 'Em7']),
          ('Bridge', ['Cmaj9', 'Dsus', 'Em7', 'G/B'])],
         ['A.02', 'A.05', 'ER.04', 'ER.08'],
         {'meta': WT + 'build-my-life-pat-barrett/', 'chords': WT + 'build-my-life-pat-barrett/'},
         notes='Time signature 4/4 per Musicnotes listing.'),
    song('MS_what_a_beautiful_name', 'What a Beautiful Name', 'Hillsong Worship', 7068424, 'D', 68, '4/4', 'D',
         [('Verse', ['D', 'G', 'Bm', 'A', 'Bm', 'A/C#', 'D', 'G', 'Bm', 'A']),
          ('Chorus', ['D', 'A', 'Bm', 'A', 'G', 'D/F#', 'A', 'Bm', 'A', 'G']),
          ('Instrumental', ['G', 'A', 'Bm', 'F#m', 'G', 'A', 'Bm', 'A'])],
         ['A.03', 'ER.03', 'EL.07'],
         {'meta': MT + 'hillsong-worship/what-a-beautiful-name-(radio-edit)/what-a-beautiful-name-(radio-edit)/',
          'chords': WT + 'what-a-beautiful-name-hillsong-worship/'},
         chords_verified='partial (bridge not captured)'),
    song('MS_10000_reasons', '10,000 Reasons (Bless the Lord)', 'Matt Redman', 6016351, 'G', 72.5, '4/4', 'G',
         [('Intro', ['C', 'G', 'D/F#', 'Em', 'C', 'G', 'Dsus', 'D']),
          ('Chorus', ['C', 'G', 'D', 'Em', 'C', 'G', 'D', 'C', 'Em', 'C', 'D', 'Em', 'C', 'D', 'Gsus', 'G']),
          ('Verse', ['C', 'G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C', 'G', 'D', 'G'])],
         ['A.02', 'A.04', 'A.05', 'T.03'],
         {'meta': MT + 'Matt-Redman/10,000-Reasons/10,000-Reasons/', 'chords': WT + '10-000-reasons-bless-the-lord/'}),
    song('MS_holy_forever', 'Holy Forever', 'Chris Tomlin', 7201044, 'Db', 72, '4/4', 'Db',
         [('Intro', ['Gb', 'Bbm', 'Absus', 'Db/F', 'Bbm', 'Absus']),
          ('Verse', ['Db', 'Gb', 'Db', 'Bbm', 'Ab(add4)', 'Gb2']),
          ('Pre-Chorus', ['Gb2', 'Bbm', 'Ab(add4)', 'Bbm', 'Gb2', 'Gb2', 'Bbm', 'Ab(add4)', 'Bbm', 'Ebm7']),
          ('Chorus', ['Gb2', 'Bbm', 'Ab(add4)', 'Db/F', 'Bbm', 'Ebm7', 'Ab(add4)', 'Db', 'Dbsus', 'Db'])],
         ['A.04', 'A.08', 'ER.04', 'ER.08'],
         {'meta': MT + 'Chris-Tomlin/Always/Holy-Forever/', 'chords': WT + 'holy-forever-chris-tomlin/'}),
    song('MS_gratitude', 'Gratitude', 'Brandon Lake', 7158417, 'B', 78, '6/8', 'B',
         [('Intro', ['B', 'G#m', 'F#', 'E']),
          ('Verse', ['B', 'G#m', 'F#', 'E']),
          ('Chorus', ['B', 'F#', 'E', 'G#m', 'F#', 'B']),
          ('Channel', ['B']),
          ('Channel 2', ['E', 'G#m', 'F#'])],
         ['A.07', 'A.08', 'ER.03', 'ER.08'],
         {'meta': MT + 'Brandon-Lake/House-of-Miracles/Gratitude/', 'chords': WT + 'gratitude-brandon-lake/'},
         notes='WorshipTogether lists 155 BPM (eighth-note count); MultiTracks master is 78 BPM in 6/8. Use 78 dotted-quarter.'),
    song('MS_cornerstone', 'Cornerstone', 'Hillsong Worship', 6158927, 'C', 71.5, '4/4', 'C',
         [('Verse', ['C', 'F', 'G', 'Am', 'Am/G', 'F', 'G', 'C']),
          ('Chorus', ['F', 'Am', 'G', 'F', 'Am', 'G', 'C', 'F', 'Am', 'G', 'C']),
          ('Instrumental', ['C', 'Am', 'F', 'G'])],
         ['A.04', 'A.05', 'ER.04'],
         {'meta': MT + 'Hillsong/Cornerstone/Cornerstone/', 'chords': WT + 'cornerstone-hillsong-worship/'},
         notes='Verse text is the 1834 hymn "My Hope Is Built" (PD); the modern chorus/arrangement is copyrighted (2011).'),
    song('MS_living_hope', 'Living Hope', 'Phil Wickham', 7106807, 'Eb', 72, '4/4', 'E',
         [('Intro', ['E', 'A2', 'E', 'A2']),
          ('Verse', ['E', 'Bsus', 'A2', 'C#m7', 'Bsus', 'E', 'Bsus', 'A2', 'Bsus', 'E']),
          ('Chorus', ['A2', 'E', 'B', 'C#m7', 'A2', 'E', 'B', 'C#m7', 'A2', 'E', 'B', 'C#m7', 'E', 'B', 'A2', 'Bsus', 'B', 'E'])],
         ['A.03', 'A.08', 'EL.07', 'ER.06'],
         {'meta': MT + 'phil-wickham/living-hope/living-hope/', 'chords': 'https://essentialworship.com/songs/phil-wickham/living-hope/'},
         notes='Chart source is in E; original recording is Eb (play E shapes and tune down, or capo 1 with D shapes).'),
    song('MS_way_maker', 'Way Maker', 'Leeland (written by Sinach)', 7115744, 'E', 68, '4/4', 'E',
         [('Verse/Chorus loop', ['A', 'E', 'B', 'C#m'])],
         ['A.06', 'A.08', 'ER.03', 'EL.04'],
         {'meta': MT + 'Leeland/Better-Word/Way-Maker/', 'chords': 'https://www.e-chords.com/chords/leeland/way-maker'},
         notes='4 1 5 6m loop confirmed by three independent charts (E, capo-4 C shapes, capo-2 G shapes).',
         chords_verified='core loop only'),
    song('MS_king_of_kings', 'King of Kings', 'Hillsong Worship', 7127647, 'D', 68, '4/4', 'D',
         [('Intro', ['D(no3)']),
          ('Verse', ['D/F#', 'G', 'A', 'D']),
          ('Chorus', ['D(no3)', 'G2', 'Bm7', 'D/A', 'A', 'D(no3)', 'G2', 'Bm7', 'G2', 'A', 'D(no3)']),
          ('Verse 3', ['Bm', 'G', 'A', 'D'])],
         ['A.03', 'ER.06', 'EL.04', 'ER.08'],
         {'meta': MT + 'hillsong-worship/awake/king-of-kings/', 'chords': WT + 'king-of-kings-hillsong-worship/'}),
    song('MS_firm_foundation', "Firm Foundation (He Won't)", 'Cody Carnes', 7188203, 'Bb', 75, '6/8', 'Bb',
         [('Intro', ['Bb', 'Cm7', 'Bb/D', 'Eb2']),
          ('Verse', ['Bb', 'Gm7', 'F', 'Bbsus', 'Bb', 'Gm7', 'F', 'Eb', 'Bb/D', 'Gm7', 'F']),
          ('Bridge', ['Ebmaj7', 'Bb/D', 'Gm'])],
         ['A.07', 'A.08', 'ER.07'],
         {'meta': MT + "Cody-Carnes/Firm-Foundation-(He-Won't)/Firm-Foundation-(He-Won't)/",
          'chords': WT + 'firm-foundation-he-wont-cody-carnes/'},
         notes='WorshipTogether lists 148 BPM (eighth-note count); master is 75 BPM in 6/8.',
         chords_verified='partial (chorus not captured cleanly)'),
    song('MS_raise_a_hallelujah', 'Raise a Hallelujah', 'Bethel Music', 7119315, 'Db', 82, '4/4', 'G',
         [('Verse', ['G', 'C', 'Em', 'D']),
          ('Bridge', ['G', 'Em', 'D'])],
         ['A.06', 'ER.02', 'ER.10'],
         {'meta': MT + 'bethel-music/victory/raise-a-hallelujah/',
          'chords': 'https://worshipchords.com/pdf/raise-a-hallelujah-chords-key-g-88471.pdf'},
         notes='Chart source in G; original is Db (capo 1 with C shapes, or capo 6 with G shapes).',
         chords_verified='core loops only'),
    song('MS_great_are_you_lord', 'Great Are You Lord', 'All Sons & Daughters', 6460220, 'A', 72, '6/8', 'A',
         [('Verse', ['D', 'F#m', 'E']),
          ('Chorus', ['D', 'F#m', 'E']),
          ('Bridge', ['A', 'Asus4', 'D', 'A'])],
         ['A.02', 'A.07', 'A.08'],
         {'meta': MT + 'all-sons-and-daughters/all-sons-and-daughters-live/great-are-you-lord/',
          'chords': 'https://tabs.ultimate-guitar.com/tab/all-sons-daughters/great-are-you-lord-chords-1401417'},
         notes='With capo 2 and G shapes this becomes Cadd9-Em-D: a G-family song.'),
    song('MS_who_you_say_i_am', 'Who You Say I Am', 'Hillsong Worship', 7102401, 'Gb', 86, '6/8', 'G',
         [('Verse', ['G', 'Em', 'D', 'G', 'G', 'Em', 'D', 'C', 'Em', 'D', 'C']),
          ('Chorus', ['G', 'D', 'Em', 'D', 'C', 'G']),
          ('Bridge', ['Em', 'D/F#', 'G', 'C'])],
         ['A.02', 'A.07', 'ER.05'],
         {'meta': MT + 'hillsong-worship/there-is-more/who-you-say-i-am/', 'chords': WT + 'who-you-say-i-am-hillsong-worship/'},
         notes='Original master is Gb; chart source in G (a half step up) is the common church key.'),
    song('MS_in_christ_alone', 'In Christ Alone', 'Keith Getty & Stuart Townend', 3350395, 'D', 68, '3/4', 'D',
         [('Intro', ['D', 'G2', 'Bm7', 'G2']),
          ('Verse (each half)', ['G', 'D', 'G', 'A', 'D/F#', 'G', 'A', 'D'])],
         ['A.03', 'A.07', 'A.10', 'EL.07'],
         {'meta': MT + 'mtcomplete/In-Christ-Alone/overview/',
          'chords': 'https://tabs.ultimate-guitar.com/tab/keith-getty/in-christ-alone-chords-1161935'},
         notes='No original-master entry on MultiTracks; BPM varies by recording (62-79). Some charts use Bm for the 3rd chord.'),
]

# ---- Worship set list additions, Nov 2026 ----
SONGS += [
    song('MS_love_of_god', 'Love of God', 'Phil Wickham & Brandon Lake', 7241154, 'Gb', 74, '4/4', 'Gb',
         [('Intro', ['Gb', 'Bbm', 'Cb']),
          ('Verse', ['Gb', 'Cb', 'Ebm', 'Dbsus', 'Gb/Bb', 'Cb', 'Gb/Db', 'Db', 'Gb']),
          ('Chorus', ['Gb/Bb', 'Cb', 'Gb', 'Db', 'Ebm7', 'Cb', 'Gb/Bb', 'Dbsus', 'Db', 'Gb/Bb', 'Cb', 'Db', 'Gb', 'Bbm7', 'Cb', 'Ebm7', 'Db', 'Gb'])],
         ['A.08', 'ER.03', 'ER.08', 'EL.07'],
         {'meta': MT + 'Brandon-Lake/Love-of-God/Love-of-God/', 'chords': WT + 'love-of-god-brandon-lake-phil-wickham/'},
         notes='Gb: capo 2 with E shapes or capo 4 with D shapes.'),
    song('MS_o_come_to_the_altar', 'O Come to the Altar', 'Elevation Worship', 7051511, 'B', 70, '6/8', 'B',
         [('Verse', ['B', 'E', 'B', 'E', 'G#m', 'E']),
          ('Chorus', ['B', 'C#m', 'G#m', 'E', 'B'])],
         ['A.07', 'A.08', 'ER.07'],
         {'meta': MT + 'elevation-worship/here-as-in-heaven/o-come-to-the-altar/',
          'chords': 'https://essentialworship.com/?p=1873'},
         notes='B: capo 4 with G shapes (G C Em / G Am Em C G).', chords_verified='verse and chorus'),
    song('MS_reckless_love', 'Reckless Love', 'Cory Asbury', 7089641, 'Gb', 83, '6/8', 'B',
         [('Verse/Chorus loop', ['G#m', 'F#', 'E', 'B'])],
         ['A.07', 'ER.03', 'EL.04'],
         {'meta': MT + 'Cory-Asbury/Reckless-Love/Reckless-Love/charts/',
          'chords': 'https://tabs.ultimate-guitar.com/tab/cory-asbury/reckless-love-chords-2750127'},
         notes='6m 5 4 1 loop throughout; a second chart (Em D C G, tuned down) agrees. Gb original: capo 2 with E shapes = C#m B A E.',
         chords_verified='core loop only'),
    song('MS_blessed_be_your_name', 'Blessed Be Your Name', 'Matt Redman', 3798438, 'Bb', 116, '4/4', 'G',
         [('Verse', ['G', 'D', 'Em', 'C', 'G', 'D', 'C']),
          ('Pre-Chorus', ['G', 'D', 'Em', 'C']),
          ('Chorus', ['G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'D', 'C']),
          ('Bridge', ['G', 'D', 'Em', 'C'])],
         ['A.02', 'A.06', 'ER.02'],
         {'meta': MT + 'Matt-Redman/Coming-Back-To-The-Heart/Blessed-Be-Your-Name/',
          'chords': 'https://tabs.ultimate-guitar.com/tab/matt-redman/blessed-be-your-name-chords-52780'},
         notes='Chart in G; Bb master = capo 3 with G shapes. Methodist Church hymnal chart in Bb matches.'),
    song('MS_glorious_day', 'Glorious Day', 'Passion / Kristian Stanfill', 7081388, 'D', 110, '4/4', 'D',
         [('Verse', ['D', 'Bm', 'G', 'D']),
          ('Chorus (end)', ['G', 'Dsus', 'D'])],
         ['A.03', 'ER.02', 'ER.10'],
         {'meta': MT + 'Passion/Worthy-of-Your-Name/Glorious-Day/overview/',
          'chords': 'https://tabs.ultimate-guitar.com/tab/passion/glorious-day-chords-1928417'},
         notes='Intro/verse often played as single notes on low E (10-7-3 = D-Bm-G roots): a good ER.02 riff exercise.',
         chords_verified='partial'),
    song('MS_holy_is_the_lord', 'Holy Is the Lord', 'Chris Tomlin', 4158039, 'A', 84, '4/4', 'A',
         [('Verse', ['A', 'D2', 'Esus', 'A/C#', 'D2', 'Esus']),
          ('Pre-Chorus', ['B7', 'D']),
          ('Chorus', ['A/C#', 'D2', 'Esus', 'F#m7', 'D2', 'Esus']),
          ('Bridge', ['A', 'E/G#', 'G2', 'D'])],
         ['A.06', 'A.08', 'ER.04'],
         {'meta': WT + 'holy-is-the-lord-chris-tomlin/', 'chords': WT + 'holy-is-the-lord-chris-tomlin/'},
         notes='Key/BPM from WorshipTogether (no MultiTracks check); 4/4 not confirmed by source. B7 = secondary dominant (II7); G2 = borrowed bVII.'),
    song('MS_i_will_follow', 'I Will Follow', 'Chris Tomlin', 5806878, 'Bb', 96, '4/4', 'G',
         [('Chorus', ['Em', 'C', 'G', 'D']),
          ('Verse', ['C', 'Em7', 'D', 'G', 'D', 'C']),
          ('Bridge', ['C', 'G', 'D'])],
         ['A.02', 'A.05', 'A.06', 'ER.02'],
         {'meta': MT + 'Chris-Tomlin/And-If-Our-God-Is-For-Us/I-Will-Follow/',
          'chords': 'https://worshipchords.com/i-will-follow-chords/'},
         notes='Chart in G = capo 3 to Bb (Tomlin plays it this way).'),
]

# ---- Batch 2. CCLI # not captured (None) ----
SONGS += [
    song('MS_hymn_of_heaven', 'Hymn of Heaven', 'Phil Wickham', None, 'E', 71, '4/4', 'D',
         [('Intro', ['D', 'D/F#', 'G', 'Bm7', 'A(add4)']),
          ('Verse', ['D', 'Dsus', 'D', 'Bm7', 'G', 'A(add4)', 'D/F#', 'G', 'D', 'A/C#', 'Bm7', 'G', 'Asus', 'D']),
          ('Chorus', ['D/F#', 'G', 'Asus', 'D', 'D/F#', 'G', 'Bm7', 'Asus', 'D/F#', 'G', 'A', 'D'])],
         ['A.03', 'A.08', 'EL.07', 'ER.08'],
         {'meta': MT + 'Phil-Wickham/Hymn-of-Heaven/Hymn-of-Heaven/', 'chords': WT + 'hymn-of-heaven-bethel-music/'},
         notes='Chart in D; E original = capo 2 with D shapes.'),
    song('MS_at_the_cross_love_ran_red', 'At the Cross (Love Ran Red)', 'Chris Tomlin', None, 'Ab', 73, '4/4', 'G',
         [('Intro', ['Em', 'D/F#', 'G', 'G/B', 'C']),
          ('Verse', ['Em', 'D/F#', 'G', 'G/B', 'C2', 'D(add4)', 'C2', 'D(add4)', 'C2']),
          ('Chorus', ['C2', 'G', 'D', 'Am7', 'C2', 'G', 'D', 'Am7', 'C2', 'G'])],
         ['A.02', 'A.08', 'ER.04'],
         {'meta': MT + 'Chris-Tomlin/Love-Ran-Red/At-The-Cross-(Love-Ran-Red)/overview/',
          'chords': WT + 'at-the-cross-love-ran-red-chris-tomlin/'},
         notes='Chart in G; Ab original = capo 1. G is the common church key (Tomlin live version is in G).'),
    song('MS_amazing_grace_my_chains', 'Amazing Grace (My Chains Are Gone)', 'Chris Tomlin', None, 'G', 63, '4/4', 'D',
         [('Verse', ['D', 'G/D', 'D', 'A/D', 'D', 'D/F#', 'G', 'D', 'A/D', 'D']),
          ('Chorus', ['D/F#', 'G', 'D/F#', 'G/B', 'D/A', 'D/F#', 'G', 'D/F#', 'Em7', 'A7', 'D'])],
         ['A.03', 'A.05', 'EL.07'],
         {'meta': MT + 'chris-tomlin/see-the-morning/amazing-grace-(my-chains-are-gone)/',
          'chords': WT + 'amazing-grace-my-chains-are-gone/'},
         notes='Verses are the PD hymn (Newton); the chorus is Tomlin/Giglio (copyrighted). Links to catalog song SONG_amazing_grace for the hymn melody.'),
    song('MS_everlasting_god', 'Everlasting God', 'Brenton Brown / Chris Tomlin', None, 'B', 100, '4/4', 'G',
         [('Verse', ['G', 'Gsus', 'G', 'Gsus', 'G']),
          ('Pre-Chorus', ['G/B', 'C', 'G/B', 'C', 'D', 'Em', 'D']),
          ('Chorus', ['G', 'C', 'Em', 'C', 'D/C', 'C', 'Am7/C'])],
         ['A.02', 'ER.02', 'ER.10'],
         {'meta': MT + 'MultiTracks/See-the-Morning/Everlasting-God/overview/', 'chords': WT + 'everlasting-god/'},
         notes='No original-master listing found; B at 100-113 BPM across recordings (Tomlin "See the Morning" track used). Chart in G = capo 4.'),
    song('MS_come_as_you_are', 'Come As You Are', 'Crowder', None, 'C', 67.5, '6/8', 'C',
         [('Verse', ['C', 'F', 'C', 'F', 'C', 'G', 'Am', 'G/B', 'C', 'F', 'C', 'F', 'C', 'G', 'Am']),
          ('Chorus', ['Fmaj7', 'C', 'Fmaj7', 'G', 'Gsus', 'G', 'Fmaj7', 'Am', 'Fmaj7', 'G', 'Fmaj7']),
          ('Bridge', ['Am', 'G/B', 'C', 'F', 'C', 'G'])],
         ['A.04', 'A.07', 'ER.07'],
         {'meta': MT + 'Crowder/Neon-Steeple/Come-As-You-Are/', 'chords': WT + 'come-as-you-are-crowder/'},
         notes='All open C-family chords: a great first 6/8 song.'),
    song('MS_all_the_people_said_amen', 'All the People Said Amen', 'Matt Maher', None, 'G', 95, '4/4', 'G',
         [('Intro', ['C2', 'G', 'D']),
          ('Verse', ['C2', 'G', 'D', 'Em', 'C2', 'G', 'D', 'Em', 'Am', 'Em', 'D']),
          ('Chorus', ['G', 'D', 'G', 'C', 'C', 'G', 'D', 'C', 'G', 'B', 'Em', 'C', 'D'])],
         ['A.02', 'A.06', 'ER.02'],
         {'meta': MT + 'Matt-Maher/All-The-People-Said-Amen/All-The-People-Said-Amen/charts/',
          'chords': WT + 'all-the-people-said-amen/'},
         notes='B major in the chorus is a III (secondary dominant of Em): good ear-training moment.'),
]


# ---- Batch 3 (Nov 2026). bpm/meter None = not found in any source; app should tap-tempo or ask ----
WC = 'https://worshipchords.com/'
SONGS += [
    song('MS_this_is_amazing_grace', 'This Is Amazing Grace', 'Phil Wickham', 6333821, 'Bb', None, '4/4', 'G',
         [('Verse', ['G', 'C', 'Em', 'D', 'C']),
          ('Chorus', ['G', 'C', 'Em', 'D', 'G', 'C', 'Em', 'D', 'G'])],
         ['A.02', 'A.06', 'ER.02'],
         {'meta': WC + 'this-is-amazing-grace-chords/', 'chords': WC + 'pdf/this-is-amazing-grace-chords-key-g-4326.pdf'},
         notes='Tempo listed only as "Fast". Bb original = capo 3 with G shapes.'),
    song('MS_o_church_arise', 'O Church Arise', 'Keith Getty & Stuart Townend', None, 'D', 99, None, 'D',
         [('Verse (A)', ['A7sus', 'D', 'G/B', 'A/C#', 'D/F#', 'G', 'Asus', 'A', 'D']),
          ('Verse (B)', ['D/F#', 'G', 'D/F#', 'A', 'D/F#', 'G', 'D/F#', 'Bm', 'A'])],
         ['A.03', 'A.06', 'ER.06'],
         {'meta': 'https://www.weareworship.com/songs/chords/o-church-arise-put-your-armor-on-431/',
          'chords': WC + 'pdf/o-church-arise-chords-key-d-52261.pdf'},
         notes='Modern hymn (2005). Lots of slash-chord bass walking: good for D/F# and A/C# practice.'),
    song('MS_o_praise_the_name', 'O Praise the Name (Anastasis)', 'Hillsong Worship', 7037787, 'C', None, '4/4', 'C',
         [('Intro', ['C', 'Cmaj7/E', 'F']),
          ('Verse', ['C', 'G', 'Am', 'F', 'C/E', 'Gadd4', 'C']),
          ('Chorus', ['C', 'F', 'C', 'Am', 'Gsus', 'G', 'G/B', 'C/E', 'F', 'Am', 'F', 'C/G', 'G', 'C'])],
         ['A.04', 'A.10', 'EL.07'],
         {'meta': WC + 'o-praise-the-name-chords/', 'chords': WC + 'pdf/o-praise-the-name-chords-key-c-14854.pdf'},
         notes='Tempo listed only as "Medium slow".'),
    song('MS_hosanna_praise_is_rising', 'Hosanna (Praise Is Rising)', 'Paul Baloche', 4662491, 'G', 114, '4/4', 'G',
         [('Verse', ['G', 'C', 'G', 'C', 'G']),
          ('Pre-Chorus', ['D', 'C', 'G', 'D', 'C', 'G', 'D']),
          ('Chorus', ['G', 'Em', 'C', 'G', 'D', 'Em', 'C'])],
         ['A.02', 'A.06', 'ER.02'],
         {'meta': WC + 'hosanna-praise-is-rising-chords/',
          'chords': 'https://www.worshiptogether.com/songs/hosanna-praise-is-rising/'},
         notes='Tempo 114 from WeAreWorship.'),
    song('MS_made_for_more', 'Made for More', 'Josh Baldwin', None, 'C', None, None, 'C',
         [('Verse', ['C', 'Am', 'G', 'Am', 'G', 'F', 'C/E', 'G', 'F']),
          ('Chorus', ['C', 'Am', 'G', 'C/E', 'F', 'Dm', 'C', 'Am', 'G', 'C/E', 'F', 'Dm', 'C']),
          ('Bridge', ['C/E', 'F', 'Am', 'G'])],
         ['A.04', 'A.06'],
         {'meta': 'https://www.worshiptogether.com/songs/made-for-more-josh-baldwin/',
          'chords': WC + 'made-for-more-josh-baldwin-chords/'},
         notes='Key taken from the chart (C); original recording key and tempo not confirmed.'),
    song('MS_hear_our_praises', 'Hear Our Praises', 'Hillsong (Reuben Morgan)', 2543402, 'C', None, None, 'C',
         [('Verse', ['C', 'F', 'C', 'G', 'Am', 'F', 'G']),
          ('Chorus', ['C', 'G', 'F', 'Am', 'Em', 'F', 'G'])],
         ['A.04', 'A.06', 'ER.02'],
         {'meta': 'https://www.worshiptogether.com/songs/hear-our-praises/',
          'chords': 'https://essentialworship.com/songs/hillsong-worship/hear-our-praises/'},
         notes='Tempo listed only as "Fast"; key taken from the chart.'),
    song('MS_here_i_am_lord', 'Here I Am, Lord', 'Dan Schutte', None, 'G', None, '4/4', 'G',
         [('Refrain (end)', ['G', 'Am7', 'D', 'G', 'C', 'G'])],
         ['A.02', 'A.10'],
         {'meta': 'https://www.hymnary.org/tune/here_i_am_lord_schutte',
          'chords': 'https://tabs.ultimate-guitar.com/tab/dan-schutte/here-i-am-lord-chords-1854949'},
         notes='1981 hymn (OCP, copyrighted). Licensed via OneLicense (#80670), not CCLI. Only the refrain ending was captured.',
         chords_verified='partial'),
]


# ---- Batch 4 (Nov 2026): metadata from WorshipChords "About This Song" where available ----
SONGS += [
    song('MS_graves_into_gardens', 'Graves Into Gardens', 'Elevation Worship', 7138219, 'B', None, '6/8', 'B',
         [('Intro', ['B', 'E/B', 'B']),
          ('Verse', ['E/B', 'B', 'G#m', 'F#', 'E']),
          ('Chorus', ['B', 'G#m', 'E', 'B']),
          ('Bridge', ['B', 'E', 'B', 'G#m', 'E', 'B'])],
         ['A.07', 'A.08', 'ER.08'],
         {'meta': WC + 'graves-into-gardens-chords/', 'chords': WC + 'graves-into-gardens-chords/'},
         notes='Tempo listed only as "Medium fast". B = capo 4 with G shapes (G, C/G, Em, D, C).'),
    song('MS_here_i_am_to_worship', 'Here I Am to Worship', 'Tim Hughes', None, 'D', None, None, 'D',
         [('Verse', ['D', 'A', 'Em', 'D', 'A', 'G']),
          ('Chorus', ['D', 'A/C#', 'D/F#', 'G']),
          ('Bridge', ['A', 'D/F#', 'G'])],
         ['A.03', 'A.05', 'T.03'],
         {'meta': WC + 'here-i-am-to-worship-chords/', 'chords': WC + 'pdf/here-i-am-to-worship-chords-key-d-1402.pdf'},
         notes='Key taken from the chart (D); original recording key, tempo and meter not confirmed.'),
    song('MS_how_great_is_our_god', 'How Great Is Our God', 'Chris Tomlin', 4348399, 'Db', None, '4/4', 'C',
         [('Verse', ['C', 'Am', 'F']),
          ('Chorus', ['C', 'Am', 'F', 'G', 'C']),
          ('Bridge', ['C', 'Am', 'F', 'G', 'C'])],
         ['A.04', 'A.05', 'A.08'],
         {'meta': WC + 'how-great-is-our-god-chords/', 'chords': WC + 'pdf/how-great-is-our-god-chords-key-c-14421.pdf'},
         notes='Only 4 chords. Db original = capo 1 with C shapes.'),
    song('MS_mighty_to_save', 'Mighty to Save', 'Hillsong Worship', 4591782, 'A', None, '4/4', 'A',
         [('Verse', ['D', 'A', 'F#m', 'E', 'D', 'A', 'F#m', 'E', 'D', 'E', 'D', 'E']),
          ('Chorus', ['A', 'E', 'D', 'A', 'F#m', 'E']),
          ('Bridge', ['D', 'A', 'E', 'A/C#'])],
         ['A.03', 'A.06', 'ER.04'],
         {'meta': WC + 'mighty-to-save-chords/', 'chords': WC + 'mighty-to-save-chords/'},
         notes='Verse starts on the 4 chord. A = capo 2 with G shapes.'),
    song('MS_lead_me_to_the_cross', 'Lead Me to the Cross', 'Hillsong (Brooke Fraser)', 4785828, 'D', None, '4/4', 'D',
         [('Intro/Verse', ['Bm', 'F#/A#', 'G', 'D', 'A/C#']),
          ('Pre-Chorus', ['Em', 'A', 'Bm', 'A', 'G']),
          ('Chorus', ['G', 'A', 'G', 'D', 'A', 'G', 'D', 'A', 'G', 'D', 'A', 'Em', 'G', 'A', 'Bm'])],
         ['A.03', 'A.12', 'ER.06'],
         {'meta': WC + 'lead-me-to-the-cross-chords/', 'chords': WC + 'lead-me-to-the-cross-chords/'},
         notes='Minor-feel verse in D (6m start). Chart prints F#/A; read as F#/A# (V of Bm), confirm against SongSelect.'),
    song('MS_run_to_the_father', 'Run to the Father', 'Cody Carnes', 7133494, 'C', None, '6/8', 'C',
         [('Intro/Verse', ['C', 'Dm7', 'Am7', 'F2']),
          ('Verse end', ['C', 'Dm7', 'Am7', 'G', 'F2']),
          ('Chorus', ['C', 'Dm7', 'Am7', 'F2'])],
         ['A.04', 'A.07', 'ER.07'],
         {'meta': WC + 'run-to-the-father-chords/', 'chords': WC + 'pdf/run-to-the-father-chords-key-c-90444.pdf'},
         notes='One 4-chord loop almost the whole song; tempo listed only as "Medium slow".'),
    song('MS_above_all', 'Above All', 'Lenny LeBlanc & Paul Baloche', None, 'G', None, None, 'G',
         [('Verse', ['G/B', 'C', 'D', 'G', 'G/B', 'C', 'D', 'G', 'D/F#', 'Em', 'D', 'C', 'G/B', 'C', 'Am7', 'B7', 'D', 'G']),
          ('Chorus', ['G', 'C', 'D', 'G', 'G', 'C', 'D', 'G', 'D/F#', 'Em', 'D', 'C', 'G/B', 'C', 'G/B', 'C', 'D', 'G'])],
         ['A.02', 'A.10', 'EL.07'],
         {'meta': 'https://worshipchords.com/above-all/', 'chords': 'https://worshipchords.com/above-all/'},
         notes='Key taken from the chart (G). B7 = III7 (secondary dominant to Em). Lots of walking slash-chord bass.'),
]


# ---- Batch 5 (Nov 2026) ----
SONGS += [
    song('MS_how_deep_the_fathers_love', "How Deep the Father's Love for Us", 'Stuart Townend', 1558110, 'D', None, '3/4', 'E',
         [('Verse', ['E', 'F#m', 'E/G#', 'A', 'E/G#', 'C#m', 'B', 'E', 'F#m', 'E/G#', 'A', 'E/B', 'B', 'E'])],
         ['A.07', 'A.10', 'EL.07'],
         {'meta': WC + 'how-deep-the-fathers-love-for-us-chords/', 'chords': WC + 'how-deep-the-fathers-love-for-us-chords/'},
         notes='Modern hymn (1995) in 3/4, tempo "Slow". Chart is in E; original key D.'),
    song('MS_ancient_words', 'Ancient Words', 'Lynn DeShazo', None, 'E', None, None, 'E',
         [('Verse', ['E', 'B', 'E', 'A', 'B', 'C#m', 'B/D#', 'E', 'E/G#', 'F#m', 'A', 'E', 'B', 'E']),
          ('Chorus (start)', ['A', 'E', 'E/G#', 'B', 'F#m', 'A', 'E/G#', 'A'])],
         ['A.08', 'A.10'],
         {'meta': 'https://worshipchords.com/ancient-words-chords/', 'chords': 'https://worshipchords.com/ancient-words-chords/'},
         notes='Key taken from the chart (E, Robin Mark version); tempo and meter not confirmed.', chords_verified='partial'),
    song('MS_lay_me_down', 'Lay Me Down', 'Chris Tomlin', 6223577, 'C', None, '4/4', 'C',
         [('Verse', ['C', 'G/B', 'Em7', 'D/F#', 'G']),
          ('Chorus', ['C', 'G/B', 'D/F#', 'Em7', 'C', 'G/B', 'D/F#'])],
         ['A.04', 'A.06', 'ER.02'],
         {'meta': 'https://worshipchords.com/lay-me-down/', 'chords': WC + 'pdf/lay-me-down-chords-key-c-21645.pdf'},
         notes='Source lists original key C but the chart is marked "Capo 5" (would sound in F). Confirm with your SongSelect chart.'),
    song('MS_your_grace_is_enough', 'Your Grace Is Enough', 'Chris Tomlin / Matt Maher', 4477026, 'A', None, '4/4', 'G',
         [('Verse', ['G', 'G/B', 'C2', 'Em7', 'D', 'C2']),
          ('Pre-Chorus', ['Am7', 'G/B', 'C2', 'Dsus', 'Em7', 'G']),
          ('Chorus', ['G', 'Dsus', 'Em7', 'C2', 'G', 'Dsus', 'C2'])],
         ['A.02', 'A.06', 'ER.04'],
         {'meta': WC + 'your-grace-is-enough-chords/', 'chords': WC + 'pdf/your-grace-is-enough-chords-key-g-21274.pdf'},
         notes='A original = capo 2 with G shapes.'),
    song('MS_the_wonderful_cross', 'The Wonderful Cross', 'Chris Tomlin / Matt Redman', 3148435, 'D', None, '4/4', 'D',
         [('Verse', ['D5']),
          ('Chorus', ['D', 'G', 'D/F#', 'G', 'D/F#', 'G', 'D/F#', 'A'])],
         ['A.03', 'ER.02', 'ER.07'],
         {'meta': WC + 'the-wonderful-cross-chords/', 'chords': WC + 'the-wonderful-cross-chords/'},
         notes='Verses are Isaac Watts (1707, PD) over a D5 drone: a great power-chord/drone exercise.'),
    song('MS_thank_you_jesus_for_the_blood', 'Thank You Jesus for the Blood', 'Charity Gayle', 7172456, 'Bb', None, '4/4', 'C',
         [('Verse', ['C', 'G/B', 'Am7', 'F', 'C/E', 'Gsus', 'G']),
          ('Chorus', ['C', 'G/B', 'C', 'C/E', 'F', 'C', 'Am', 'G/B', 'C', 'Am', 'Gsus', 'G', 'Am', 'G', 'F', 'C/E', 'F', 'G', 'Am', 'F', 'C', 'Gsus', 'G', 'C'])],
         ['A.04', 'A.09', 'ER.07'],
         {'meta': WC + 'thank-you-jesus-for-the-blood-chords/', 'chords': WC + 'pdf/thank-you-jesus-for-the-blood-chords-key-c-93325.pdf'},
         notes='Descending bass line (1 - 5/7 - 6m) throughout. Chart in C; Bb original.'),
    song('MS_open_the_eyes_of_my_heart', 'Open the Eyes of My Heart', 'Paul Baloche', 2298355, 'E', None, '4/4', 'G',
         [('Verse', ['G', 'D', 'C', 'G']),
          ('Chorus', ['D', 'Em', 'C', 'D', 'Em', 'C', 'D']),
          ('Bridge', ['G', 'D', 'C', 'D', 'G'])],
         ['A.02', 'A.06', 'ER.02'],
         {'meta': WC + 'open-the-eyes-of-my-heart-chords/', 'chords': 'https://worshipchords.com/open-the-eyes-of-my-heart/'},
         notes='Simplified chart in G. E original = capo 4 with C shapes or capo 2 with D shapes.'),
]


# ---- Batch 6 (Nov 2026). Keys from charts unless noted ----
SONGS += [
    song('MS_chain_breaker', 'Chain Breaker', 'Zach Williams', None, 'C', None, None, 'C',
         [('Verse', ['C5', 'Csus', 'C', 'Am', 'Asus', 'Am', 'G', 'Gsus', 'G', 'F', 'F2', 'Gsus', 'G']),
          ('Chorus (start)', ['C', 'F/C', 'C'])],
         ['A.04', 'ER.02', 'ER.10'],
         {'meta': WC + 'chain-breaker-chords/', 'chords': WC + 'chain-breaker-chords/'},
         notes='Bluesy rock; sus-chord embellishments. Original key/tempo not confirmed.', chords_verified='partial'),
    song('MS_change_my_heart_oh_god', 'Change My Heart Oh God', 'Eddie Espinosa', None, 'C', None, None, 'C',
         [('Verse', ['C', 'Am7', 'Dm7', 'Gsus', 'G', 'C']),
          ('Chorus', ['E', 'Esus', 'E', 'Am7', 'Dm7', 'G', 'C', 'E', 'Am7', 'D7', 'G', 'C'])],
         ['A.04', 'A.10', 'T.05'],
         {'meta': WC + 'change-my-heart-oh-god-chords/', 'chords': WC + 'change-my-heart-oh-god-chords/'},
         notes='E major (III) leading to Am and D7 (II7) leading to G are secondary dominants: great ear-training song.'),
    song('MS_come_now_is_the_time', 'Come Now Is the Time to Worship', 'Brian Doerksen', 2430948, 'D', None, '4/4', 'D',
         [('Verse', ['D', 'Dsus', 'D', 'A', 'Em7', 'G']),
          ('Chorus', ['G', 'D', 'G', 'D', 'G', 'Bm', 'G', 'A'])],
         ['A.03', 'A.06'],
         {'meta': WC + 'come-now-is-the-time-to-worship-chords/', 'chords': WC + 'pdf/come-now-is-the-time-to-worship-chords-key-d-1654.pdf'},
         notes='Tempo listed only as "Medium fast".'),
    song('MS_come_thou_fount_come_thou_king', 'Come Thou Fount, Come Thou King', 'Thomas Miller (Gateway)', None, 'D', None, None, 'D',
         [('Intro', ['D', 'Dsus', 'D']),
          ('Verse', ['D', 'A', 'D', 'Dsus', 'D', 'G2', 'B', 'A/C#', 'D']),
          ('Chorus (start)', ['G', 'D/F#', 'G', 'D/F#'])],
         ['A.03', 'A.06', 'EL.07'],
         {'meta': WC + 'come-thou-fount-come-thou-king-chords/', 'chords': WC + 'pdf/come-thou-fount-come-thou-king-chords-key-d-50602.pdf'},
         notes='Verses are the 1758 hymn (PD); the "Come Thou King" chorus is modern and copyrighted. B = VI major (V of ii).',
         chords_verified='partial'),
    song('MS_shine_jesus_shine', 'Shine, Jesus, Shine', 'Graham Kendrick', None, 'G', None, None, 'G',
         [('Verse', ['G', 'C', 'G', 'D', 'G']),
          ('Pre-Chorus', ['C', 'D', 'C', 'Bm', 'Em', 'F', 'Dsus', 'D']),
          ('Chorus', ['G', 'D', 'G', 'C', 'Am', 'G', 'Dsus', 'D'])],
         ['A.02', 'A.06'],
         {'meta': WC + 'shine-jesus-shine-chords/', 'chords': WC + 'pdf/shine-jesus-shine-chords-key-g-50649.pdf'},
         notes='1987. F = borrowed bVII in the "shine on me" build.'),
    song('MS_the_potters_hand', "The Potter's Hand", 'Darlene Zschech (Hillsong)', None, 'G', None, None, 'G',
         [('Verse', ['G', 'D/F#', 'C', 'Cm6', 'Eb', 'Em7', 'Asus', 'A/C#', 'Am7', 'D'])],
         ['A.02', 'EL.09', 'T.05'],
         {'meta': WC + 'the-potters-hand-chords/', 'chords': WC + 'the-potters-hand-chords/'},
         notes='Borrowed Cm6 (iv) and Eb (bVI) give the verse its color; A/C# = II major. Intermediate chord vocabulary.',
         chords_verified='verse only'),
]


# ---- Batch 7 (Nov 2026) ----
SONGS += [
    song('MS_christ_above_me', 'Christ Above Me', 'John Chisum & George Searcy', None, 'G', None, None, 'G',
         [('Chorus', ['G', 'D', 'G', 'C', 'G', 'D', 'E', 'Em7', 'Am7', 'C', 'D', 'G', 'D', 'G', 'D/F#', 'Em7', 'Am7', 'G/B', 'Dsus', 'D', 'G'])],
         ['A.02', 'A.10'],
         {'meta': WC + 'christ-above-me-chords/', 'chords': WC + 'christ-above-me-chords/'},
         notes='Based on the St. Patrick\'s Breastplate text. E major = VI major (secondary dominant to Am).', chords_verified='chorus only'),
    song('MS_for_all_youve_done', "For All You've Done", 'Hillsong (Reuben Morgan)', None, 'E', None, None, 'E',
         [('Verse', ['E', 'Esus', 'E', 'Esus']),
          ('Pre-Chorus', ['C#m7', 'A', 'E', 'B']),
          ('Chorus', ['E', 'B/D#', 'A/C#', 'B', 'E', 'B/D#', 'A/C#', 'B', 'A2', 'B', 'E'])],
         ['A.06', 'A.08', 'ER.03'],
         {'meta': WC + 'for-all-youve-done-chords/', 'chords': WC + 'for-all-youve-done-chords/'},
         notes='Chorus is a descending bass line (1 - 5/7 - 4/6 - 5). Key from chart.'),
    song('MS_more_like_jesus', 'More Like Jesus', 'Passion / Kristian Stanfill', None, 'Bb', None, None, 'Bb',
         [('Intro', ['Bbmaj7', 'Eb']),
          ('Verse', ['Bb', 'Eb', 'Gm', 'F6', 'Eb'])],
         ['A.08', 'ER.07'],
         {'meta': WC + 'more-like-jesus-chords/', 'chords': WC + 'more-like-jesus-chords/'},
         notes='Bb = capo 3 with G shapes. Chorus not captured.', chords_verified='partial'),
    song('MS_sing_wherever_i_go', 'Sing Wherever I Go', 'We The Kingdom', None, 'A', None, None, 'A',
         [('Chorus', ['A', 'D', 'A', 'E', 'F#m', 'D', 'E', 'A']),
          ('Verse', ['F#m', 'D', 'A', 'E']),
          ('Bridge', ['D', 'A'])],
         ['A.03', 'A.06', 'ER.02'],
         {'meta': WC + 'sing-wherever-i-go-chords/', 'chords': WC + 'pdf/sing-wherever-i-go-chords-key-c-91890.pdf'},
         notes='Upbeat folk-pop; key from chart (A). Verse starts on the 6m.'),
]

# Weekly practice song pool (song of the week, Set Ready, Call the Number songs mode): every outline except these.
# Kept in the catalog so the app needs no import; edit this set to change the pool.
NOT_IN_WEEKLY_POOL = {'MS_build_my_life', 'MS_holy_forever', 'MS_gratitude', 'MS_living_hope', 'MS_way_maker',
                      'MS_firm_foundation', 'MS_raise_a_hallelujah', 'MS_great_are_you_lord', 'MS_who_you_say_i_am'}
for s in SONGS:
    s['weekly_pool'] = s['id'] not in NOT_IN_WEEKLY_POOL

# validate lesson refs against lessons.json
lessons = {l['id'] for l in json.load(open(os.path.join(OUT, 'lessons.json')))}
for s in SONGS:
    for l in s['practice_for']:
        if l not in lessons: errors.append(f"{s['id']}: unknown lesson {l}")
    if s['original_key'] not in PC: errors.append(f"{s['id']}: bad key")
if len({s['id'] for s in SONGS}) != len(SONGS): errors.append('duplicate ids')
if errors:
    print('ERRORS'); print('\n'.join(errors)); sys.exit(1)
json.dump(SONGS, open(os.path.join(OUT, 'song_outlines.json'), 'w'), indent=1)

# ---------------- Song Run levels (07-games.md §2, G3) ----------------
# One level per outline, written into games.json (build_catalog.py leaves G_song_run's levels empty for this
# script). A level holds facts only: the outline id, tempo, meter and round length. The chords come from the outline.
# The app grades each chord's family (root + major/minor, so G2, Gsus and G/B all count as G), against the
# song's other families. Mirrors web/src/games/chords.ts (chordFamily, songRunPlan, SONG_BONUS).
def combo_mult(streak): return min(4, 1 + streak // 8)
def run_score(n, bonus, acc=1.0):
    miss_every = round(1 / (1 - acc)) if acc < 1 else 0
    total, streak = 0, 0
    for i in range(n):
        if miss_every and (i + 1) % miss_every == 0: streak = 0; continue
        total += round(100 * bonus * combo_mult(streak)); streak += 1
    return total
def family(chord):
    m = CHORD_RE.match(chord)
    if not m: return None
    root, qual, _ = m.groups()
    return (PC[root], qual.startswith('m') and not qual.startswith('maj'))
PULSES = {'4/4': 4, '3/4': 3, '6/8': 2}     # beats per bar as the click counts them (6/8: two dotted quarters)
SONG_BONUS = 1.6                            # a typical right bar: first right strum ~60–100 ms off the 1
MIN_ROUND_S, MAX_ROUND_S = 30, 180
games_path = os.path.join(OUT, 'games.json')
games = json.load(open(games_path))
sr = next((g for g in games if g['id'] == 'G_song_run'), None)
if not sr: errors.append('games.json has no G_song_run (run build_catalog.py first)')
else:
    levels = []
    for s in SONGS:
        chords = [c for sec in s['sections'] for c in sec['chords_in_chart_key']]
        fams = [family(c) for c in chords]
        if None in fams: errors.append(f"Song Run {s['id']}: a chord doesn't parse"); continue
        if len(set(fams)) < 2: errors.append(f"Song Run {s['id']}: needs at least two different chords"); continue
        meter = s['meter'] or '4/4'
        if meter not in PULSES: errors.append(f"Song Run {s['id']}: meter {meter} not supported"); continue
        bpm = s['bpm'] or 72
        if not 40 <= bpm <= 200: errors.append(f"Song Run {s['id']}: bpm {bpm}"); continue
        bar_s = PULSES[meter] * 60 / bpm
        one = len(chords) * bar_s
        passes = int(max(1, min(4, -(-MIN_ROUND_S // one)))) if one < MIN_ROUND_S else 1
        n = len(chords) * passes
        opts = [o for o, k in (('0.5', 0.5), ('1', 1), ('2', 2)) if n * k * bar_s <= MAX_ROUND_S or o == '1']
        if n * bar_s > MAX_ROUND_S: errors.append(f"Song Run {s['id']}: {round(n * bar_s)} s at one bar per chord (rounds are 3 minutes at most)")
        # a box is at most a bar: ½ bar per chord = one box per chord; 2 bars per chord = two boxes per chord
        targets = {o: run_score(n * (2 if o == '2' else 1), SONG_BONUS, 0.95) // 50 * 50 for o in opts}
        levels.append(dict(id=s['id'], name=s['title'], params=dict(outline=s['id'], bpm=bpm, bpm_known=s['bpm'] is not None,
                           meter=meter, meter_known=s['meter'] is not None, passes=int(passes), bars_per_chord=opts, targets=targets),
                           target_score=targets['1']))
    sr['levels'] = levels
    if errors:
        print('ERRORS'); print('\n'.join(errors)); sys.exit(1)
    json.dump(games, open(games_path, 'w'), indent=1)
    print('Song Run:', len(levels), 'levels')
print('OK', len(SONGS), 'songs')
print('Non-diatonic / borrowed flags:'); print('\n'.join(sorted(set(warnings))) or ' none')
for s in SONGS:
    print(f"{s['title']:<34} {s['original_key']:>3} {str(s['bpm']):>5} {str(s['meter'])}  " +
          ' | '.join(f"{x['name']}: {' '.join(x['numbers'][:8])}" for x in s['sections'][:2]))
