# M5 end-to-end: restore a backup file (seeded progress + set list), then run the daily loop:
# due badge → queue → Start practice → session bar → Next through items → Finish → summary → Progress → backup download.
import asyncio, http.server, threading, functools, sys, json, datetime, tempfile, os, re
from playwright.async_api import async_playwright
PORT=8776
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(http.server.SimpleHTTPRequestHandler,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
L=json.load(open('public/catalog/lessons.json')); O=json.load(open('public/catalog/song_outlines.json'))
today=datetime.date.today(); D=lambda n:(today+datetime.timedelta(days=n)).isoformat()
lp=[{'lesson_id':l['id'],'state':'passed','first_pass_day':D(-20),'passed_day':D(-19),'review_index':1,'next_review_day':D(30),'mastered':False,'updated_at':0} for l in L if l['track']=='F']
lp[0]['next_review_day']=D(-1)  # F.01 review due
lp.append({'lesson_id':'A.05','state':'in_progress','first_pass_day':D(-1),'review_index':0,'mastered':False,'updated_at':0})
song=O[0]
setlist={'weeks':['w1','w2','w3','w4'],'importedAt':'x','songs':[{'name':song['title'],'plays':3,'isNew':False,'weeks':['w4'],'last':'w4','lastIndex':3,'outlineId':song['id']}]}
backup={'_app':'guitar-trainer','lesson_progress':lp,'attempt':[],'practice_day':[{'day':D(-2)},{'day':D(-1)}],'quiz_item_stats':[],'kv':[],'calibration':[],'practice_session':[{'id':'old','started_at':0,'ended_at':0,'day':D(-1),'routine':'15','total_s':960,'items':4,'items_done':4,'attempts':2,'passes':1}],
  '_local':{'gt_setlist_v1':json.dumps(setlist),'gt_instruments':json.dumps('acoustic')}}
bf=os.path.join(tempfile.mkdtemp(),'b.json'); json.dump(backup,open(bf,'w'))
async def seedpage(pg, path):
    import json
    await pg.goto(f'http://127.0.0.1:{PORT}/?sim#/settings'); await pg.wait_for_function('!!window.__gtImport')
    await pg.evaluate('d => window.__gtImport(d)', json.load(open(path))); await pg.reload(); await pg.wait_for_timeout(500)
async def main():
    ok=True
    def check(c,m):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+m); ok&=bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx=await b.new_context(viewport={'width':412,'height':880},accept_downloads=True); pg=await ctx.new_page(); errs=[]
        await ctx.add_init_script("window.__buzz = 0; navigator.vibrate = () => { window.__buzz++; return true; };")
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
        await seedpage(pg, bf); await pg.goto(f'http://127.0.0.1:{PORT}/#/today'); await pg.wait_for_selector("text=Today's practice")
        badge=await pg.locator('.navbadge').first.inner_text(); check(badge=='1', f'due badge shows 1 (got {badge})')
        # cover screen: 5 evenly wide tabs, each >= 48 px tall; Progress and Settings live in the header
        await pg.set_viewport_size({'width':380,'height':800}); await pg.wait_for_timeout(200)
        tabs=await pg.evaluate("[...document.querySelectorAll('.nav a')].filter(a=>a.offsetParent).map(a=>{const r=a.getBoundingClientRect();return [a.innerText.replace(/\\s+/g,' ').trim(),Math.round(r.width),Math.round(r.height)]})")
        check(len(tabs)==5 and all(t[2]>=48 for t in tabs) and max(t[1] for t in tabs)-min(t[1] for t in tabs)<=1, f'380 px: 5 tabs, >= 48 px tall, even width {tabs}')
        check([t[0].split(' ')[-1] for t in tabs]==['Today','Path','Songs','Arcade','Tools'], 'bar tabs: Today Path Songs Arcade Tools')
        await pg.click('.topbar a[aria-label=Settings]'); await pg.wait_for_selector('text=Saving')
        check(await pg.locator('.topbar a.on[aria-label=Settings]').count()==1 and await pg.locator('.nav a.on:visible').count()==0, 'header gear opens Settings, highlighted in the header only')
        await pg.click('.topbar a[aria-label=Progress]'); await pg.wait_for_selector('text=Minutes per week'); check(True, 'header chart button opens Progress')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/today'); await pg.click('a.todaystat'); await pg.wait_for_selector('text=Minutes per week'); check(True, 'Today progress card opens Progress')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade'); await pg.click('a.streaklink'); await pg.wait_for_selector('text=Minutes per week'); check(True, 'Arcade streak opens Progress')
        await pg.set_viewport_size({'width':760,'height':880}); await pg.wait_for_timeout(200)
        check(await pg.locator('.nav a:visible').count()==7, 'unfolded rail keeps all 7 entries')
        await pg.set_viewport_size({'width':412,'height':880}); await pg.goto(f'http://127.0.0.1:{PORT}/#/today'); await pg.wait_for_selector("text=Today's practice")
        q=await pg.locator('.practice ol.queue').inner_text(); print(q)
        check('Warm-up' in q and 'Review' in q and 'A.05' in q and 'Song of the week' not in q, 'queue: warm-up, review, passed-once A.05 (song of the week has its own box)')
        check('Song of the week' in await pg.inner_text('.page') and 'every Monday at 12:01 am' in await pg.inner_text('.page'), 'Today shows the song of the week card')
        await pg.screenshot(path='/tmp/m5_today.png')
        check('about 10 min' in await pg.inner_text('.practice'), '10 min routine adds up to 10')
        await pg.click('text=20 min'); check('about 20 min' in await pg.inner_text('.practice'), '20 min routine adds up to 20')
        await pg.click('.practice >> text=Free'); check('no timer' in await pg.inner_text('.practice'), 'free has no timer')
        await pg.click('text=10 min')
        await pg.click('text=Start practice'); await pg.wait_for_selector('.sessionbar')
        check('#/lesson/F.05' in pg.url, f'start goes to the warm-up ({pg.url})')
        await pg.locator('.sessionbar').screenshot(path='/tmp/m5_bar.png')
        await pg.click('.sessionbar >> text=Next ›'); check('#/lesson/F.01' in pg.url, 'Next → review F.01')
        await pg.click('.sessionbar >> text=Next ›'); check('#/lesson/A.05' in pg.url, 'Next → A.05')
        await pg.wait_for_selector('text=Eighth-note', timeout=5000); await pg.wait_for_timeout(400)
        h=await pg.inner_text('.lesson section.card:has(h2:text("Lesson"))'); check('The parts that matter' not in h, 'A.05 shows its own lesson text after fast Next taps')
        await pg.screenshot(path='/tmp/m5_lesson.png')
        check(await pg.locator('.sessionbar >> text=Finish').count()==1, 'A.05 is the last step (no song step)')
        # time's up on this item: chime + buzz once (vibrate is recorded by the init script)
        await pg.evaluate("(() => { const s = JSON.parse(localStorage.gt_session); s.itemStart = Date.now() - (s.items[s.idx].minutes * 60000 + 3000); s.lastActive = Date.now(); localStorage.gt_session = JSON.stringify(s); })()")
        await pg.reload(); await pg.wait_for_selector('.sessionbar'); await pg.wait_for_timeout(1500)
        check(await pg.evaluate('window.__buzz') == 1, f"time's up buzzes once (got {await pg.evaluate('window.__buzz')})")
        await pg.goto(f'http://127.0.0.1:{PORT}/#/today'); await pg.wait_for_selector('text=Practice in progress')
        prog=await pg.locator('.practice').inner_text(); check(prog.count('✓')>=2, 'two items ticked')
        await pg.reload(); await pg.wait_for_selector('.sessionbar'); check(True,'session survives reload')
        await pg.click('.sessionbar >> text=Finish'); await pg.wait_for_selector('.summary')
        sm=await pg.inner_text('.summary'); print(sm); check('3 of 3' in sm, 'summary counts 3 of 3 items')
        await pg.screenshot(path='/tmp/m5_summary.png')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/lesson/A.09'); await pg.wait_for_selector('text=Not unlocked yet')
        check(await pg.locator('text=Start at').count()==0, 'locked lesson A.09 has no attempt button')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/progress'); await pg.wait_for_selector('text=Minutes per week'); await pg.wait_for_timeout(300)
        # 07-games §4: a day counts with 5 minutes of practice. The activity clock logged today's minutes while
        # the items were worked through; a short session keeps the streak (2 days) without counting today yet.
        await pg.click('h1'); await pg.wait_for_timeout(11000)  # the clock ticks every 10 s while you're using the app
        PD="(async()=>{const r=indexedDB.open('guitar-trainer');await new Promise(x=>r.onsuccess=x);return await new Promise(x=>{const q=r.result.transaction('practice_day').objectStore('practice_day').getAll();q.onsuccess=()=>x(q.result)})})()"
        row=next((d for d in await pg.evaluate(PD) if d['day']==D(0)), None)
        check(row is not None and row.get('active_s',0)>0 and row['active_s']<300, f"today's practice_day row has the minutes so far ({row})")
        pt=await pg.inner_text('.page'); row2=next((d for d in await pg.evaluate(PD) if d['day']==D(0)), row)
        m=re.search(r'Today: (\d+) min', pt)
        check(m and int(m.group(1)) in (row['active_s']//60, row2['active_s']//60), f"Progress shows today's minutes ({m and m.group(0)}, row {row['active_s']} s)")
        check('2-day streak' in pt and 'min ✓' not in pt, 'short session: streak kept at 2 days, today not counted yet')
        # 5 minutes today: written on a fresh page load (the clock's first 10 s tick hasn't run, so it can't overwrite it), then reloaded
        await pg.goto(f'http://127.0.0.1:{PORT}/#/settings'); await pg.reload(); await pg.wait_for_selector('text=Saving')
        await pg.evaluate(f"(async()=>{{const r=indexedDB.open('guitar-trainer');await new Promise(x=>r.onsuccess=x);await new Promise(x=>{{const q=r.result.transaction('practice_day','readwrite').objectStore('practice_day').put({{day:'{D(0)}',active_s:300}});q.onsuccess=x}})}})()")
        await pg.goto(f'http://127.0.0.1:{PORT}/#/progress'); await pg.reload(); await pg.wait_for_selector('text=Minutes per week'); await pg.wait_for_timeout(300)
        pt=await pg.inner_text('.page'); check('3-day streak' in pt and 'Today: 5 min ✓' in pt, '5 minutes today: 3-day streak, today counts')
        await pg.screenshot(path='/tmp/m5_progress.png', full_page=True)
        await pg.goto(f'http://127.0.0.1:{PORT}/#/settings'); await pg.wait_for_selector('text=Saving')
        check(not errs, f'no page errors {errs}')
        await b.close()
    print('E2E', 'PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
asyncio.run(main())
