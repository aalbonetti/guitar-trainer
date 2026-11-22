# Day-one check: pass F.01's quiz, see "Saved", refresh, and the pass is still there; Today moves on to F.02.
import asyncio, http.server, threading, functools, sys, re
from playwright.async_api import async_playwright
PORT=8779
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(http.server.SimpleHTTPRequestHandler,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
names=['E','B','G','D','A','E']
async def main():
    ok=True
    def check(c,m):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+m); ok&=bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome'); pg=await b.new_page(viewport={'width':412,'height':880}); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(f'http://127.0.0.1:{PORT}/#/lesson/F.01'); await pg.click('text=Start quiz'); await pg.wait_for_selector('.quiz .choices button')
        for i in range(30):
            txt=await pg.inner_text('.quiz')
            m=re.search(r'Open string (\d) is which note\?',txt); m2=re.search(r'Which string is the open (\w)\?',txt)
            if m: ans=names[int(m.group(1))-1]
            elif m2: ans='String %d'%(names.index(m2.group(1))+1)
            else: break
            await pg.click(f'.quiz .choices button:text-is("{ans}")'); await pg.locator('.quiz button:text-is("Next"), .quiz button:text-is("Finish")').first.click(); await pg.wait_for_timeout(120)
        await pg.wait_for_timeout(600); t=await pg.inner_text('.lesson'); 
        check('First pass!' in t and 'Saved on this phone' in t, 'quiz result says first pass + saved')
        await pg.reload(); await pg.wait_for_selector('text=Pass it'); await pg.wait_for_selector('text=Passed once today', timeout=8000); t=await pg.inner_text('.lesson')
        check('Passed once today' in t and 'passed once' in t, 'after refresh: still passed once today')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/lesson/F.02'); await pg.wait_for_selector('.lesson h1 .badge:not(:text("locked"))', timeout=8000); check('Not unlocked yet' not in await pg.inner_text('.lesson'), 'F.02 is open after the first pass')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/today'); await pg.wait_for_timeout(500); q=await pg.inner_text('.practice')
        check('F.01' not in q and ('F.02' in q or 'F.03' in q or 'F.04' in q), "Today's plan moves on from F.01")
        check(await pg.locator('.savebanner').count()==0, 'no save warning'); check(not errs, f'no errors {errs}')
        await b.close()
    print('E2E','PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
asyncio.run(main())
