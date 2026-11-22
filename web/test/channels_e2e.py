# Input channel choice + metronome meters, in headless Chrome. The simulated input (?sim&simchs=4&simch=3)
# is a 4-channel device with the "guitar" on channel 3 and a steady 440 Hz decoy on the others, so the
# analyzers must hear only the chosen channel. Run after `npm run build`.
import asyncio, http.server, threading, functools, sys, json
from playwright.async_api import async_playwright
PORT=8781
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(Q,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
ok=True
def check(name, cond, extra=''):
    global ok; ok &= bool(cond); print('PASS' if cond else 'FAIL', name, extra)
async def freq(pg):
    a=await pg.evaluate('__gtAudio()'); return (a['yin'] or {}).get('freq')
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':412,'height':880}); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        base=f'http://127.0.0.1:{PORT}/?sim&simchs=4&simch=3'
        await pg.goto(base+'#/settings'); await pg.wait_for_selector('text=Choose input channel')
        check('default is channel 1', 'channel 1' in await pg.inner_text('.chanpick'))
        await pg.click('button:has-text("Choose input channel")')
        await pg.wait_for_selector('text=4 channels', timeout=8000)
        await pg.wait_for_timeout(600)
        f=await freq(pg); check('channel 1 hears the 440 Hz decoy', f and abs(f-440)<2, f)
        bars=await pg.eval_on_selector_all('.chanlist .meter i','e=>e.map(x=>parseFloat(x.style.width))'); print('level bars', bars)
        check('level bars show signal on the decoy channels', bars and bars[0]>30 and bars[3]>30, bars)
        await pg.click('.chanlist button:has-text("Ch 3")'); await pg.wait_for_timeout(400)
        await pg.evaluate("__gtSimNotes([{midi:52,t:__gtCtxNow()+0.05,dur:1.6,gain:0.6}])")
        await pg.wait_for_timeout(700)
        f=await freq(pg); check('channel 3 hears the guitar note (E3 164.8 Hz), not the decoy', f and abs(f-164.81)<1.5, f)
        saved=await pg.evaluate("localStorage.getItem('gt_input_channel')"); check('channel saved per input', saved and json.loads(saved).get('simulated input')==2, saved)
        await pg.click('.chanpick button:has-text("Done")')
        await pg.reload(); await pg.wait_for_selector('text=Choose input channel')
        await pg.click('button:has-text("Choose input channel")'); await pg.wait_for_selector('text=4 channels', timeout=8000); await pg.wait_for_timeout(600)
        sel=await pg.inner_text('.chanlist button.sel'); check('remembered after reload', 'Ch 3' in sel, sel)
        f=await freq(pg); check('still analyzing channel 3 after reload (no decoy)', not f or abs(f-440)>5, f)
        await pg.click('.chanpick button:has-text("Done")')
        # ---- metronome: 6/8 + accent editing ----
        await pg.goto(base+'#/tools/metronome'); await pg.wait_for_selector('.metro')
        m=pg.locator('section.card:has-text("Metronome") .metro')
        await m.locator('select[aria-label=Meter]').select_option('6/8')
        n=await m.locator('.beats .light').count(); check('6/8 shows six eighth lights', n==6, n)
        sv=await m.locator('select[aria-label=Subdivision]').input_value(); check('6/8 defaults to eighths', sv=='3', sv)
        subs=await m.locator('select[aria-label=Subdivision] option').all_inner_texts(); check('6/8 subdivisions', subs==['dotted ♩ only','♪ eighths','16ths'], subs)
        check('BPM labelled as dotted quarter', 'BPM (♩.)' in await m.locator('.bpm').inner_text())
        await m.locator('.beats .light').nth(3).click()
        acc=await m.locator('.beats .light.acc').count(); check('tap a light to accent it', acc==2, acc)
        await m.locator('button:has-text("Start")').click(); await pg.wait_for_timeout(1500)
        on=await m.locator('.beats .light.on').count(); check('lights run in 6/8', on==1, on)
        await m.locator('button:has-text("Stop")').click()
        await m.locator('select[aria-label=Meter]').select_option('3/4')
        n=await m.locator('.beats .light').count(); acc=await m.locator('.beats .light.acc').count(); check('3/4: three lights, accent back to 1', n==3 and acc==1, (n,acc))
        # ---- lesson presets the meter ----
        await pg.goto(base+'#/lesson/A.07'); await pg.wait_for_selector('.toolbar')
        chip=await pg.inner_text('.toolbar .chip'); check('A.07 tool bar presets 3/4', '3/4' in chip, chip)
        await pg.wait_for_selector('text=Click at 60 BPM')
        c68=await pg.inner_text('button:has-text("Click at 60 BPM")'); check('6/8 click button in the lesson text', '6/8' in c68, c68)
        await pg.click('button:has-text("Click at 60 BPM")'); await pg.wait_for_timeout(300)
        await pg.click('.toolbar button:has-text("Metronome")')
        meter=await pg.eval_on_selector('.sheet select[aria-label=Meter]','e=>e.value'); check('lesson 6/8 click runs in 6/8', meter=='6/8', meter)
        await pg.click('.metrostrip button:has-text("Stop")')
        await pg.goto(base+'#/lesson/EL.07'); await pg.wait_for_selector('.toolbar')
        chip=await pg.inner_text('.toolbar .chip'); check('EL.07 (Amazing Grace) presets 3/4', '3/4' in chip, chip)
        check('no page errors', not errs, errs)
        await b.close()
    print('E2E', 'PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
asyncio.run(main())
