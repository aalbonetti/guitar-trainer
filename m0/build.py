#!/usr/bin/env python3
"""Build the site into dist/: inline dsp.js and app.js into index.html, add the manifest and icon."""
import json, pathlib, shutil

ROOT = pathlib.Path(__file__).resolve().parent
SRC, DIST = ROOT / 'src', ROOT / 'dist'
if DIST.exists():
    shutil.rmtree(DIST)
DIST.mkdir()

html = (SRC / 'index.html').read_text()
html = html.replace('/*DSP*/', (SRC / 'dsp.js').read_text()).replace('/*APP*/', (SRC / 'app.js').read_text())
(DIST / 'index.html').write_text(html)

(DIST / 'icon.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
    '<rect width="512" height="512" rx="112" fill="#14161a"/>'
    '<g stroke="#e8a33d" stroke-width="14" stroke-linecap="round">'
    + ''.join(f'<line x1="{x}" y1="120" x2="{x}" y2="392"/>' for x in (151, 193, 235, 277, 319, 361)) +
    '</g><g stroke="#8b919c" stroke-width="8">'
    + ''.join(f'<line x1="130" y1="{y}" x2="382" y2="{y}"/>' for y in (180, 250, 320)) +
    '</g><circle cx="235" cy="215" r="20" fill="#e9ebef"/><circle cx="319" cy="285" r="20" fill="#e9ebef"/></svg>')

(DIST / 'manifest.webmanifest').write_text(json.dumps({
    'name': 'Guitar Trainer', 'short_name': 'Guitar', 'start_url': './', 'scope': './',
    'display': 'standalone', 'background_color': '#14161a', 'theme_color': '#14161a',
    'icons': [{'src': 'icon.svg', 'sizes': 'any', 'type': 'image/svg+xml', 'purpose': 'any'}],
}, indent=2))
(DIST / '.nojekyll').write_text('')
print('built', sorted(p.name for p in DIST.iterdir()), f"index.html {len(html)//1024} KB")
