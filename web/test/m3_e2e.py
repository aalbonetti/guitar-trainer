import asyncio, http.server, threading, functools
from playwright.async_api import async_playwright
PORT=8772
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(http.server.SimpleHTTPRequestHandler,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--autoplay-policy=no-user-gesture-required'])
        ctx=await b.new_context(viewport={'width':412,'height':880},device_scale_factor=2); pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
        base=f'http://127.0.0.1:{PORT}/'
        await pg.goto(base+'#/lesson/F.04'); await pg.wait_for_selector('.content .md')
        print('F.04 embeds:', await pg.eval_on_selector_all('.content figure, .content pre.tab, .content .quiz','e=>e.length'), '| tab first line:', (await pg.inner_text('pre.tab')).split('\n')[0][:40])
        await pg.click('text=Start quiz')
        for i in range(10):
            await pg.wait_for_selector('.choices button'); await pg.click('.choices button >> nth=0'); await pg.click('button:has-text("Next"), button:has-text("Finish")')
        print('quiz result:', await pg.inner_text('.quiz .note'))
        await pg.screenshot(path='test/m3_quiz.png')
        await pg.goto(base+'#/lesson/F.03'); await pg.wait_for_selector('text=I can do this'); await pg.click('text=I can do this')
        await pg.wait_for_timeout(300); print('after self-check:', await pg.inner_text('.pass, section:has(h2:has-text("Pass it")) .note'))
        await pg.reload(); await pg.wait_for_selector('h1 .badge'); print('badge after reload:', await pg.inner_text('h1 .badge'))
        await pg.goto(base+'#/path'); await pg.wait_for_selector('.lessons'); print('path legend states:', await pg.eval_on_selector_all('.lessons li','e=>e.slice(0,7).map(x=>x.className+":"+x.querySelector(".sticon").textContent).join(" ")'))
        await pg.goto(base+'#/today'); await pg.wait_for_selector('text=Up next'); print('today up next:', (await pg.inner_text('section:has(h2:has-text("Up next"))')).replace('\n',' | ')[:200])
        for lid in ['A.02','ER.04','EL.04','A.12','ER.09']:
            await pg.goto(base+'#/lesson/'+lid); await pg.wait_for_selector('.content .md'); print(lid,'embeds',await pg.eval_on_selector_all('.content figure, .content pre.tab, .content .quiz, .content .chords','e=>e.length'),'errors-in-page',await pg.eval_on_selector_all('.content .error','e=>e.map(x=>x.textContent)'))
        await pg.goto(base+'#/lesson/T.07'); await pg.wait_for_selector('.content table'); await pg.screenshot(path='test/m3_t07.png', full_page=True)
        print('ERRORS:', errs or 'none'); await b.close()
asyncio.run(main())
