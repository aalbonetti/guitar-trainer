# M5 end-to-end: restore a backup file (seeded progress + set list), then run the daily loop:
# due badge → queue → Start practice → session bar → Next through items → Finish → summary → Progress → backup download.
import asyncio, http.server, threading, functools, sys, json, datetime, tempfile, os
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
async def main():
    ok=True
    def check(c,m):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+m); ok&=bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx=await b.new_context(viewport={'width':412,'height':880},accept_downloads=True); pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(f'http://127.0.0.1:{PORT}/#/settings'); await pg.wait_for_selector('text=Backup')
        await pg.set_input_files('section.card:has-text("Backup") input[type=file]', bf)
        await pg.wait_for_timeout(1500); await pg.goto(f'http://127.0.0.1:{PORT}/#/today'); await pg.wait_for_selector("text=Today's practice")
        badge=await pg.locator('.navbadge').first.inner_text(); check(badge=='1', f'due badge shows 1 (got {badge})')
        q=await pg.locator('.practice ol.queue').inner_text(); print(q)
        check('Warm-up' in q and 'Review' in q and 'A.05' in q and song['title'] in q and 'Song of the week' in q, 'queue: warm-up, review, passed-once A.05, song of the week')
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
        await pg.click('.sessionbar >> text=Next ›'); check('#/song/' in pg.url, 'Next → song')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/today'); await pg.wait_for_selector('text=Practice in progress')
        prog=await pg.locator('.practice').inner_text(); check(prog.count('✓')>=3, 'three items ticked')
        await pg.reload(); await pg.wait_for_selector('.sessionbar'); check(True,'session survives reload')
        await pg.click('.sessionbar >> text=Finish'); await pg.wait_for_selector('.summary')
        sm=await pg.inner_text('.summary'); print(sm); check('4 of 4' in sm, 'summary counts 4 of 4 items')
        await pg.screenshot(path='/tmp/m5_summary.png')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/lesson/A.09'); await pg.wait_for_selector('text=Not unlocked yet')
        check(await pg.locator('text=Start at').count()==0, 'locked lesson A.09 has no attempt button')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/progress'); await pg.wait_for_selector('text=Minutes per week'); await pg.wait_for_timeout(300)
        pt=await pg.inner_text('.page'); check('3-day streak' in pt, 'finishing items counts today: 3-day streak'); await pg.screenshot(path='/tmp/m5_progress.png', full_page=True)
        await pg.goto(f'http://127.0.0.1:{PORT}/#/settings'); await pg.wait_for_selector('text=Save backup file')
        async with pg.expect_download() as dl: await pg.click('text=Save backup file')
        d=await dl.value; path=await d.path(); data=json.load(open(path))
        check(len(data['lesson_progress'])==len(lp) and len(data['practice_session'])==2 and 'gt_setlist_v1' in data['_local'], f'backup file {d.suggested_filename} has progress, 2 sessions, set list')
        check(not errs, f'no page errors {errs}')
        await b.close()
    print('E2E', 'PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
asyncio.run(main())
