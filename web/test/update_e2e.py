# Update banner: load the app (service worker installs), simulate a new deploy (sw.js changes), and check that
# "Update ready" appears, that one tap switches to the new version, and that the app still works offline after.
import asyncio, http.server, threading, functools, re, shutil, tempfile, os
from playwright.async_api import async_playwright
PORT = 8781
root = tempfile.mkdtemp(); site = os.path.join(root, 'site'); shutil.copytree('dist', site)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(http.server.SimpleHTTPRequestHandler, directory=site))
threading.Thread(target=srv.serve_forever, daemon=True).start()
async def main():
    ok = True
    def check(c, m):
        nonlocal ok; print(('PASS ' if c else 'FAIL ') + m); ok &= bool(c)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = await b.new_context(viewport={'width': 412, 'height': 880}); pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(f'http://127.0.0.1:{PORT}/#/today'); await pg.wait_for_selector("text=Today's practice")
        await pg.wait_for_function("navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(()=>true)")
        await pg.reload(); await pg.wait_for_selector("text=Today's practice")
        check(await pg.evaluate("!!navigator.serviceWorker.controller"), 'service worker controls the page')
        check(await pg.locator('.updatebanner').count() == 0, 'no banner on first install')
        sw = open(os.path.join(site, 'sw.js')).read(); old = re.search(r"gt-\w+", sw).group(0)
        open(os.path.join(site, 'sw.js'), 'w').write(sw.replace(old, old + 'x'))   # a new deploy
        await pg.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())")
        await pg.wait_for_selector('.updatebanner', timeout=15000); check(True, 'Update ready banner appears')
        async with pg.expect_navigation(): await pg.click('.updatebanner >> text=Reload now')
        await pg.wait_for_selector("text=Today's practice")
        check(await pg.locator('.updatebanner').count() == 0, 'banner gone after reload')
        keys = await pg.evaluate("caches.keys()"); check(keys == [old + 'x'], f'only the new cache is left {keys}')
        await ctx.set_offline(True); await pg.reload(); await pg.wait_for_selector("text=Today's practice")
        await pg.goto(f'http://127.0.0.1:{PORT}/#/lesson/F.05'); await pg.wait_for_selector('text=Why the spider')
        check(True, 'works offline from the new cache (Today + lesson text)')
        check(not errs, f'no page errors {errs}')
        await b.close()
    print('E2E PASS' if ok else 'E2E FAIL')
asyncio.run(main())
