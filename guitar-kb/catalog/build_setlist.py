"""Build setlist.json from the church's set-list CSV (personal data, stays in this project).
Usage: python3 build_setlist.py <csv> <catalog_dir>   (run after build_song_outlines.py)"""
import csv, json, os, sys

CSV, OUT = sys.argv[1], sys.argv[2]
rows = list(csv.reader(open(CSV, encoding='utf-8')))
weeks = rows[0][3:]
outlines = {s['title'].lower(): s['id'] for s in json.load(open(os.path.join(OUT, 'song_outlines.json')))}

ALIAS = {  # set-list title -> outline title (lowercase)
    '10,000 reasons (bless the lord)': '10,000 reasons (bless the lord)',
    'glorious day (passion)': 'glorious day',
    'in christ alone (with the solid rock) / medley': 'in christ alone',
    'holy is the lord': 'holy is the lord',
    'love of god': 'love of god',
    'amazing grace (my chains are gone)': 'amazing grace (my chains are gone)',
    'at the cross (love ran red)': 'at the cross (love ran red)',
    'o praise the name (anástasis)': 'o praise the name (anastasis)',
    'here i am lord': 'here i am, lord',
    'mighty to save': 'mighty to save',
    'come now is the time to worship': 'come now is the time to worship',
    'come thou fount come thou king': 'come thou fount, come thou king',
    'shine jesus shine': 'shine, jesus, shine',
    'the potters hand': "the potter's hand",
    "how deep the father's love for us": "how deep the father's love for us",
}
# Ambiguous titles: user said to skip these (Nov 21, 2026)
SKIPPED = {
    'rock of ages': 'Traditional hymn (1776 text, public domain) or a modern song (ICF, Austin Stone, LO Worship, etc.)?',
    'take my life': 'Hymn "Take My Life and Let It Be" (1874, PD), Chris Tomlin/Passion (2004), or Scott Underwood "Holiness"?',
    'turn your eyes': 'Hymn "Turn Your Eyes Upon Jesus" (1922, PD), Sovereign Grace (3/4), or The Belonging Co (2021)?',
    'alive forever amen': 'Only found as part of a Travis Cottrell medley; which recording?',
    'i surrender all': 'Traditional hymn (1896, PD) or a modern arrangement?',
    'victory in jesus': 'Hymn (1939, still copyrighted) - which arrangement? Several modern versions exist.',
    'more precious than silver': 'Lynn DeShazo (1982); no original master listing found. Which recording do you follow?',
    'always': 'Chris Tomlin "Always" (2022)? Several songs share this title.',
    'always be a child': 'Could not identify; who recorded it?',
    'a simple word of grace': 'Could not identify; who recorded it?',
    'how marvelous': 'Hymn "I Stand Amazed (How Marvelous)" (1905, PD) or a modern version?',
}
PUBLIC_DOMAIN_LIKELY = {'a mighty fortress is our god', 'blessed assurance'}

songs = []
for r in rows[1:]:
    if not r or not r[0].strip():
        continue
    name = r[0].strip()
    key = name.lower()
    played = [w for w, v in zip(weeks, r[3:]) if v.strip()]
    oid = outlines.get(ALIAS.get(key, key))
    status = ('outline' if oid else
              'skipped' if key in SKIPPED else
              'public_domain_candidate' if key in PUBLIC_DOMAIN_LIKELY else 'pending_research')
    songs.append(dict(name=name, plays=int(r[2]), new=bool(r[1].strip()), weeks_played=played,
                      last_played=played[-1] if played else None, outline_id=oid, status=status,
                      note=('ambiguous title, skipped: ' + SKIPPED[key]) if key in SKIPPED else None))
songs.sort(key=lambda s: (-s['plays'], s['name'].lower()))
data = dict(source='HOPE Worship set list (Faith Lutheran), Aug 23 - Nov 15, 2026', weeks=weeks,
            note='Song titles and play history only. Charts come from the user\'s own SongSelect access.',
            songs=songs)
json.dump(data, open(os.path.join(OUT, 'setlist.json'), 'w'), indent=1)
from collections import Counter
print('songs', len(songs), Counter(s['status'] for s in songs))
for s in songs:
    if s['plays'] >= 2 or s['status'] == 'outline':
        print(f"{s['plays']} {s['name']:<45} {s['status']:<20} {s['outline_id'] or ''}")
