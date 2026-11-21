import asyncio, http.server, threading, functools
from playwright.async_api import async_playwright
PORT=8770
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(http.server.SimpleHTTPRequestHandler,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture=/home/claude/web/test/g_strum.wav','--autoplay-policy=no-user-gesture-required'])
        errs=[]
        for name,(w,h) in {'cover':(412,880),'inner':(840,760)}.items():
            pg=await b.new_page(viewport={'width':w,'height':h},device_scale_factor=2)
            pg.on('pageerror',lambda e: errs.append(str(e)))
            pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
            base=f'http://127.0.0.1:{PORT}/'
            await pg.goto(base+'#/today'); await pg.wait_for_selector('text=Quick tools')
            await pg.screenshot(path=f'test/{name}_today.png')
            await pg.goto(base+'#/lesson/A.02'); await pg.wait_for_selector('text=Chords')
            await pg.click('text=Metronome'); await pg.click('.sheet >> text=Start'); await pg.wait_for_timeout(1500)
            beat=await pg.evaluate("document.querySelectorAll('.metro .beats i.on').length")
            await pg.screenshot(path=f'test/{name}_lesson.png', full_page=True)
            await pg.goto(base+'#/song/MS_goodness_of_god'); await pg.wait_for_selector('.song .title')
            await pg.select_option('.song select >> nth=1', '1')
            chords=await pg.eval_on_selector_all('.chordline span','e=>e.slice(0,6).map(x=>x.textContent)')
            strip=await pg.is_visible('.metrostrip')
            await pg.screenshot(path=f'test/{name}_song.png', full_page=True)
            await pg.goto(base+'#/tools/tuner'); await pg.click('text=Start tuner'); await pg.wait_for_timeout(2000)
            note=await pg.inner_text('.tuner .note')
            await pg.screenshot(path=f'test/{name}_tuner.png')
            await pg.goto(base+'#/path'); n=await pg.eval_on_selector_all('.lessons li','e=>e.length')
            print(f'{name}: beat light on={beat} song(capo1)={chords} metro strip on other page={strip} tuner note={note} path lessons={n}')
            await pg.close()
        print('ERRORS:', errs or 'none'); await b.close()
asyncio.run(main())
