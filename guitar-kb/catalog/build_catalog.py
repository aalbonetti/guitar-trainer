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
# M8: the nearest-voicing triads of 1–5–6m–4 in G that ER.04's tab exercise plays (3-2-1, around fret 7) and
# that ER.05 asks for on 4-3-2 within frets 2–7. Chord graders build their templates from these exact frets.
triad('tri_321_D_root', 'D', 'major', [3,2,1], [7,7,5])
triad('tri_321_Em_root', 'E', 'minor', [3,2,1], [9,8,7])
triad('tri_321_C_inv1', 'C', 'major', [3,2,1], [9,8,8])
triad('tri_432_D_inv1', 'D', 'major', [4,3,2], [4,2,3])
triad('tri_432_Em_inv1', 'E', 'minor', [4,3,2], [5,4,5])
triad('tri_432_C_inv2', 'C', 'major', [4,3,2], [5,5,5])
# the inversion in a triad's id must match its lowest note (root / 3rd / 5th)
for t in TRIADS:
    full = [-1] * 6
    for s, f in zip(t['strings'], t['frets']): full[6 - s] = f
    low = next(OPEN[i] + f for i, f in enumerate(full) if f >= 0) % 12
    want = {'root': 0, 'inv1': 1, 'inv2': 2}[t['id'].split('_')[-1]]
    if low != (PC[t['root']] + FORMULAS[t['quality']][want]) % 12:
        errors.append(f"{t['id']}: lowest note {NOTES[low]} doesn't match its inversion")

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
def ev(beat, string, fret, dur=0.5, tech=None, bend=None):
    e = dict(beat=beat, string=string, fret=fret, dur=dur)
    if tech: e['tech'] = tech
    if bend: e['bend'] = bend  # semitones the note is bent up (tech='bend')
    return e

# Sounding MIDI of a tab event (what the pitch grader expects to hear). A natural harmonic sounds
# above the open string: fret 12 = +12, fret 7 = +19, fret 5 = +24. A bend's target is fret + bend.
HARMONIC_UP = {12: 12, 7: 19, 5: 24}
def ev_midi(e):
    o = OPEN[6 - e['string']]
    if e.get('tech') == 'harmonic': return o + HARMONIC_UP[e['fret']]
    return o + e['fret'] + (e.get('bend') or 0)

spider = []
b = 0.0
for s in [6,5,4,3,2,1]:
    for f in [1,2,3,4]:
        spider.append(ev(b, s, f)); b += 0.5
EXERCISES = [
    dict(id='EX_spider', name='Spider 1-2-3-4 (ascending)', type='tab', meter='4/4',
         tempo=dict(start=39, target=60, step=4), events=spider, loop=True),
    dict(id='EX_changes_gfamily', name='G-family one-minute changes', type='chord_changes',
         pairs=[['G_4f','Cadd9'],['G_4f','Dsus4'],['Em7','Cadd9'],['Dsus4','Em7']], duration_s=60, target_per_min=30),
    dict(id='EX_changes_open', name='Open-chord one-minute changes', type='chord_changes',
         pairs=[['Em','Am'],['A','D'],['D','G'],['G','C'],['C','Am'],['E','Am'],['D','Dm'],['C','Fmaj7']], duration_s=60, target_per_min=30),
    dict(id='EX_root_pulse_G', name='Root pulse, I–V–vi–IV in G (dotted-eighth delay)', type='tab', meter='4/4',
         tempo=dict(start=65, target=100, step=4), fx=dict(delay='dotted_eighth', feedback=0.3, mix=0.4),
         events=[ev(bar*4 + i*0.5, s, f, tech='palm_mute_light') for bar, (s, f) in enumerate([(4,5),(5,5),(4,2),(5,3)]) for i in range(8)],
         chords=['G','D','Em','C'], loop=True),
    dict(id='EX_triads_I_V_vi_IV_G', name='Top-string triads, I–V–vi–IV in G (nearest voicings)', type='tab', meter='4/4',
         tempo=dict(start=60, target=100, step=4),
         events=[ev(bar*4 + beat, s, f, dur=1.0) for bar, shape in enumerate([[7,8,7],[7,7,5],[9,8,7],[9,8,8]])
                 for beat in range(4) for s, f in zip([3,2,1], shape)],
         chords=['G','D','Em','C'], loop=True),
    dict(id='EX_octaves_G_major', name='G major scale in octaves (strings 4 & 2)', type='tab', meter='4/4',
         tempo=dict(start=65, target=100, step=4),
         events=[e for i, f in enumerate([5,7,9,10,12,14,16,17]) for e in (ev(i*1.0, 4, f, 1.0), ev(i*1.0, 2, f+3, 1.0))],
         loop=False),
    # M7 pitch exercises. No tempo = played at your own pace (the grader waits for each note in order).
    dict(id='EX_bends_G', name='Bends in the G box: whole, whole, half', type='tab', meter='4/4',
         events=[ev(0, 3, 2, 2.0, tech='bend', bend=2), ev(2, 2, 3, 2.0, tech='bend', bend=2), ev(4, 3, 4, 2.0, tech='bend', bend=1)],
         loop=False),
    dict(id='EX_sixths_G_major', name='G major in 6ths (strings 3 & 1)', type='tab', meter='4/4',
         events=[e for i, (a, b) in enumerate([(0,0),(2,2),(4,3),(5,5),(7,7),(9,8),(11,10),(12,12)]) for e in (ev(i*1.0, 3, a, 1.0), ev(i*1.0, 1, b, 1.0))],
         loop=False),
    # Amazing Grace (NEW BRITAIN, public domain), lines 1-2, low octave in the G box. Pickup on beat 3.
    dict(id='EX_amazing_grace_lines12', name='Amazing Grace melody, lines 1–2 (G box)', type='tab', meter='3/4',
         tempo=dict(start=52, target=80, step=4),
         events=[ev(b, s, f, d) for b, s, f, d in [
             (2,5,5,1), (3,4,5,2), (5,3,4,.5), (5.5,4,5,.5), (6,3,4,2), (8,3,2,1), (9,4,5,2), (11,4,2,1), (12,5,5,2),
             (14,5,5,1), (15,4,5,2), (17,3,4,.5), (17.5,4,5,.5), (18,3,4,2), (20,3,2,1), (21,2,3,3)]],
         loop=False),
    dict(id='EX_harmonics_swells', name='Harmonics at frets 12, 7, 5 (strings 3-2-1), then three swelled notes', type='tab', meter='4/4',
         events=[ev(i*2.0, s, f, 2.0, tech='harmonic') for i, (f, s) in enumerate([(f, s) for f in (12, 7, 5) for s in (3, 2, 1)])]
                + [ev(18 + i*2.0, s, f, 2.0, tech='swell') for i, (s, f) in enumerate([(2,3),(2,5),(1,3)])],
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
# pitch exercises: the notes the grader expects must be the music the lesson teaches
EXB = {e['id']: e for e in EXERCISES}
def ex_notes(xid): return [ev_midi(e) for e in EXB[xid]['events']]
oc = EXB['EX_octaves_G_major']['events']
for lo, hi in zip(oc[::2], oc[1::2]):
    if lo['beat'] != hi['beat'] or ev_midi(hi) - ev_midi(lo) != 12: errors.append(f"octave exercise: beat {lo['beat']} is not an octave")
bends = EXB['EX_bends_G']['events']
if [(NOTES[(ev_midi(e) - e['bend']) % 12], NOTES[ev_midi(e) % 12]) for e in bends] != [('A','B'), ('D','E'), ('B','C')]:
    errors.append('bend exercise: should be A->B, D->E, B->C as in EL.05')
for e in bends:
    if e.get('tech') != 'bend' or e.get('bend') not in (1, 2): errors.append(f"bend exercise: bad bend {e}")
sx = EXB['EX_sixths_G_major']['events']
for lo, hi in zip(sx[::2], sx[1::2]):
    a, b = ev_midi(lo), ev_midi(hi)
    if lo['beat'] != hi['beat'] or b - a not in (8, 9) or a % 12 not in gmaj or b % 12 not in gmaj:
        errors.append(f"sixths exercise: beat {lo['beat']} is not a 6th in G major ({a}, {b})")
if [NOTES[ev_midi(e) % 12] for e in sx[::2]] != ['G','A','B','C','D','E','F#','G']:
    errors.append('sixths exercise: lower notes should walk up G major')
# NEW BRITAIN lines 1-2 in G, scale degrees 5 | 1 3 1 3 2 1 6 5 | 5 | 1 3 1 3 2 5(high)
deg = {1:'G', 2:'A', 3:'B', 5:'D', 6:'E'}
ag = ex_notes('EX_amazing_grace_lines12')
if [NOTES[m % 12] for m in ag] != [deg[d] for d in [5,1,3,1,3,2,1,6,5, 5,1,3,1,3,2,5]] or ag[-1] - ag[0] != 12:
    errors.append('Amazing Grace exercise: melody notes wrong')
ag_ev = EXB['EX_amazing_grace_lines12']['events']
if any(abs((a['beat'] + a['dur']) - b['beat']) > 1e-9 for a, b in zip(ag_ev, ag_ev[1:])) or (ag_ev[-1]['beat'] + ag_ev[-1]['dur']) % 3 != 0:
    errors.append('Amazing Grace exercise: rhythm has gaps or does not fill whole 3/4 bars')
hs = EXB['EX_harmonics_swells']['events']
if [ev_midi(e) for e in hs if e.get('tech') == 'harmonic'] != [67, 71, 76, 74, 78, 83, 79, 83, 88]:
    errors.append('harmonics exercise: pitches wrong (fret 12 = +12, 7 = +19, 5 = +24)')

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

# ---------------- chord-graded exercises (M8) ----------------
# A chord ref is a curated chord id ('Cadd9'), a triad id ('tri_321_D_root') or a movable shape at a root fret
# ('A_shape_minor@7'). 'G|G_4f' means either voicing counts (the 3- and 4-finger G). Every ref is resolved here
# to exact frets and written into the exercise as `voicings`, so the chord graders build their templates from
# the voicing the lesson teaches and never have to guess.
CH_BY_ID = {c['id']: c for c in C}
TRI_BY_ID = {t['id']: t for t in TRIADS}
SHAPE_BY_ID = {s[0]: s for s in SHAPES}
QSUF = {'major': '', 'minor': 'm'}
def resolve_one(ref):
    """(name, frets[6], root pc, quality) for one voicing ref, or None."""
    if ref in CH_BY_ID:
        c = CH_BY_ID[ref]
        return c['name'].split(' (')[0], c['frets'], PC[c['root']], c['quality']
    if ref in TRI_BY_ID:
        t = TRI_BY_ID[ref]; full = [-1] * 6
        for s, f in zip(t['strings'], t['frets']): full[6 - s] = f
        return t['root'] + QSUF.get(t['quality'], t['quality']), full, PC[t['root']], t['quality']
    if '@' in ref and ref.split('@')[0] in SHAPE_BY_ID:
        sid, n = ref.split('@'); n = int(n); _, q, rs, off = SHAPE_BY_ID[sid]
        if not 1 <= n <= 12: return None
        root = (OPEN[6 - rs] + n) % 12
        return NOTES[root] + QSUF.get(q, q), [n + o if o != M else -1 for o in off], root, q
    return None
def where_of(frets): return ''.join('x' if f < 0 else (str(f) if f < 10 else f'({f})') for f in frets)
def resolve(ref):
    """Voicing record: display name, every accepted fingering's frets, root and quality."""
    alts = [resolve_one(r) for r in ref.split('|')]
    if any(a is None for a in alts): errors.append(f"chord ref {ref}: unknown voicing"); return None
    if len({(a[2], QCLASS.get(a[3], a[3])) for a in alts}) != 1: errors.append(f"chord ref {ref}: alternatives are different chords")
    name, frets, root, q = alts[0]
    d = dict(name=name, frets=[a[1] for a in alts], where=' or '.join(where_of(a[1]) for a in alts), root=NOTES[root], quality=q)
    first = ref.split('|')[0]
    if first in CH_BY_ID and ' (' in CH_BY_ID[first]['name']:  # 'Bm (partial, F# in bass)' → label 'Bm (partial)'
        d['label'] = f"{name} ({CH_BY_ID[first]['name'].split(' (')[1].rstrip(')').split(',')[0]})"
    return d
# A number's chord may be played with colour tones that keep its 3rd (Cadd9 or Fmaj7 for a major 4, Em7 for 6m);
# sus chords have no 3rd and only stand in for a major chord (the worship G-family Dsus4 as the 5).
QCLASS = {'major': 'major', 'add9': 'major', 'maj7': 'major', 'sus2': 'major', 'sus4': 'major', 'minor': 'minor', 'm7': 'minor', '7': '7', '7sus4': '7'}
NUM_DEG = {'1': (0, 'major'), '2m': (2, 'minor'), '3m': (4, 'minor'), '4': (5, 'major'), '5': (7, 'major'), '6m': (9, 'minor'), '5(7)': (7, '7'), '1(7)': (0, '7')}

def changes(xid, name, pairs, target):
    return dict(id=xid, name=name, type='chord_changes', pairs=pairs, duration_s=60, target_per_min=target)
def progression(xid, name, meter, pace, variants, bpm=None, tempo=None, beats_per_chord=None, strums_per_chord=None, pick='only', show='chords', decoys=(), notes=None, focus=()):
    d = dict(id=xid, name=name, type='chord_progression', meter=meter, pace=pace, pick=pick, show=show, variants=variants)
    for k, v in dict(bpm=bpm, tempo=tempo, beats_per_chord=beats_per_chord, strums_per_chord=strums_per_chord, notes=notes).items():
        if v is not None: d[k] = v
    if decoys: d['decoys'] = list(decoys)
    if focus: d['focus'] = list(focus)  # each of these chords must reach the ratio on its own (the rest is context)
    return d
SHARP_KEYS = {'G', 'D', 'A', 'E', 'B', 'F#', 'C#'}
SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
def spell(pc, key):
    """Note name as written in `key`: sharps in sharp keys (G#m in B, not Abm), flats otherwise."""
    return (SHARPS if key in SHARP_KEYS else NOTES)[pc % 12]
def variant(key, capo, chords, numbers=None, shapes=None, label=None):
    v = dict(key=key, capo=capo, chords=chords)
    if numbers: v['numbers'] = numbers
    if shapes: v['shapes'] = shapes
    v['label'] = label or (f"Key of {key}" + (f", capo {capo}, {shapes} shapes" if capo else (f", {shapes} shapes" if shapes else '')))
    return v

G_SH = dict(shapes='G', chords=['G|G_4f', 'D', 'Em', 'C|Cadd9'])      # 1 5 6m 4 played as G shapes
C_SH = dict(shapes='C', chords=['C', 'G|G_4f', 'Am', 'Fmaj7'])
D_SH = dict(shapes='D', chords=['D', 'A', 'Bm_partial', 'G|G_4f'])
# E and A shapes: the open 6m (C#m, F#m) is a barre, so these play 1–4–1–5 with open chords (B7 for the 5 in E)
E_SH = dict(shapes='E', chords=['E', 'A', 'E', 'B7'], numbers=['1', '4', '1', '5(7)'])
A_SH = dict(shapes='A', chords=['A', 'D', 'A', 'E'], numbers=['1', '4', '1', '5'])
# the A.08 table (content/A.08.md): G, C, D, E and A shapes
CAPO_KEYS = [('A', 2, G_SH), ('Bb', 3, G_SH), ('B', 4, G_SH), ('Db', 1, C_SH), ('Eb', 1, D_SH), ('F', 3, D_SH), ('Ab', 1, G_SH),
             ('F', 1, E_SH), ('Ab', 4, E_SH), ('Bb', 1, A_SH), ('B', 2, A_SH)]
FIVE_SIX_FOUR = ['1', '5', '6m', '4']
# ER.11 neck map (content/ER.11.md): 1 = E-shape on string 6, 4 = A-shape at the same fret, 5 = A-shape 2 frets up,
# 6m = A-shape minor 4 frets up, 2m = E-shape minor 2 frets up.
NECK = {'1': ('E_shape_major', 0), '4': ('A_shape_major', 0), '5': ('A_shape_major', 2), '6m': ('A_shape_minor', 4), '2m': ('E_shape_minor', 2)}
CHART = ['1', '5', '6m', '4', '1', '4', '2m', '5']
def neck_variant(key):
    r6 = (PC[key] - OPEN[0]) % 12 or 12
    return variant(key, 0, [f"{NECK[n][0]}@{r6 + NECK[n][1]}" for n in CHART], numbers=CHART)
AG = SONGS[0]
M8_EXERCISES = [
    changes('EX_changes_em_g', 'Em ↔ G one-minute changes', [['Em', 'G|G_4f']], 30),
    changes('EX_changes_dfamily', 'D-family one-minute changes', [['D', 'A'], ['D', 'Bm_partial']], 25),
    changes('EX_changes_cfamily', 'C-family one-minute changes', [['C', 'Am'], ['C', 'Fmaj7'], ['G|G_4f', 'C']], 25),
    changes('EX_changes_triads_G', 'Triad changes on strings 3-2-1, 1–5–6m–4 in G',
            [['tri_321_G_inv2', 'tri_321_D_root'], ['tri_321_D_root', 'tri_321_Em_root'], ['tri_321_Em_root', 'tri_321_C_inv1'], ['tri_321_C_inv1', 'tri_321_G_inv2']], 20),
    changes('EX_changes_drone', 'Drone-voicing one-minute changes (keys of E and D)',
            [['E', 'Bsus4_drone'], ['Csharpm7_drone', 'Asus2'], ['D', 'G_over_B'], ['Em7', 'A7sus4']], 25),
    progression('EX_capo_keys', 'Capo to the leader’s key: 1–5–6m–4 twice', '4/4', 'own',
                [variant(k, c, sh['chords'] * 2, numbers=sh.get('numbers', FIVE_SIX_FOUR) * 2, shapes=sh['shapes']) for k, c, sh in CAPO_KEYS],
                strums_per_chord=4, pick='random', notes='The leader names a key; put the capo on and play the shapes shown.'),
    progression('EX_amazing_grace_chords', 'Amazing Grace chords (waltz strum, one bar per chord)', AG['meter'], 'timed',
                [variant(k, c, list(AG['sections'][0]['bars']), numbers=AG['sections'][0]['numbers'], shapes='G')
                 for k, c in [('G', 0), ('A', 2), ('Bb', 3)]],
                tempo=dict(start=52, target=80, step=4), beats_per_chord=3, pick='choose'),
    progression('EX_barre_F_Bm', 'F and Bm barres in context: C–Am–F–G, then D–Bm–G–A (each twice)', '4/4', 'own',
                [variant('C', 0, ['C', 'Am', 'F', 'G'] * 2 + ['D', 'Bm', 'G', 'A'] * 2, label='C–Am–F–G and D–Bm–G–A')], strums_per_chord=4,
                decoys=['Fmaj7', 'Bm_partial'], focus=['F', 'Bm'],
                notes='Only the F and Bm strums are graded, and each needs the goal on its own. The app listens for the barre’s low root, so Fmaj7 or the partial Bm doesn’t count.'),
    progression('EX_triads_432_G', 'Triads on strings 4-3-2: 1–5–6m–4 in G', '4/4', 'timed',
                [variant('G', 0, ['tri_432_G_root', 'tri_432_D_inv1', 'tri_432_Em_inv1', 'tri_432_C_inv2'] * 2, numbers=FIVE_SIX_FOUR * 2)],
                bpm=70, beats_per_chord=4),
    progression('EX_barre_progression_G', 'Barre chords: 1–5–6m–4 in G (G E-shape 3, D A-shape 5, Em A-shape 7, C A-shape 3)', '4/4', 'timed',
                [variant('G', 0, ['E_shape_major@3', 'A_shape_major@5', 'A_shape_minor@7', 'A_shape_major@3'] * 2, numbers=FIVE_SIX_FOUR * 2)],
                bpm=80, beats_per_chord=4),
    progression('EX_number_chart', 'Number chart in a key named on the spot (barre shapes)', '4/4', 'own',
                [neck_variant(k) for k in ['G', 'A', 'Bb', 'B', 'C', 'F']], strums_per_chord=4, pick='random', show='numbers',
                notes='Only the numbers and the key are shown. Play them as barre chords from the neck map.'),
]
# resolve every voicing and check the music: chords of a variant are the numbers in its key, as they sound with
# the capo on (shape root + capo), and the shapes played are the ones the variant names
EXERCISES.extend(M8_EXERCISES)
for x in [e for e in EXERCISES if e['type'] in ('chord_changes', 'chord_progression')]:
    refs = [r for p in x.get('pairs', []) for r in p] + [r for v in x.get('variants', []) for r in v['chords']] + list(x.get('decoys', []))
    x['voicings'] = {r: v for r in dict.fromkeys(refs) for v in [resolve(r)] if v}
    for v in x.get('variants', []):
        # chord names as written in this key (the shapes' own names with a capo: you play G shapes, not A shapes)
        nm = {}
        for r_ in dict.fromkeys(v['chords']):
            vo = x['voicings'].get(r_)
            if not vo or v['capo']: continue
            pc = PC[vo['root']]; want = spell(pc, v['key'])
            for alt in {NOTES[pc], SHARPS[pc]}:
                if alt != want and vo['name'].startswith(alt): nm[r_] = want + vo['name'][len(alt):]
        if nm: v['names'] = nm
        if v.get('numbers') and len(v['numbers']) != len(v['chords']): errors.append(f"{x['id']} {v['key']}: numbers and chords differ in length")
        for i, r in enumerate(v['chords']):
            vo = x['voicings'].get(r)
            if not vo: continue
            if v.get('numbers'):
                deg, q = NUM_DEG[v['numbers'][i]]
                sounding = (PC[vo['root']] + v['capo']) % 12
                if sounding != (PC[v['key']] + deg) % 12 or QCLASS.get(vo['quality']) != q:
                    errors.append(f"{x['id']} key {v['key']} capo {v['capo']}: {r} sounds {NOTES[sounding]}{vo['quality']}, but {v['numbers'][i]} is {NOTES[(PC[v['key']] + deg) % 12]}{q}")
            if v.get('shapes') and v['capo'] and vo['root'] not in ({'G': ['G', 'C', 'D', 'E', 'B'], 'C': ['C', 'G', 'A', 'F'], 'D': ['D', 'A', 'B', 'G'], 'E': ['E', 'A', 'B'], 'A': ['A', 'D', 'E']}[v['shapes']]):
                errors.append(f"{x['id']}: {r} isn't one of the {v['shapes']} shapes")
    if x['type'] == 'chord_progression':
        if x['pace'] == 'timed' and (('bpm' in x) == ('tempo' in x) or not x.get('beats_per_chord')): errors.append(f"{x['id']}: timed needs beats_per_chord and either bpm (fixed) or tempo (ladder)")
        if x['pace'] == 'own' and not x.get('strums_per_chord'): errors.append(f"{x['id']}: own pace needs strums_per_chord")
        if x['pace'] not in ('timed', 'own') or x['pick'] not in ('only', 'random', 'choose') or x['show'] not in ('chords', 'numbers'): errors.append(f"{x['id']}: bad pace/pick/show")
        if x['pick'] == 'only' and len(x['variants']) != 1: errors.append(f"{x['id']}: pick 'only' needs one variant")
        if x['show'] == 'numbers' and not all(v.get('numbers') for v in x['variants']): errors.append(f"{x['id']}: a number chart needs numbers")
        for d in x.get('decoys', []):
            if d in [r for v in x['variants'] for r in v['chords']]: errors.append(f"{x['id']}: decoy {d} is also in the progression")
        for f in x.get('focus', []):
            if any(v['chords'].count(f) < 2 for v in x['variants']): errors.append(f"{x['id']}: focus chord {f} should come at least twice in every variant")
# Amazing Grace's chord exercise is the song's own bars
if [b for b in M8_EXERCISES if b['id'] == 'EX_amazing_grace_chords'][0]['variants'][0]['chords'] != AG['sections'][0]['bars']:
    errors.append('Amazing Grace chord exercise: bars differ from the song')

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
    L('A.01','Em & G',['F.06'],P('changes_per_min',target=30,pair=['Em','G']),{'chords':['Em','G','G_4f'],'exercises':['EX_changes_em_g']}),
    L('A.02','The G family',['A.01'],P('changes_per_min',target=30),{'chords':['G_4f','Cadd9','Dsus4','Em7'],'exercises':['EX_changes_gfamily']}),
    L('A.03','D family',['A.01'],P('changes_per_min',target=25),{'chords':['D','A','Asus4','A7sus4','Bm_partial'],'exercises':['EX_changes_dfamily']}),
    L('A.04','C family',['A.01'],P('changes_per_min',target=25),{'chords':['C','Am','Fmaj7','G'],'exercises':['EX_changes_cfamily']}),
    L('A.05','Eighth-note strum, accents on 2 & 4',['A.02'],P('timing',bpm=80,subdivision=8,max_err_ms=40,bars=8),{'rhythm':['S2_eighths']}),
    L('A.06','Worship strum pattern',['A.05'],P('timing',bpm=90,subdivision=8,max_err_ms=40,bars=8),{'rhythm':['S3_worship']}),
    L('A.07','Hymn meters: 3/4 & 6/8',['A.05'],P('timing',bpm=90,subdivision=6,max_err_ms=40,bars=8),{'rhythm':['S4_waltz','S5_six_eight']}),
    L('A.08','Capo & keys',['A.04','T.04'],P('chord_accuracy',ratio=0.9),{'exercises':['EX_capo_keys']}),
    L('A.09','Dynamics & percussive chunk',['A.06'],P('self_check'),{'rhythm':['S9_whole','S10_half','S6_chunk']}),
    L('A.10','Arpeggio picking for intros',['A.04'],P('timing',bpm=70,subdivision=8,max_err_ms=50,bars=4),{'picking':['P2_pima','P3_rolling_34']}),
    L('A.11','First hymns',['A.07','A.08'],P('chord_accuracy',ratio=0.9,bpm=80),{'songs':['SONG_amazing_grace'],'chords':['G','C','D','G7'],'exercises':['EX_amazing_grace_chords']}),
    L('A.12','Intro to barre chords',['A.06'],P('chord_accuracy',ratio=0.8),{'chords':['F','Bm'],'shapes':['E_shape_major','A_shape_minor'],'exercises':['EX_barre_F_Bm']}),
    L('ER.01','Electric basics: tone, attack, muting',['F.06'],P('self_check')),
    L('ER.02','Power chords & palm-muted chug',['ER.01','F.07'],P('timing',bpm=90,subdivision=8,max_err_ms=40,bars=8),{'shapes':['power_r6','power_r5'],'rhythm':['S7_chug']}),
    L('ER.03','Root pulse + dotted-eighth delay',['ER.02','T.07'],P('timing',bpm=100,subdivision=8,max_err_ms=30,bars=16),{'exercises':['EX_root_pulse_G']}),
    L('ER.04','Triads on strings 3-2-1',['ER.02'],P('changes_per_min',target=20),{'triads':['tri_321_G_root','tri_321_G_inv1','tri_321_G_inv2','tri_321_Gm_root','tri_321_Gm_inv1','tri_321_Gm_inv2'],'exercises':['EX_triads_I_V_vi_IV_G','EX_changes_triads_G']}),
    L('ER.05','Triads on strings 4-3-2',['ER.04'],P('chord_accuracy',ratio=0.9),{'triads':['tri_432_G_root','tri_432_G_inv1','tri_432_G_inv2','tri_432_D_inv1','tri_432_Em_inv1','tri_432_C_inv2'],'exercises':['EX_triads_432_G']}),
    L('ER.06','Drone voicings (keys of E & D)',['ER.04'],P('changes_per_min',target=25),{'chords':['E','Asus2','Bsus4_drone','Csharpm7_drone','D','Dsus2','A7sus4','G_over_B','Em7'],'exercises':['EX_changes_drone']}),
    L('ER.07','Swells & pads',['ER.01'],P('self_check')),
    L('ER.08','Song dynamics map',['ER.03','ER.04'],P('self_check')),
    L('ER.09','Full barre chords for big choruses',['ER.02'],P('chord_accuracy',ratio=0.9),{'shapes':['E_shape_major','E_shape_minor','A_shape_major','A_shape_minor'],'exercises':['EX_barre_progression_G']}),
    L('ER.10','Sixteenth muted groove',['ER.03'],P('timing',bpm=90,subdivision=16,max_err_ms=30,bars=8),{'rhythm':['S8_sixteenths']}),
    L('ER.11','Playing from number charts',['ER.04','T.03'],P('chord_accuracy',ratio=0.9),{'quizzes':['Q_nashville'],'exercises':['EX_number_chart']}),
    L('EL.01','Major pentatonic, position 1',['F.07'],P('timing',bpm=80,subdivision=8,max_err_ms=40,bars=4),{'scales':['G_major_pent_pos2']}),
    L('EL.02','Relative minor pentatonic + positions 2 & 5',['EL.01'],P('timing',bpm=80,subdivision=8,max_err_ms=40,bars=4),{'scales':['Am_pent_pos1','Am_pent_pos2','Am_pent_pos5']}),
    L('EL.03','Hammer-ons, pull-offs, slides',['EL.01'],P('timing',bpm=70,subdivision=8,max_err_ms=50,bars=4)),
    L('EL.04','Octave melodies',['EL.01','ER.04'],P('pitch',note_accuracy=0.9,bpm=100),{'exercises':['EX_octaves_G_major']}),
    L('EL.05','Bends & vibrato',['EL.03'],P('pitch',cents=15),{'exercises':['EX_bends_G']}),
    L('EL.06','Double stops: 3rds & 6ths',['EL.04'],P('pitch',note_accuracy=0.9),{'exercises':['EX_sixths_G_major']}),
    L('EL.07','Hymn melody as a lead line',['EL.04'],P('pitch',note_accuracy=0.9,bpm=80,any_octave=True),{'songs':['SONG_amazing_grace'],'exercises':['EX_amazing_grace_lines12']}),
    L('EL.08','Lead lines with dotted-eighth delay',['EL.07','ER.03'],P('timing',bpm=100,subdivision=8,max_err_ms=30,bars=8)),
    L('EL.09','Major scale + chord-tone targeting',['EL.02','T.02'],P('quiz',score=0.9),{'scales':['G_major_pos2']}),
    L('EL.10','Writing intro & tag hooks',['EL.07'],P('self_check')),
    L('EL.11','Ambient lead: harmonics & swells',['ER.07','EL.05'],P('pitch',note_accuracy=0.9),{'exercises':['EX_harmonics_swells']}),
    L('T.01','Intervals & the fretboard',['F.07'],P('quiz',score=0.9),{'quizzes':['Q_intervals']}),
    L('T.02','Major scale & diatonic chords',['T.01'],P('quiz',score=0.9),{'quizzes':['Q_diatonic']}),
    L('T.03','Nashville Number System',['T.02'],P('quiz',score=0.9),{'quizzes':['Q_nashville']}),
    L('T.04','Capo math & transposing',['T.01'],P('quiz',score=0.9),{'quizzes':['Q_capo']}),
    L('T.05','Ear: major vs minor',['F.06'],P('quiz',score=0.85),{'quizzes':['Q_ear_quality']}),
    L('T.06','Ear: hearing 1-4-5-6m movement',['T.03','T.05'],P('quiz',score=0.8),{'quizzes':['Q_ear_numbers']}),
    L('T.07','Tempo, subdivision & delay time',['F.06'],P('quiz',score=0.9),{'quizzes':['Q_delay']}),
]


# ---------------- games (07-games.md) ----------------
# G1 ships tap mode for six games, G2 play mode for the single-note games plus Octave Jump, Box Runner and In the
# Pocket; the G3 games are listed so the Arcade shows what's coming.
def lvl(id, name, params, target_score, round_s=None, lives=None, unlock_lesson=None, review_for=None):
    d = dict(id=id, name=name, params=params, target_score=target_score)
    if round_s: d['round_s'] = round_s
    if lives: d['lives'] = lives
    if unlock_lesson: d['unlock_lesson'] = unlock_lesson
    if review_for: d['review_for'] = review_for
    return d
def game(id, name, blurb, unlock_lesson, milestone, levels, review_for=(), modes=('tap',)):
    return dict(id=id, name=name, blurb=blurb, unlock_lesson=unlock_lesson, review_for=list(review_for), modes=list(modes), milestone=milestone, levels=levels)
Z = lambda strings, f0, f1: dict(zone=dict(strings=strings, frets=[f0, f1]))
OPEN_KEYS = ['G', 'D', 'C', 'E', 'A']
ALL_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
GAMES = [
    game('G_note_drop', 'Note Drop', 'Note names fall toward the neck. Tap where that note lives before it lands. 3 misses end the round.', 'F.07', 'G1', [
        lvl('nd1', 'Strings 6 & 5, frets 0–5', {**Z([6, 5], 0, 5), 'speed': 1.0}, 2500, lives=3, review_for=['F.07']),
        lvl('nd2', 'Strings 6 & 5, frets 0–12', {**Z([6, 5], 0, 12), 'speed': 1.0}, 3000, lives=3, review_for=['F.07']),
        lvl('nd3', 'All strings, frets 0–5', {**Z([6, 5, 4, 3, 2, 1], 0, 5), 'speed': 1.0}, 3000, lives=3),
        lvl('nd4', 'Whole neck, frets 0–12', {**Z([6, 5, 4, 3, 2, 1], 0, 12), 'speed': 1.2}, 3500, lives=3),
    ], review_for=['F.07'], modes=('tap', 'play')),
    game('G_fret_finder', 'Fret Finder', 'One note, 20 seconds: tap every place it appears in the zone.', 'T.01', 'G1', [
        lvl('ff1', 'Strings 6–4, frets 0–5', Z([6, 5, 4], 0, 5), 2000, round_s=60, review_for=['T.01']),
        lvl('ff2', 'All strings, frets 0–5', Z([6, 5, 4, 3, 2, 1], 0, 5), 3000, round_s=60, review_for=['T.01']),
        lvl('ff3', 'All strings, frets 0–12', Z([6, 5, 4, 3, 2, 1], 0, 12), 5000, round_s=60, review_for=['T.01']),
    ], review_for=['T.01'], modes=('tap', 'play')),
    game('G_call_the_number', 'Call the Number', 'The band leader calls a number. Tap the chord in this key, fast.', 'T.03', 'G1', [
        lvl('cn1', 'Key of G: 1 4 5 6m', {'keys': ['G'], 'numbers': ['1', '4', '5', '6m']}, 2500, round_s=60, review_for=['T.03']),
        lvl('cn2', 'Open keys: 1 2m 3m 4 5 6m', {'keys': OPEN_KEYS, 'numbers': ['1', '2m', '3m', '4', '5', '6m']}, 2500, round_s=60, review_for=['T.03']),
        lvl('cn3', 'All 12 keys', {'keys': ALL_KEYS, 'numbers': ['1', '2m', '3m', '4', '5', '6m']}, 2000, round_s=60, review_for=['T.03']),
        lvl('cn4', 'Songs: real progressions', {'songs': True, 'numbers': []}, 2500, round_s=90, review_for=['T.03']),
    ], review_for=['T.03'], modes=('tap', 'play')),
    game('G_hear_the_change', 'Hear the Change', 'Hear the 1 chord, then another. Name the number.', 'T.05', 'G1', [
        lvl('hc1', 'Major or minor?', {'numbers': ['major', 'minor']}, 1500, round_s=60, unlock_lesson='T.05', review_for=['T.05']),
        lvl('hc2', '1 4 5 6m', {'numbers': ['1', '4', '5', '6m']}, 1500, round_s=60, unlock_lesson='T.06', review_for=['T.06']),
        lvl('hc3', 'Add 2m and 3m', {'numbers': ['1', '2m', '3m', '4', '5', '6m']}, 1500, round_s=60, unlock_lesson='T.06', review_for=['T.06']),
    ], review_for=['T.05', 'T.06']),
    game('G_capo_quick', 'Capo Quick', 'Capo math against the clock: which fret, or what key is it really in?', 'T.04', 'G1', [
        lvl('cq1', 'Which capo?', {'ask': 'capo', 'keys': ALL_KEYS, 'shapes': OPEN_KEYS}, 2500, round_s=60, review_for=['T.04']),
        lvl('cq2', 'Real key?', {'ask': 'key', 'keys': ALL_KEYS, 'shapes': OPEN_KEYS}, 2500, round_s=60, review_for=['T.04']),
        lvl('cq3', 'Mixed', {'ask': 'mixed', 'keys': ALL_KEYS, 'shapes': OPEN_KEYS}, 2500, round_s=60, review_for=['T.04']),
    ], review_for=['T.04']),
    game('G_delay_math', 'Delay Math', 'A BPM appears: enter the delay time in ms (within ±10).', 'T.07', 'G1', [
        lvl('dm1', 'Dotted eighths, 60–90 BPM', {'bpm': [60, 90], 'notes': ['dotted8']}, 1500, round_s=60, review_for=['T.07']),
        lvl('dm2', 'Dotted eighths, 60–140 BPM', {'bpm': [60, 140], 'notes': ['dotted8']}, 1500, round_s=60, review_for=['T.07']),
        lvl('dm3', 'Quarter, eighth, dotted eighth', {'bpm': [60, 140], 'notes': ['quarter', 'eighth', 'dotted8']}, 1500, round_s=60, review_for=['T.07']),
    ], review_for=['T.07']),
    game('G_triad_hunt', 'Triad Hunt', 'Find the triad on a string set, any inversion.', 'ER.04', 'G3', [], modes=('tap', 'play')),
    # G2. Octave Jump: a note on string 6 or 5; answer with its octave (the shape's high note, 2 strings over and
    # 2 frets up). Play mode checks the exact octave; tap mode is the fallback (07-games.md §1: tap in every game).
    game('G_octave_jump', 'Octave Jump', 'A note on string 6 or 5: play its octave, 2 strings over and 2 frets up, against the clock.', 'EL.04', 'G2', [
        lvl('oj1', 'String 6, frets 0–7, fret shown', {**Z([6], 0, 7), 'show_fret': True}, 4200, round_s=60),
        lvl('oj2', 'Strings 6 & 5, frets 0–7, fret shown', {**Z([6, 5], 0, 7), 'show_fret': True}, 3600, round_s=60),
        lvl('oj3', 'Strings 6 & 5, frets 0–12, note name only', {**Z([6, 5], 0, 12), 'show_fret': False}, 2700, round_s=60, unlock_lesson='F.07'),
    ], modes=('play', 'tap')),
    # Box Runner: the box (scales.json, moved to the key) played as a path to the click; graded per note on pitch
    # (exact octave: the box fixes it) and timing. Play only: tapping in time isn't the same skill.
    game('G_box_runner', 'Box Runner', 'The pentatonic box is shown: play the path in time with the click.', 'EL.01', 'G2', [
        lvl('br1', 'Major box in G, up & down, quarter notes, 70 BPM', {'scale': 'major_pentatonic', 'positions': [2], 'keys': ['G'], 'path': 'updown', 'bpm': 70, 'sub': 1, 'passes': 2}, 14000),
        lvl('br2', 'Major box in G, up & down, eighths, 80 BPM', {'scale': 'major_pentatonic', 'positions': [2], 'keys': ['G'], 'path': 'updown', 'bpm': 80, 'sub': 2, 'passes': 4}, 15500),
        lvl('br3', 'Major box in threes, eighths, 70 BPM (G A C D)', {'scale': 'major_pentatonic', 'positions': [2], 'keys': ['G', 'A', 'C', 'D'], 'path': 'threes', 'bpm': 70, 'sub': 2, 'passes': 2}, 22000),
        lvl('br4', 'Minor box 1, up & down, eighths, 80 BPM (A E G)', {'scale': 'minor_pentatonic', 'positions': [1], 'keys': ['A', 'E', 'G'], 'path': 'updown', 'bpm': 80, 'sub': 2, 'passes': 4}, 15500, unlock_lesson='EL.02'),
        lvl('br5', 'Minor boxes 2 and 5 in A, eighths, 80 BPM', {'scale': 'minor_pentatonic', 'positions': [2, 5], 'keys': ['A'], 'path': 'updown', 'bpm': 80, 'sub': 2, 'passes': 4}, 15500, unlock_lesson='EL.02'),
    ], modes=('play',)),
    # In the Pocket: strum a pattern to the click, graded strum by strum against a window of 1.5 × the lesson's
    # max_err_ms. Gap Click: the click drops out for gap_bars (click_bars of click between gaps); you keep strumming.
    game('G_in_the_pocket', 'In the Pocket', 'Strum to the click; the meter shows ahead or behind. Gap Click: keep time when the click drops out.', 'A.05', 'G2', [
        lvl('pk1', 'Quarter-note downs, 70 BPM', {'pattern': 'S1_quarters', 'bpm': 70, 'bars': 16, 'window_ms': 60}, 19000, unlock_lesson='F.06'),
        lvl('pk2', 'Straight eighths, 80 BPM', {'pattern': 'S2_eighths', 'bpm': 80, 'bars': 16, 'window_ms': 60}, 21000),
        lvl('pk3', 'Gap Click: eighths, 80 BPM, gaps of 1, 2, 4 bars', {'pattern': 'S2_eighths', 'bpm': 80, 'gap_bars': [1, 2, 4], 'click_bars': 2, 'window_ms': 60}, 19500),
        lvl('pk4', 'Worship pattern, 90 BPM', {'pattern': 'S3_worship', 'bpm': 90, 'bars': 16, 'window_ms': 60}, 15500, unlock_lesson='A.06'),
        lvl('pk5', 'Sixteenth groove, 90 BPM', {'pattern': 'S8_sixteenths', 'bpm': 90, 'bars': 12, 'window_ms': 45}, 16500, unlock_lesson='ER.10'),
    ], modes=('play',)),
    game('G_change_sprint', 'Change Sprint', '60 seconds of chord changes. Race your best run.', 'A.01', 'G3', [], modes=('play',)),
    game('G_song_run', 'Song Run', 'The boss level: play a set-list song bar by bar at its tempo.', 'A.05', 'G3', [], modes=('play',)),
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
# A timing lesson's exercise tempo must match its tempo ladder (app spec §5): start at 65% of the goal, end at the goal.
EX_BY_ID = {e['id']: e for e in EXERCISES}
for l in LESSONS:
    pc = l['pass_criteria']
    if pc['type'] != 'timing' and not (pc['type'] == 'pitch' and 'bpm' in pc): continue
    for x in l['assets'].get('exercises', []):
        t = EX_BY_ID.get(x, {}).get('tempo')
        if t and (t['target'] != pc['bpm'] or t['start'] != round(0.65 * pc['bpm'])):
            errors.append(f"{l['id']}: exercise {x} tempo {t['start']}->{t['target']} should be {round(0.65 * pc['bpm'])}->{pc['bpm']} (the lesson's tempo ladder)")
# Every pitch lesson needs something to verify against (the grader never guesses): all six strings,
# or an exercise with notes. Cents lessons hold notes (bends); timed ones (bpm) need an exercise tempo.
for l in LESSONS:
    pc = l['pass_criteria']
    if pc['type'] != 'pitch': continue
    exs = [EX_BY_ID[x] for x in l['assets'].get('exercises', []) if x in EX_BY_ID and EX_BY_ID[x].get('events')]
    if pc.get('scope') != 'all_strings' and len(exs) != 1: errors.append(f"{l['id']}: a pitch lesson needs scope all_strings or exactly one exercise with notes")
    if ('cents' in pc) == ('note_accuracy' in pc): errors.append(f"{l['id']}: pitch needs either cents or note_accuracy")
    if 'cents' in pc and pc.get('scope') != 'all_strings' and not all(e.get('tech') == 'bend' for x in exs for e in x['events']):
        errors.append(f"{l['id']}: a cents lesson's exercise must be bends (held targets)")
    if 'bpm' in pc and not all(x.get('tempo') for x in exs): errors.append(f"{l['id']}: bpm set but the exercise has no tempo")
    if 'bpm' not in pc and any(x.get('tempo') for x in exs): errors.append(f"{l['id']}: exercise has a tempo but the lesson has no bpm (ladder target)")
    for x in exs:
        for e in x['events']:
            if e.get('tech') == 'harmonic' and e['fret'] not in HARMONIC_UP: errors.append(f"{x['id']}: harmonic at fret {e['fret']}")
for e in EXERCISES:
    for pair in e.get('pairs', []):
        if len(pair) != 2: errors.append(f"{e['id']}: a pair needs two chords")
        for c in pair:
            if resolve(c) is None: errors.append(f"{e['id']}: unknown chord {c}")
    # every chord the grader verifies against has a resolved voicing
    if e['type'] in ('chord_changes', 'chord_progression'):
        refs = [r for p in e.get('pairs', []) for r in p] + [r for v in e.get('variants', []) for r in v['chords']] + list(e.get('decoys', []))
        missing = [r for r in refs if r not in e.get('voicings', {})]
        if missing: errors.append(f"{e['id']}: no voicing for {missing}")
# Chord-graded lessons (M8): exactly one exercise of the grader's kind, so the grader knows what to verify against.
# changes_per_min: the chord_changes exercise (its target and 60 s window match the lesson; a lesson `pair` is one of
# its pairs). chord_accuracy: one chord_progression; with a lesson bpm it's played to a tempo ladder (65% → bpm).
for l in LESSONS:
    pc = l['pass_criteria']
    if pc['type'] not in ('changes_per_min', 'chord_accuracy'): continue
    kind = 'chord_changes' if pc['type'] == 'changes_per_min' else 'chord_progression'
    exs = [EX_BY_ID[x] for x in l['assets'].get('exercises', []) if EX_BY_ID.get(x, {}).get('type') == kind]
    if len(exs) != 1: errors.append(f"{l['id']}: a {pc['type']} lesson needs exactly one {kind} exercise"); continue
    x = exs[0]
    if kind == 'chord_changes':
        if x['target_per_min'] != pc['target'] or x['duration_s'] != 60: errors.append(f"{l['id']}: {x['id']} target {x['target_per_min']}/{x['duration_s']} s, lesson wants {pc['target']} a minute")
        if 'pair' in pc and not any([r.split('|')[0] for r in p] == pc['pair'] for p in x['pairs']): errors.append(f"{l['id']}: pair {pc['pair']} isn't in {x['id']}")
    else:
        if 'bpm' in pc:
            t = x.get('tempo')
            if x['pace'] != 'timed' or not t or t['target'] != pc['bpm'] or t['start'] != round(0.65 * pc['bpm']): errors.append(f"{l['id']}: {x['id']} needs tempo {round(0.65 * pc['bpm'])}->{pc['bpm']} (the lesson's tempo ladder)")
        elif 'tempo' in x: errors.append(f"{l['id']}: {x['id']} has a tempo ladder but the lesson has no bpm")
        if not 0.5 <= pc['ratio'] <= 1: errors.append(f"{l['id']}: ratio {pc['ratio']}")

# games: lesson refs, keys, numbers
NUMS = {'1', '2m', '3m', '4', '5', '6m', 'major', 'minor'}
gids = set()
for g in GAMES:
    if g['id'] in gids: errors.append(f"duplicate game {g['id']}")
    gids.add(g['id'])
    for ref in [g['unlock_lesson'], *g['review_for'], *[l.get('unlock_lesson') for l in g['levels']], *[r for l in g['levels'] for r in l.get('review_for', [])]]:
        if ref and ref not in lesson_ids: errors.append(f"{g['id']}: unknown lesson {ref}")
    if g['milestone'] in ('G1', 'G2') and not g['levels']: errors.append(f"{g['id']}: {g['milestone']} game without levels")
    if not g['modes'] or not set(g['modes']) <= {'tap', 'play'}: errors.append(f"{g['id']}: bad modes {g['modes']}")
    lids = [l['id'] for l in g['levels']]
    if len(set(lids)) != len(lids): errors.append(f"{g['id']}: duplicate level ids")
    for l in g['levels']:
        p, where = l['params'], f"{g['id']}/{l['id']}"
        for k in p.get('keys', []) + p.get('shapes', []):
            if k not in PC: errors.append(f"{where}: bad key {k}")
        for n in p.get('numbers', []):
            if n not in NUMS: errors.append(f"{where}: bad number {n}")
        z = p.get('zone')
        if z and (not set(z['strings']) <= {1, 2, 3, 4, 5, 6} or not 0 <= z['frets'][0] < z['frets'][1] <= 15): errors.append(f"{where}: bad zone")
        if l['target_score'] <= 0: errors.append(f"{where}: target_score must be positive")
        if g['id'] == 'G_octave_jump':
            # the octave shape's high note: 2 strings over, 2 frets up (OCTAVES), so it must stay on the neck
            if not z or not set(z['strings']) <= {6, 5}: errors.append(f"{where}: octave jump starts on string 6 or 5")
            elif z['frets'][1] + 2 > 15: errors.append(f"{where}: the octave would land past fret 15")
            for s in (z or {}).get('strings', []):
                hi, d = next((h, dd) for lo, h, dd in OCTAVES if lo == s)
                if (OPEN[6 - hi] + d) - OPEN[6 - s] != 12: errors.append(f"{where}: octave shape from string {s} is wrong")
        if g['id'] == 'G_box_runner':
            if p.get('path') not in ('up', 'down', 'updown', 'threes'): errors.append(f"{where}: bad path {p.get('path')}")
            if p.get('sub') not in (1, 2) or not 40 <= p.get('bpm', 0) <= 200 or p.get('passes', 0) < 1: errors.append(f"{where}: bad sub/bpm/passes")
            for pos in p.get('positions', []):
                sc = next((s for s in SCALES if s['kind'] == p.get('scale') and s['position'] == pos and s['root'] == ('G' if p.get('scale') == 'major_pentatonic' else 'A')), None)
                if not sc: errors.append(f"{where}: no {p.get('scale')} position {pos}"); continue
                for k in p['keys']:
                    # same rule as boxFrets() in web/src/games/core.ts: the lowest placement that fits frets 0–15
                    base = (PC[k] - PC[sc['root']]) % 12
                    fits = [s for s in (base - 12, base, base + 12) if min(min(x) for x in sc['frets']) + s >= 0 and max(max(x) for x in sc['frets']) + s <= 15]
                    if not fits: errors.append(f"{where}: {sc['id']} doesn't fit frets 0–15 in {k}"); continue
                    got = {(OPEN[i] + f + fits[0]) % 12 for i, fl in enumerate(sc['frets']) for f in fl}
                    if got != {(PC[k] + x) % 12 for x in SCALE_FORMULAS[p['scale']]}: errors.append(f"{where}: {sc['id']} in {k} has the wrong notes")
        if g['id'] == 'G_in_the_pocket':
            pat = next((r for r in RHYTHM if r['id'] == p.get('pattern')), None)
            if not pat: errors.append(f"{where}: unknown pattern {p.get('pattern')}")
            if not 40 <= p.get('bpm', 0) <= 200 or not 20 <= p.get('window_ms', 0) <= 100: errors.append(f"{where}: bad bpm/window_ms")
            if 'gap_bars' in p:
                if not p['gap_bars'] or any(x < 1 for x in p['gap_bars']) or p.get('click_bars', 0) < 1: errors.append(f"{where}: bad gap_bars/click_bars")
                # generated: bars = click, gap, click, gap, …, click
                p['bars'] = p['click_bars'] * (len(p['gap_bars']) + 1) + sum(p['gap_bars'])
            if p.get('bars', 0) < 4: errors.append(f"{where}: bars")
            if pat and p.get('bars') and not 20 <= p['bars'] * int(pat['meter'][0]) * 60 / p['bpm'] <= 180: errors.append(f"{where}: a round should be 20 s to 3 minutes")
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
         'exercises.json': EXERCISES, 'songs.json': SONGS, 'quizzes.json': QUIZZES, 'games.json': GAMES}
for name, data in files.items():
    with open(os.path.join(OUT, name), 'w') as fh:
        json.dump(data, fh, indent=1)
print('OK', {k: (len(v) if isinstance(v, list) else len(v)) for k, v in files.items()})
print('lessons', len(LESSONS), 'chords', len(C), 'scales', len(SCALES), 'exercises', len(EXERCISES))
