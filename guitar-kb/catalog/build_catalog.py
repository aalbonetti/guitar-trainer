"""Build the guitar trainer content catalog as JSON, then verify the music data.
Convention: arrays of 6 per-string values are ordered string 6 (low E) -> string 1 (high E).
-1 = muted/not played, 0 = open."""
import json, os, sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
OPEN = [40, 45, 50, 55, 59, 64]  # MIDI of open strings 6..1
NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
PC = {n: i for i, n in enumerate(NOTES)}
PC.update({'Db': 1, 'D#': 3, 'Gb': 6, 'G#': 8, 'A#': 10})
FORMULAS = {  # semitones; 'opt' = may be omitted
    'major': [0, 4, 7], 'minor': [0, 3, 7], '7': [0, 4, 7, 10], 'maj7': [0, 4, 7, 11],
    'm7': [0, 3, 7, 10], 'sus2': [0, 2, 7], 'sus4': [0, 5, 7], 'add9': [0, 4, 7, 2],
    '7sus4': [0, 5, 7, 10], '5': [0, 7], 'm7b5': [0, 3, 6, 10],
}
errors = []

def pcs_of(frets):
    return {(OPEN[i] + f) % 12 for i, f in enumerate(frets) if f >= 0}

def check_chord(cid, root, quality, frets, bass=None):
    exp = {(PC[root] + s) % 12 for s in FORMULAS[quality]}
    got = pcs_of(frets)
    if not got <= exp:
        errors.append(f"{cid}: extra notes {[NOTES[p] for p in got - exp]}")
    required = {PC[root] % 12} | {(PC[root] + s) % 12 for s in FORMULAS[quality][1:2]}  # root + 3rd/sus
    if quality in ('7', 'maj7', 'm7', 'm7b5', '7sus4'):
        required.add((PC[root] + FORMULAS[quality][3]) % 12)
    if not required <= got:
        errors.append(f"{cid}: missing {[NOTES[p] for p in required - got]}")
    low = next(OPEN[i] + f for i, f in enumerate(frets) if f >= 0) % 12
    want_bass = PC[bass] if bass else PC[root]
    if low != want_bass:
        errors.append(f"{cid}: bass is {NOTES[low]}, expected {NOTES[want_bass]}")

# ---------------- chords (curated) ----------------
C = []
def chord(cid, name, root, quality, frets, fingers, tags, bass=None, barre=None, alt_of=None):
    check_chord(cid, root, quality, frets, bass)
    # a finger number only where a fret is pressed, and every pressed fret has a finger (T = thumb is not used here)
    for i, (f, g) in enumerate(zip(frets, fingers)):
        if (f > 0) != (g > 0):
            errors.append(f"{cid}: string {6 - i} fret {f} has finger {g}")
    C.append({k: v for k, v in dict(id=cid, name=name, root=root, quality=quality, bass=bass,
              frets=frets, fingers=fingers, barre=barre, tags=tags, alt_of=alt_of).items() if v is not None})

X = -1
chord('C', 'C', 'C', 'major', [X,3,2,0,1,0], [0,3,2,0,1,0], ['open','beginner'])
chord('A', 'A', 'A', 'major', [X,0,2,2,2,0], [0,0,1,2,3,0], ['open','beginner'])
chord('G', 'G', 'G', 'major', [3,2,0,0,0,3], [2,1,0,0,0,3], ['open','beginner'])
chord('G_4f', 'G (4-finger)', 'G', 'major', [3,2,0,0,3,3], [2,1,0,0,3,4], ['open','worship','g-family'], alt_of='G')
chord('E', 'E', 'E', 'major', [0,2,2,1,0,0], [0,2,3,1,0,0], ['open','beginner'])
chord('D', 'D', 'D', 'major', [X,X,0,2,3,2], [0,0,0,1,3,2], ['open','beginner'])
chord('Am', 'Am', 'A', 'minor', [X,0,2,2,1,0], [0,0,2,3,1,0], ['open','beginner'])
chord('Em', 'Em', 'E', 'minor', [0,2,2,0,0,0], [0,2,3,0,0,0], ['open','beginner'])
chord('Dm', 'Dm', 'D', 'minor', [X,X,0,2,3,1], [0,0,0,2,3,1], ['open','beginner'])
chord('E7', 'E7', 'E', '7', [0,2,0,1,0,0], [0,2,0,1,0,0], ['open'])
chord('A7', 'A7', 'A', '7', [X,0,2,0,2,0], [0,0,2,0,3,0], ['open'])
chord('D7', 'D7', 'D', '7', [X,X,0,2,1,2], [0,0,0,2,1,3], ['open'])
chord('G7', 'G7', 'G', '7', [3,2,0,0,0,1], [3,2,0,0,0,1], ['open'])
chord('B7', 'B7', 'B', '7', [X,2,1,2,0,2], [0,2,1,3,0,4], ['open'])
chord('C7', 'C7', 'C', '7', [X,3,2,3,1,0], [0,3,2,4,1,0], ['open'])
chord('Cmaj7', 'Cmaj7', 'C', 'maj7', [X,3,2,0,0,0], [0,3,2,0,0,0], ['open'])
chord('Fmaj7', 'Fmaj7', 'F', 'maj7', [X,X,3,2,1,0], [0,0,3,2,1,0], ['open','beginner'])
chord('Am7', 'Am7', 'A', 'm7', [X,0,2,0,1,0], [0,0,2,0,1,0], ['open'])
chord('Em7', 'Em7', 'E', 'm7', [0,2,2,0,3,3], [0,1,2,0,3,4], ['open','worship','g-family'])
chord('Em7_simple', 'Em7 (simple)', 'E', 'm7', [0,2,0,0,0,0], [0,2,0,0,0,0], ['open','beginner'], alt_of='Em7')
chord('Cadd9', 'Cadd9', 'C', 'add9', [X,3,2,0,3,3], [0,2,1,0,3,4], ['open','worship','g-family'])
chord('Dsus4', 'Dsus4', 'D', 'sus4', [X,X,0,2,3,3], [0,0,0,1,3,4], ['open','worship','g-family'])
chord('Dsus2', 'Dsus2', 'D', 'sus2', [X,X,0,2,3,0], [0,0,0,1,2,0], ['open','worship','d-drone'])
chord('Asus4', 'Asus4', 'A', 'sus4', [X,0,2,2,3,0], [0,0,1,2,3,0], ['open','worship'])
chord('Asus2', 'Asus2', 'A', 'sus2', [X,0,2,4,0,0], [0,0,1,3,0,0], ['open','worship','e-drone'])
chord('A7sus4', 'A7sus4', 'A', '7sus4', [X,0,2,0,3,0], [0,0,2,0,3,0], ['open','worship','d-drone'])
chord('Bsus4_drone', 'Bsus4', 'B', 'sus4', [X,2,4,4,0,0], [0,1,3,4,0,0], ['worship','e-drone'])
chord('Csharpm7_drone', 'C#m7', 'C#', 'm7', [X,4,6,4,0,0], [0,1,3,2,0,0], ['worship','e-drone'])
chord('G_over_B', 'G/B', 'G', 'major', [X,2,0,0,3,3], [0,1,0,0,3,4], ['worship','d-drone'], bass='B')
chord('F', 'F', 'F', 'major', [1,3,3,2,1,1], [1,3,4,2,1,1], ['barre'], barre={'fret': 1, 'from': 6, 'to': 1})
chord('Bm', 'Bm', 'B', 'minor', [X,2,4,4,3,2], [0,1,3,4,2,1], ['barre'], barre={'fret': 2, 'from': 5, 'to': 1})
chord('Bm_partial', 'Bm (partial, F# in bass)', 'B', 'minor', [X,X,4,4,3,2], [0,0,3,4,2,1], ['beginner'], bass='F#', alt_of='Bm')

# ---------------- movable chord shapes ----------------
# offsets relative to root fret n on root string; -99 = muted
M = -99
SHAPES = [
    ('E_shape_major', 'major', 6, [0,2,2,1,0,0]), ('E_shape_minor', 'minor', 6, [0,2,2,0,0,0]),
    ('E_shape_7', '7', 6, [0,2,0,1,0,0]), ('A_shape_major', 'major', 5, [M,0,2,2,2,0]),
    ('A_shape_minor', 'minor', 5, [M,0,2,2,1,0]), ('A_shape_7', '7', 5, [M,0,2,0,2,0]),
    ('power_r6', '5', 6, [0,2,2,M,M,M]), ('power_r5', '5', 5, [M,0,2,2,M,M]),
    ('maj7_r6', 'maj7', 6, [0,M,1,1,0,M]), ('m7_r6', 'm7', 6, [0,M,0,0,0,M]),
    ('m7b5_r5', 'm7b5', 5, [M,0,1,0,1,M]),
]
shapes_out = []
for sid, q, rs, off in SHAPES:
    # verify at every root fret 1..12
    for n in range(1, 13):
        frets = [n + o if o != M else -1 for o in off]
        root = NOTES[(OPEN[6 - rs] + n) % 12]
        check_chord(f"{sid}@{n}", root, q, frets)
    shapes_out.append(dict(id=sid, quality=q, root_string=rs, offsets=[None if o == M else o for o in off]))

# triads: strings listed low->high within the set; offsets vs a reference fret
TRIADS = []
def triad(tid, root, quality, strings, frets):
    full = [-1] * 6
    for s, f in zip(strings, frets):
        full[6 - s] = f
    exp = {(PC[root] + s) % 12 for s in FORMULAS[quality]}
    if pcs_of(full) != exp:
        errors.append(f"{tid}: notes {[NOTES[p] for p in pcs_of(full)]}")
    TRIADS.append(dict(id=tid, root=root, quality=quality, strings=strings, frets=frets))
triad('tri_321_G_root', 'G', 'major', [3,2,1], [12,12,10])
triad('tri_321_G_inv1', 'G', 'major', [3,2,1], [4,3,3])
triad('tri_321_G_inv2', 'G', 'major', [3,2,1], [7,8,7])
triad('tri_321_Gm_root', 'G', 'minor', [3,2,1], [12,11,10])
triad('tri_321_Gm_inv1', 'G', 'minor', [3,2,1], [3,3,3])
triad('tri_321_Gm_inv2', 'G', 'minor', [3,2,1], [7,8,6])
triad('tri_432_G_root', 'G', 'major', [4,3,2], [5,4,3])
triad('tri_432_G_inv1', 'G', 'major', [4,3,2], [9,7,8])
triad('tri_432_G_inv2', 'G', 'major', [4,3,2], [12,12,12])

# octave shapes: (low string, high string, fret offset)
OCTAVES = [(6,4,2), (5,3,2), (4,2,3), (3,1,3)]
for lo, hi, d in OCTAVES:
    for n in range(0, 13):
        if (OPEN[6-hi] + n + d) - (OPEN[6-lo] + n) != 12:
            errors.append(f"octave {lo}->{hi} wrong")

# ---------------- scales ----------------
SCALE_FORMULAS = {'minor_pentatonic': [0,3,5,7,10], 'major_pentatonic': [0,2,4,7,9],
                  'blues': [0,3,5,6,7,10], 'major': [0,2,4,5,7,9,11]}
SCALES = []
def scale(sid, name, root, kind, position, frets_by_string, root_string_fret=None):
    exp = {(PC[root] + s) % 12 for s in SCALE_FORMULAS[kind]}
    got = set()
    for i, fl in enumerate(frets_by_string):
        for f in fl:
            got.add((OPEN[i] + f) % 12)
    if got != exp:
        errors.append(f"{sid}: notes {sorted(NOTES[p] for p in got)} vs {sorted(NOTES[p] for p in exp)}")
    SCALES.append(dict(id=sid, name=name, root=root, kind=kind, position=position,
                       frets=frets_by_string, movable=True))
A_PENT = [
    [[5,8],[5,7],[5,7],[5,7],[5,8],[5,8]],
    [[8,10],[7,10],[7,10],[7,9],[8,10],[8,10]],
    [[10,12],[10,12],[10,12],[9,12],[10,13],[10,12]],
    [[12,15],[12,15],[12,14],[12,14],[13,15],[12,15]],
    [[15,17],[15,17],[14,17],[14,17],[15,17],[15,17]],
]
for i, p in enumerate(A_PENT, 1):
    scale(f'Am_pent_pos{i}', f'A minor pentatonic, position {i}', 'A', 'minor_pentatonic', i, p)
# G major pentatonic = E minor pentatonic shapes (shift A minor down 5 frets; pos1 at fret 0 → use +12 alt)
for i, p in enumerate(A_PENT, 1):
    shifted = [[f - 5 for f in s] for s in p]
    if min(min(s) for s in shifted) < 0:
        shifted = [[f + 12 for f in s] for s in shifted]
    scale(f'G_major_pent_pos{i}', f'G major pentatonic, position {i}', 'G', 'major_pentatonic', i, shifted)
scale('Am_blues_pos1', 'A blues scale, position 1', 'A', 'blues', 1,
      [[5,8],[5,6,7],[5,7],[5,7,8],[5,8],[5,8]])
scale('G_major_pos2', 'G major scale (root string 6, fret 3)', 'G', 'major', 2,
      [[2,3,5],[2,3,5],[2,4,5],[2,4,5],[3,5],[2,3,5]])

# ---------------- rhythm patterns ----------------
RHYTHM = [
    dict(id='S1_quarters', name='Quarter-note downs', meter='4/4', grid=4, steps=['D','D','D','D'], accents=[], swing=False, level=1),
    dict(id='S2_eighths', name='Straight eighths', meter='4/4', grid=8, steps=['D','U']*4, accents=[2,6], swing=False, level=1),
    dict(id='S3_worship', name='Worship pattern (old faithful)', meter='4/4', grid=8, steps=['D','-','D','U','-','U','D','U'], accents=[2,6], swing=False, level=2),
    dict(id='S4_waltz', name='Hymn waltz', meter='3/4', grid=6, steps=['D','-','D','U','D','U'], accents=[0], swing=False, level=2),
    dict(id='S5_six_eight', name='6/8 hymn feel', meter='6/8', grid=6, steps=['D','D','U','D','D','U'], accents=[0,3], swing=False, level=2),
    dict(id='S6_chunk', name='Percussive chunk on 2 & 4', meter='4/4', grid=8, steps=['D','U','X','U','D','U','X','U'], accents=[2,6], swing=False, level=3, notes='X = muted percussive strum'),
    dict(id='S7_chug', name='Palm-muted eighth chug', meter='4/4', grid=8, steps=['D']*8, accents=[0,4], swing=False, level=2, palm_mute=True),
    dict(id='S8_sixteenths', name='Sixteenth groove', meter='4/4', grid=16, steps=['D','U']*8, accents=[4,12], swing=False, level=3),
    dict(id='S9_whole', name='Whole-note strums (verse)', meter='4/4', grid=4, steps=['D','-','-','-'], accents=[0], swing=False, level=1),
    dict(id='S10_half', name='Half-note strums', meter='4/4', grid=4, steps=['D','-','D','-'], accents=[], swing=False, level=1),
]
for r in RHYTHM:
    assert len(r['steps']) == r['grid'], r['id']

PICKING = [
    dict(id='P1_bass_pinch', name='Bass + pinch', meter='4/4', grid=4,
         steps=[{'p':'root','fingers':[3,2,1]}, {'p':'root'}, {'p':'root','fingers':[3,2,1]}, {'p':'root'}]),
    dict(id='P2_pima', name='PIMA arpeggio', meter='4/4', grid=8,
         steps=[{'p':'root'},{'i':3},{'m':2},{'a':1},{'p':'root'},{'i':3},{'m':2},{'a':1}]),
    dict(id='P3_rolling_34', name='Rolling 3/4', meter='3/4', grid=6,
         steps=[{'p':'root'},{'i':3},{'m':2},{'a':1},{'m':2},{'i':3}]),
    dict(id='P4_travis', name='Travis pattern', meter='4/4', grid=8,
         steps=[{'p':'root'},{'m':2},{'p':'alt_bass'},{'i':3},{'p':'root'},{'m':2},{'p':'alt_bass'},{'i':3}],
         notes='Thumb alternates root and alternate bass every beat. C: 5-4, G: 6-4, D: 4-3'),
]

# ---------------- exercises (tab events) ----------------
def ev(beat, string, fret, dur=0.5, tech=None):
    e = dict(beat=beat, string=string, fret=fret, dur=dur)
    if tech: e['tech'] = tech
    return e

spider = []
b = 0.0
for s in [6,5,4,3,2,1]:
    for f in [1,2,3,4]:
        spider.append(ev(b, s, f)); b += 0.5
EXERCISES = [
    dict(id='EX_spider', name='Spider 1-2-3-4 (ascending)', type='tab', meter='4/4',
         tempo=dict(start=50, target=120, step=4), events=spider, loop=True),
    dict(id='EX_changes_gfamily', name='G-family one-minute changes', type='chord_changes',
         pairs=[['G_4f','Cadd9'],['G_4f','Dsus4'],['Em7','Cadd9'],['Dsus4','Em7']], duration_s=60, target_per_min=30),
    dict(id='EX_changes_open', name='Open-chord one-minute changes', type='chord_changes',
         pairs=[['Em','Am'],['A','D'],['D','G'],['G','C'],['C','Am'],['E','Am'],['D','Dm'],['C','Fmaj7']], duration_s=60, target_per_min=30),
    dict(id='EX_root_pulse_G', name='Root pulse, I–V–vi–IV in G (dotted-eighth delay)', type='tab', meter='4/4',
         tempo=dict(start=72, target=120, step=4), fx=dict(delay='dotted_eighth', feedback=0.3, mix=0.4),
         events=[ev(bar*4 + i*0.5, s, f, tech='palm_mute_light') for bar, (s, f) in enumerate([(4,5),(5,5),(4,2),(5,3)]) for i in range(8)],
         chords=['G','D','Em','C'], loop=True),
    dict(id='EX_triads_I_V_vi_IV_G', name='Top-string triads, I–V–vi–IV in G (nearest voicings)', type='tab', meter='4/4',
         tempo=dict(start=60, target=100, step=4),
         events=[ev(bar*4 + beat, s, f, dur=1.0) for bar, shape in enumerate([[7,8,7],[7,7,5],[9,8,7],[9,8,8]])
                 for beat in range(4) for s, f in zip([3,2,1], shape)],
         chords=['G','D','Em','C'], loop=True),
    dict(id='EX_octaves_G_major', name='G major scale in octaves (strings 4 & 2)', type='tab', meter='4/4',
         tempo=dict(start=60, target=100, step=4),
         events=[e for i, f in enumerate([5,7,9,10,12,14,16,17]) for e in (ev(i*1.0, 4, f, 1.0), ev(i*1.0, 2, f+3, 1.0))],
         loop=False),
]
# verify triad exercise chords and octave scale
for shape, (root, q) in zip([[7,8,7],[7,7,5],[9,8,7],[9,8,8]], [('G','major'),('D','major'),('E','minor'),('C','major')]):
    full = [-1,-1,-1] + shape
    if pcs_of(full) != {(PC[root]+s)%12 for s in FORMULAS[q]}:
        errors.append(f"triad exercise {root}{q} wrong")
gmaj = {(PC['G']+s)%12 for s in SCALE_FORMULAS['major']}
for f in [5,7,9,10,12,14,16,17]:
    if (OPEN[2]+f) % 12 not in gmaj: errors.append(f"octave ex fret {f} not in G major")
for s, f in [(4,5),(5,5),(4,2),(5,3)]:
    pass
if [NOTES[(OPEN[6-s]+f)%12] for s, f in [(4,5),(5,5),(4,2),(5,3)]] != ['G','D','E','C']:
    errors.append('root pulse roots wrong')

# ---------------- songs (public domain) ----------------
SONGS = [dict(
    id='SONG_amazing_grace', title='Amazing Grace', words='John Newton (1779)', tune='NEW BRITAIN (trad., arr. 1835)',
    public_domain=True, meter='3/4', key='G', tempo=80, pickup_beats=1, level='A.11',
    capo_options=[{'key':'A','capo':2,'shapes':'G'}, {'key':'Bb','capo':3,'shapes':'G'}],
    sections=[{'name':'Verse', 'bars':['G','G','C','G','G','G','D','D','G','G7','C','G','G','D','G','G'],
               'numbers':['1','1','4','1','1','1','5','5','1','1(7)','4','1','1','5','1','1'],
               'lyrics':['Amazing grace! How sweet the sound','That saved a wretch like me!',
                         'I once was lost, but now am found;','Was blind, but now I see.']}],
    chords_used=['G','C','D','G7'], rhythm=['S4_waltz','P3_rolling_34'],
    verify='chart reviewed against standard hymnal harmonization before release')]

# ---------------- quiz generators ----------------
QUIZZES = [
    dict(id='Q_open_strings', lesson='F.01', type='generated', prompt='Open string {n} is which note? / Which string is the open {note}?', params=dict(strings=[1,2,3,4,5,6])),
    dict(id='Q_read_diagram', lesson='F.04', type='generated', prompt='Which chord is this diagram?', params=dict(chords=['C','A','G','E','D','Am','Em','Dm','E7','A7','D7','G7','Cadd9','Dsus4'])),
    dict(id='Q_note_names', lesson='F.07', type='generated', prompt='Name the note: string {s}, fret {f}', params=dict(strings=[6,5], frets=[0,12])),
    dict(id='Q_intervals', lesson='T.01', type='generated', prompt='How many semitones is a {interval}?', params=dict(intervals=['m2','M2','m3','M3','P4','TT','P5','m6','M6','m7','M7','P8'])),
    dict(id='Q_diatonic', lesson='T.02', type='generated', prompt='In the key of {key}, what is the {degree} chord?', params=dict(keys=['C','G','D','A','E','F','Bb'], degrees=['ii','iii','IV','V','vi'])),
    dict(id='Q_nashville', lesson='T.03', type='generated', prompt='Play "{numbers}" in {key}: which chords?', params=dict(keys=['G','D','C','A','E'], progressions=['1 5 6m 4','1 4 5','6m 4 1 5','1 6m 4 5','4 1 5 6m'])),
    dict(id='Q_capo', lesson='T.04', type='generated', prompt='Song is in {key}. Using {shapes} shapes, which capo fret?', params=dict(keys=NOTES, shapes=['G','C','D','E','A'])),
    dict(id='Q_delay', lesson='T.07', type='generated', prompt='Dotted-eighth delay at {bpm} BPM, in ms?', params=dict(bpm=[60,140], formula='60000/bpm*0.75', tolerance_ms=5)),
    dict(id='Q_ear_quality', lesson='T.05', type='ear', prompt='Major or minor?', params=dict(qualities=['major','minor'], audio='synth_chord')),
    dict(id='Q_ear_numbers', lesson='T.06', type='ear', prompt='The progression moves from 1 to…?', params=dict(choices=['4','5','6m'], audio='synth_progression')),
]

# ---------------- tracks & lessons ----------------
TRACKS = [
    dict(id='F', name='Foundations', instrument='both', order=0),
    dict(id='A', name='Acoustic Worship', instrument='acoustic', order=1, requires=['F']),
    dict(id='ER', name='Electric Worship Rhythm', instrument='electric', order=2, requires=['F']),
    dict(id='EL', name='Electric Worship Lead', instrument='electric', order=3, requires=['F']),
    dict(id='T', name='Theory & Ear', instrument='both', order=4),
]
def L(id, title, prereqs, pass_, assets=None, instrument=None):
    track = id.split('.')[0]
    d = dict(id=id, track=track, title=title, prereqs=prereqs, pass_criteria=pass_,
             assets=assets or {}, content=f'content/{id}.md', review_days=[1,3,7,14,30])
    return d
P = lambda t, **k: dict(type=t, **k)
LESSONS = [
    L('F.01','Parts, strings & standard tuning',[],P('quiz',score=0.9),{'quizzes':['Q_open_strings']}),
    L('F.02','Tuning',['F.01'],P('pitch',cents=5,scope='all_strings')),
    L('F.03','Posture, fret hand, pick grip',['F.01'],P('self_check')),
    L('F.04','Reading chord diagrams, tab & charts',['F.01'],P('quiz',score=0.9),{'quizzes':['Q_read_diagram']}),
    L('F.05','Spider warm-up',['F.03'],P('timing',bpm=60,subdivision=8,max_err_ms=50,bars=4),{'exercises':['EX_spider']}),
    L('F.06','Playing with a click',['F.03'],P('timing',bpm=70,subdivision=4,max_err_ms=50,bars=8),{'rhythm':['S1_quarters']}),
    L('F.07','Note names on strings 6 & 5',['F.04'],P('quiz',score=0.9,max_s=3),{'quizzes':['Q_note_names']}),
    L('A.01','Em & G',['F.06'],P('changes_per_min',target=30,pair=['Em','G']),{'chords':['Em','G','G_4f']}),
    L('A.02','The G family',['A.01'],P('changes_per_min',target=30),{'chords':['G_4f','Cadd9','Dsus4','Em7'],'exercises':['EX_changes_gfamily']}),
    L('A.03','D family',['A.01'],P('changes_per_min',target=25),{'chords':['D','A','Asus4','A7sus4','Bm_partial']}),
    L('A.04','C family',['A.01'],P('changes_per_min',target=25),{'chords':['C','Am','Fmaj7','G'],'exercises':['EX_changes_open']}),
    L('A.05','Eighth-note strum, accents on 2 & 4',['A.02'],P('timing',bpm=80,subdivision=8,max_err_ms=40,bars=8),{'rhythm':['S2_eighths']}),
    L('A.06','Worship strum pattern',['A.05'],P('timing',bpm=90,subdivision=8,max_err_ms=40,bars=8),{'rhythm':['S3_worship']}),
    L('A.07','Hymn meters: 3/4 & 6/8',['A.05'],P('timing',bpm=90,subdivision=6,max_err_ms=40,bars=8),{'rhythm':['S4_waltz','S5_six_eight']}),
    L('A.08','Capo & keys',['A.04','T.04'],P('chord_accuracy',ratio=0.9)),
    L('A.09','Dynamics & percussive chunk',['A.06'],P('self_check'),{'rhythm':['S9_whole','S10_half','S6_chunk']}),
    L('A.10','Arpeggio picking for intros',['A.04'],P('timing',bpm=70,subdivision=8,max_err_ms=50,bars=4),{'picking':['P2_pima','P3_rolling_34']}),
    L('A.11','First hymns',['A.07','A.08'],P('chord_accuracy',ratio=0.9),{'songs':['SONG_amazing_grace']}),
    L('A.12','Intro to barre chords',['A.06'],P('chord_accuracy',ratio=0.8),{'chords':['F','Bm'],'shapes':['E_shape_major','A_shape_minor']}),
    L('ER.01','Electric basics: tone, attack, muting',['F.06'],P('self_check')),
    L('ER.02','Power chords & palm-muted chug',['ER.01','F.07'],P('timing',bpm=90,subdivision=8,max_err_ms=40,bars=8),{'shapes':['power_r6','power_r5'],'rhythm':['S7_chug']}),
    L('ER.03','Root pulse + dotted-eighth delay',['ER.02','T.07'],P('timing',bpm=100,subdivision=8,max_err_ms=30,bars=16),{'exercises':['EX_root_pulse_G']}),
    L('ER.04','Triads on strings 3-2-1',['ER.02'],P('changes_per_min',target=20),{'triads':['tri_321_G_root','tri_321_G_inv1','tri_321_G_inv2','tri_321_Gm_root','tri_321_Gm_inv1','tri_321_Gm_inv2'],'exercises':['EX_triads_I_V_vi_IV_G']}),
    L('ER.05','Triads on strings 4-3-2',['ER.04'],P('chord_accuracy',ratio=0.9),{'triads':['tri_432_G_root','tri_432_G_inv1','tri_432_G_inv2']}),
    L('ER.06','Drone voicings (keys of E & D)',['ER.04'],P('changes_per_min',target=25),{'chords':['E','Asus2','Bsus4_drone','Csharpm7_drone','D','Dsus2','A7sus4','G_over_B','Em7']}),
    L('ER.07','Swells & pads',['ER.01'],P('self_check')),
    L('ER.08','Song dynamics map',['ER.03','ER.04'],P('self_check')),
    L('ER.09','Full barre chords for big choruses',['ER.02'],P('chord_accuracy',ratio=0.9),{'shapes':['E_shape_major','E_shape_minor','A_shape_major','A_shape_minor']}),
    L('ER.10','Sixteenth muted groove',['ER.03'],P('timing',bpm=90,subdivision=16,max_err_ms=30,bars=8),{'rhythm':['S8_sixteenths']}),
    L('ER.11','Playing from number charts',['ER.04','T.03'],P('chord_accuracy',ratio=0.9),{'quizzes':['Q_nashville']}),
    L('EL.01','Major pentatonic, position 1',['F.07'],P('timing',bpm=80,subdivision=8,max_err_ms=40,bars=4),{'scales':['G_major_pent_pos2']}),
    L('EL.02','Relative minor pentatonic + positions 2 & 5',['EL.01'],P('timing',bpm=80,subdivision=8,max_err_ms=40,bars=4),{'scales':['Am_pent_pos1','Am_pent_pos2','Am_pent_pos5']}),
    L('EL.03','Hammer-ons, pull-offs, slides',['EL.01'],P('timing',bpm=70,subdivision=8,max_err_ms=50,bars=4)),
    L('EL.04','Octave melodies',['EL.01','ER.04'],P('pitch',note_accuracy=0.9),{'exercises':['EX_octaves_G_major']}),
    L('EL.05','Bends & vibrato',['EL.03'],P('pitch',cents=15)),
    L('EL.06','Double stops: 3rds & 6ths',['EL.04'],P('pitch',note_accuracy=0.9)),
    L('EL.07','Hymn melody as a lead line',['EL.04'],P('pitch',note_accuracy=0.9),{'songs':['SONG_amazing_grace']}),
    L('EL.08','Lead lines with dotted-eighth delay',['EL.07','ER.03'],P('timing',bpm=100,subdivision=8,max_err_ms=30,bars=8)),
    L('EL.09','Major scale + chord-tone targeting',['EL.02','T.02'],P('quiz',score=0.9),{'scales':['G_major_pos2']}),
    L('EL.10','Writing intro & tag hooks',['EL.07'],P('self_check')),
    L('EL.11','Ambient lead: harmonics & swells',['ER.07','EL.05'],P('pitch',note_accuracy=0.9)),
    L('T.01','Intervals & the fretboard',['F.07'],P('quiz',score=0.9),{'quizzes':['Q_intervals']}),
    L('T.02','Major scale & diatonic chords',['T.01'],P('quiz',score=0.9),{'quizzes':['Q_diatonic']}),
    L('T.03','Nashville Number System',['T.02'],P('quiz',score=0.9),{'quizzes':['Q_nashville']}),
    L('T.04','Capo math & transposing',['T.01'],P('quiz',score=0.9),{'quizzes':['Q_capo']}),
    L('T.05','Ear: major vs minor',['F.06'],P('quiz',score=0.85),{'quizzes':['Q_ear_quality']}),
    L('T.06','Ear: hearing 1-4-5-6m movement',['T.03','T.05'],P('quiz',score=0.8),{'quizzes':['Q_ear_numbers']}),
    L('T.07','Tempo, subdivision & delay time',['F.06'],P('quiz',score=0.9),{'quizzes':['Q_delay']}),
]

# ---------------- reference validation ----------------
ids = {
    'chords': {c['id'] for c in C}, 'shapes': {s['id'] for s in shapes_out}, 'triads': {t['id'] for t in TRIADS},
    'scales': {s['id'] for s in SCALES}, 'rhythm': {r['id'] for r in RHYTHM}, 'picking': {p['id'] for p in PICKING},
    'exercises': {e['id'] for e in EXERCISES}, 'songs': {s['id'] for s in SONGS}, 'quizzes': {q['id'] for q in QUIZZES},
}
lesson_ids = {l['id'] for l in LESSONS}
for l in LESSONS:
    for p in l['prereqs']:
        if p not in lesson_ids: errors.append(f"{l['id']}: unknown prereq {p}")
    for kind, refs in l['assets'].items():
        for r in refs:
            if r not in ids[kind]: errors.append(f"{l['id']}: unknown {kind} {r}")
for e in EXERCISES:
    for pair in e.get('pairs', []):
        for c in pair:
            if c not in ids['chords']: errors.append(f"{e['id']}: unknown chord {c}")
# cycle check
state = {}
def visit(n):
    if state.get(n) == 1: errors.append(f'cycle at {n}'); return
    if state.get(n) == 2: return
    state[n] = 1
    for p in next(l for l in LESSONS if l['id'] == n)['prereqs']: visit(p)
    state[n] = 2
for l in LESSONS: visit(l['id'])

if errors:
    print('ERRORS:'); print('\n'.join(errors)); sys.exit(1)

meta = dict(schema_version=1, string_order='6_to_1', muted=-1, tuning=dict(standard=['E2','A2','D3','G3','B3','E4'], midi=OPEN))
files = {'meta.json': meta, 'tracks.json': TRACKS, 'lessons.json': LESSONS, 'chords.json': C,
         'shapes.json': dict(movable_chords=shapes_out, triads=TRIADS, octaves=[dict(low_string=a, high_string=b, fret_offset=d) for a, b, d in OCTAVES]),
         'scales.json': SCALES, 'rhythm.json': dict(strumming=RHYTHM, picking=PICKING),
         'exercises.json': EXERCISES, 'songs.json': SONGS, 'quizzes.json': QUIZZES}
for name, data in files.items():
    with open(os.path.join(OUT, name), 'w') as fh:
        json.dump(data, fh, indent=1)
print('OK', {k: (len(v) if isinstance(v, list) else len(v)) for k, v in files.items()})
print('lessons', len(LESSONS), 'chords', len(C), 'scales', len(SCALES), 'exercises', len(EXERCISES))
