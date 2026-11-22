# M6 end-to-end: import a chart (file + paste), preview + outline match, chart view (key, capo, numbers, words), delete.
# Fixtures are synthetic: real chords from song_outlines.json, placeholder words only.
import asyncio, http.server, threading, functools, sys, json, tempfile, os
from playwright.async_api import async_playwright
PORT=8777
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(http.server.SimpleHTTPRequestHandler,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
O=json.load(open('public/catalog/song_outlines.json')); o=next(x for x in O if x['ccli'] and x['chart_key']=='G')
cho='\n'.join([f"{{title: {o['title']}}}",f"{{key: G}}","{tempo: 72}","{time: 4/4}",f"{{ccli: {o['ccli']}}}","{x_unknown: 1}",""]+
  sum([[f"{{start_of_verse: {s['name']}}}", ' '.join(f"[{c}]la la" for c in s['chords_in_chart_key']), '{end_of_verse}'] for s in o['sections']],[]))
fn=os.path.join(tempfile.mkdtemp(),'placeholder.cho'); open(fn,'w').write(cho)
plain="Placeholder Hymn\nNobody\nKey - D\n\nVerse 1\nD       G/D     A\nla la la la la la\n\nChorus\nBm  G  D/F#  A\nla  la la    la\n"
async def main():
    ok=True
    def check(c,m):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+m); ok&=bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome'); pg=await b.new_page(viewport={'width':412,'height':880}); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(f'http://127.0.0.1:{PORT}/#/songs'); await pg.click('text=My charts'); await pg.click('text=Import a chart')
        await pg.set_input_files('input[type=file]', fn); await pg.wait_for_selector('text=Preview')
        pv=await pg.inner_text('section.card:has-text("Preview")'); print(pv)
        check(f"Matches “{o['title']}”" in pv and 'CCLI' in pv and 'Ignored: {x_unknown}' in pv, 'preview: matched by CCLI, unknown directive noted')
        await pg.click('text=Save to My charts'); await pg.wait_for_selector('.chartpage'); await pg.screenshot(path='/tmp/m6_chart.png')
        first=await pg.locator('.cline .seg b').first.inner_text(); check(first==o['sections'][0]['chords_in_chart_key'][0], f'first chord {first}')
        await pg.select_option('label:has-text("Key") select','A'); a=await pg.locator('.cline .seg b').first.inner_text(); check(a!=first, f'transposed to A: {a}')
        await pg.select_option('label:has-text("Capo") select','2'); cp=await pg.locator('.cline .seg b').first.inner_text(); check(cp==first, f'capo 2 in A shows G shapes again: {cp}')
        await pg.click('button:has-text("Chords")'); n=await pg.locator('.cline .seg b').first.inner_text(); check(n==o['sections'][0]['numbers'][0], f'numbers view: {n}')
        await pg.click('button:has-text("Words on")'); check(await pg.locator('.cline.chordsonly').count()>0, 'chords-only view')
        await pg.click('button:has-text("Chords only")')
        await pg.goto(f"http://127.0.0.1:{PORT}/#/song/{o['id']}"); await pg.wait_for_selector('text=Open your full chart'); check(True,'outline links to the imported chart')
        # paste a plain-text chart
        await pg.goto(f'http://127.0.0.1:{PORT}/#/import'); await pg.fill('textarea.paste', plain); await pg.wait_for_selector('text=plain text')
        pv=await pg.inner_text('section.card:has-text("Preview")'); check('Placeholder Hymn' in pv and 'No matching song' in pv and '1 4/1 5' in pv, 'plain paste preview with numbers')
        await pg.click('text=Save to My charts'); await pg.wait_for_selector('.chartpage')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/songs/mine'); await pg.wait_for_timeout(300); lst=await pg.inner_text('.songlist'); check('(2)' in lst, 'two charts listed')
        await pg.screenshot(path='/tmp/m6_list.png')
        await pg.click('text=Placeholder Hymn'); await pg.click('text=Delete chart'); await pg.wait_for_timeout(500)
        lst=await pg.inner_text('.songlist'); check('Placeholder Hymn' not in lst, 'deleted')
        # survives reload (IndexedDB)
        await pg.reload(); await pg.wait_for_timeout(600); check(o['title'] in await pg.inner_text('.songlist'), 'chart persists after reload')
        await pg.set_viewport_size({'width':900,'height':800}); await pg.click(f"text={o['title']}"); await pg.wait_for_selector('.chartpage'); await pg.wait_for_timeout(300); await pg.screenshot(path='/tmp/m6_unfolded.png')
        check(not errs, f'no page errors {errs}'); await b.close()
    print('E2E','PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
asyncio.run(main())
