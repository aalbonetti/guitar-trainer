# M4 end-to-end: calibration + graded timing attempts in headless Chrome, with simulated strums (?sim)
# fed through the real capture worklet and onset detector. Run after `npm run build`.
import asyncio, http.server, threading, functools, sys, json
from playwright.async_api import async_playwright
PORT=8774
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(http.server.SimpleHTTPRequestHandler,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
# latency 140 ms; jitter set per attempt via window.__jit (ms); window.__all strums the rests too
INIT = """window.__jit=8; window.__lat=0.14; window.__all=false;
window.__gtSimAuto=(kind,times)=>{ let s=1; const r=()=>((s=(s*16807)%2147483647)/2147483647-0.5);
  if(kind==='timing'&&window.__all){ const p=window.__gtLastPlan.plan; times=p.slots.map(x=>x.t); }
  window.__gtSimStrums(times.map(t=>t+window.__lat+r()*2*window.__jit/1000)); };"""
async def wait_result(pg, sel='.result, .error', t=60000):
    await pg.wait_for_selector(sel, timeout=t)
async def main():
    ok=True
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':412,'height':880}); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.add_init_script(INIT)
        await pg.goto(f'http://127.0.0.1:{PORT}/?sim#/lesson/A.05'); await pg.wait_for_selector('text=Pass it')
        await pg.click('button:has-text("Start at 52 BPM")')
        await pg.wait_for_selector('text=First, a 30-second calibration', timeout=10000)
        await pg.click('button:has-text("Calibrate")')
        await pg.wait_for_selector('text=Calibrated:', timeout=40000)
        cal=await pg.evaluate("(async()=>{const r=indexedDB.open('guitar-trainer');await new Promise(x=>r.onsuccess=x);return await new Promise(x=>{const q=r.result.transaction('calibration').objectStore('calibration').getAll();q.onsuccess=()=>x(q.result)})})()")
        print('calibration:', json.dumps(cal))
        await pg.screenshot(path='/tmp/m4_cal.png', full_page=False)
        # attempt at goal tempo, tight playing -> should pass
        await pg.click('button:has-text("Try at goal (80)")')
        await pg.wait_for_selector('.running', timeout=5000); await pg.wait_for_timeout(4500)
        await pg.locator('.running').screenshot(path='/tmp/m4_running.png')
        await wait_result(pg)
        res=await pg.inner_text('.result'); print('--- tight @80:\n', res)
        ok &= 'Passed this attempt' in res
        await pg.locator('section.card:has-text("Pass it")').screenshot(path='/tmp/m4_result.png')
        # sloppy: ±130 ms jitter (the clean try at 80 lifted the practice tempo to 80)
        await pg.evaluate('window.__jit=130')
        await pg.click('button:has-text("Go again at 80 BPM")'); await wait_result(pg, '.result h3:has-text("Not yet")', 60000)
        res=await pg.inner_text('.result'); print('--- sloppy @80:\n', res); ok &= 'Not yet' in res
        # A.06 worship pattern, strumming through the rests -> should fail on rests
        await pg.evaluate('window.__jit=6; window.__all=true')
        await pg.goto(f'http://127.0.0.1:{PORT}/?sim#/lesson/A.06'); await pg.wait_for_selector('text=Pass it')
        await pg.click('button:has-text("Try at goal (90)")'); await wait_result(pg, '.result', 60000)
        res=await pg.inner_text('.result'); print('--- A.06 strummed through rests:\n', res); ok &= 'rests' in res and 'Not yet' in res
        await pg.evaluate('window.__all=false')
        await pg.click('button:has-text("Try at goal (90)")'); await pg.wait_for_timeout(1500); await wait_result(pg, '.result', 60000)
        res=await pg.inner_text('.result'); print('--- A.06 correct pattern:\n', res); ok &= 'Passed this attempt' in res
        att=await pg.evaluate("(async()=>{const r=indexedDB.open('guitar-trainer');await new Promise(x=>r.onsuccess=x);return await new Promise(x=>{const q=r.result.transaction('attempt').objectStore('attempt').getAll();q.onsuccess=()=>x(q.result.map(a=>[a.lesson_id,a.met_target,a.at_target_tempo,a.event,a.metrics_json]))})})()")
        for a in att: print(a)
        g=await pg.evaluate('JSON.stringify(__gtAudio().capture)'); print('capture:', g)
        print('errors:', errs or 'none'); ok &= not errs
        await b.close()
    print('E2E', 'PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
asyncio.run(main())
