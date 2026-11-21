import asyncio, http.server, threading, functools
from playwright.async_api import async_playwright
PORT=8771
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(http.server.SimpleHTTPRequestHandler,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture=/home/claude/guitar-trainer/web/test/a_string.wav'])
        pg=await b.new_page(viewport={'width':412,'height':880}); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(f'http://127.0.0.1:{PORT}/#/tools/tuner'); await pg.click('text=Start tuner')
        seen=set()
        for i in range(30):
            await pg.wait_for_timeout(150); seen.add(await pg.inner_text('.tuner .note'))
            if i in (4,8): print(await pg.evaluate('JSON.stringify(__gtAudio())'))
        print('notes seen over 4.5 s:', sorted(seen), '| cents line:', await pg.inner_text('.tuner .cents'), '| errors:', errs or 'none')
        await b.close()
asyncio.run(main())
