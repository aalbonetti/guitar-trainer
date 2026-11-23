# G1 end-to-end: Arcade locks for a new player; with lessons unlocked, play the six tap games by reading the
# screen and answering correctly; check stars, XP, personal bests and review credit (T.03 / F.07).
import asyncio, http.server, threading, functools, sys, json, tempfile, os, datetime, re
from playwright.async_api import async_playwright
PORT=8778
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(http.server.SimpleHTTPRequestHandler,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
L=json.load(open('public/catalog/lessons.json')); today=datetime.date.today(); D=lambda n:(today+datetime.timedelta(days=n)).isoformat()
lp=[{'lesson_id':l['id'],'state':'passed','first_pass_day':D(-30),'passed_day':D(-29),'review_index':1,'next_review_day':D(20),'mastered':False,'updated_at':0} for l in L if l['track'] in ('F','T')]
for x in lp:
    if x['lesson_id'] in ('T.03','F.07'): x['next_review_day']=D(-1)
BK=os.path.join(tempfile.mkdtemp(),'seed.json'); json.dump({'lesson_progress':lp},open(BK,'w'))
OPEN=[40,45,50,55,59,64]; SH=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']; FL=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
async def seedpage(pg, path):
    import json
    await pg.goto(f'http://127.0.0.1:{PORT}/?sim#/settings'); await pg.wait_for_function('!!window.__gtImport')
    await pg.evaluate('d => window.__gtImport(d)', json.load(open(path))); await pg.reload(); await pg.wait_for_timeout(500)
def pc_of(label):  # "F♯/G♭" or "G"
    n=label.split('/')[0].replace('♯','#'); return SH.index(n)
PCN={**{n:i for i,n in enumerate(SH)},**{n:i for i,n in enumerate(FL)}}
FLATK={'F','Bb','Eb','Ab','Db','Gb'}
def chord_of(num,key):
    d={'1':0,'2':2,'3':4,'4':5,'5':7,'6':9}[num[0]]; pc=(PCN[key]+d)%12; return (FL if key in FLATK else SH)[pc]+('m' if num.endswith('m') else '')
async def main():
    ok=True
    def check(c,m):
        nonlocal ok; print(('PASS ' if c else 'FAIL ')+m); ok&=bool(c)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--autoplay-policy=no-user-gesture-required']); pg=await b.new_page(viewport={'width':412,'height':880}); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade'); await pg.wait_for_selector('text=Note Drop')
        # since G3 every game is built: no "Coming later" card, Song Run has its own tile
        t=await pg.inner_text('.tiles'); later=await pg.locator('details.later').count(); check(t.count('★★ on level')>=10 and later==0 and 'Song Run' in t and 'Taught in' in t, 'new player: first level of every game open, later levels need ★★, every game has a tile')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade/G_capo_quick/cq1'); await pg.wait_for_selector('text=▶ Start'); check(True, 'new player can open level 1')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade/G_capo_quick/cq2'); await pg.wait_for_selector('text=Get ★★ on the previous level'); check(True, 'level 2 waits for ★★ on level 1')
        await seedpage(pg, BK)
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade'); await pg.wait_for_selector('text=Note Drop'); await pg.wait_for_timeout(300)
        g1=['Note Drop','Fret Finder','Call the Number','Hear the Change','Capo Quick','Delay Math']
        t=' '.join([await pg.inner_text(f'section.tile:has-text("{n}")') for n in g1]); check('Taught in' not in t, 'F + T passed: no "taught in" tips on the G1 games')
        await pg.screenshot(path='/tmp/g1_home.png', full_page=True)
        # --- Call the Number cn1, a full 60 s round, all correct ---
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade/G_call_the_number/cn1'); await pg.click('text=▶ Start')
        n=0
        while await pg.locator('.playarea').count():
            try:
                num=(await pg.inner_text('.target b',timeout=1500)).strip(); key=re.search(r'Key of (\S+)',await pg.inner_text('.target span')).group(1).replace('♯','#').replace('♭','b')
                ans=chord_of(num,key).replace('#','♯').replace('b','♭') if len(chord_of(num,key))>1 else chord_of(num,key)
                ans=chord_of(num,key); disp=ans.replace('#','♯'); disp=re.sub(r'(?<=[A-G])b','♭',disp)
                await pg.click(f'.choices button:text-is("{disp}")',timeout=1500); n+=1; await pg.wait_for_timeout(260)
                if n==3: await pg.locator('.playarea').screenshot(path='/tmp/g1_call.png')
            except Exception as e:
                if not await pg.locator('.playarea').count(): break
        await pg.wait_for_selector('.result',timeout=10000); res=await pg.inner_text('.result'); print(res.replace('\n',' | '))
        check(n>20 and '100%' in res, f'call the number: {n} answers, 100%'); check('review for T.03' in res, 'counted as the T.03 review')
        await pg.screenshot(path='/tmp/g1_result.png')
        # --- Note Drop nd1: 20 right, then 3 wrong ---
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade/G_note_drop/nd1'); await pg.click('text=▶ Start')
        for i in range(20):
            lab=(await pg.inner_text('.sky .drop')).strip(); pc=pc_of(lab)
            pos=next((s,f) for s in (6,5) for f in range(0,6) if (OPEN[6-s]+f)%12==pc)
            await pg.dispatch_event(f'rect.hit[data-s="{pos[0]}"][data-f="{pos[1]}"]','pointerdown'); await pg.wait_for_timeout(60)
        for i in range(3):
            lab=(await pg.inner_text('.sky .drop')).strip(); pc=pc_of(lab)
            pos=next((s,f) for s in (6,5) for f in range(0,6) if (OPEN[6-s]+f)%12!=pc)
            await pg.dispatch_event(f'rect.hit[data-s="{pos[0]}"][data-f="{pos[1]}"]','pointerdown'); await pg.wait_for_timeout(80)
        await pg.wait_for_selector('.result',timeout=10000); res=await pg.inner_text('.result'); print(res.replace('\n',' | '))
        check('87%' in res and 'review for F.07' in res, 'note drop: 20/23, ★★, counted as F.07 review')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade'); await pg.wait_for_timeout(300); nd=await pg.inner_text('section.tile:has-text("Note Drop")'); check('🔒 Strings 6 & 5, frets 0–12' not in nd and nd.count('★★ on level')==2, 'note drop level 2 opened by the ★★ round')
        # --- Delay Math: answer correctly for a few, then quit ---
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade/G_delay_math/dm1'); await pg.click('text=▶ Start')
        for i in range(4):
            bpm=int((await pg.inner_text('.target b')).split()[0]); ms=str(round(45000/bpm))
            for d in ms: await pg.click(f'.keypad button:text-is("{d}")')
            await pg.click('.keypad button:text-is("✓")'); await pg.wait_for_timeout(500)
        sc=int(await pg.inner_text('.hud div b')); check(sc>=400, f'delay math scoring ({sc})'); await pg.locator('.playarea').screenshot(path='/tmp/g1_delay.png'); await pg.click('.hud button')
        # --- Fret Finder: find all of the first note ---
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade/G_fret_finder/ff1'); await pg.click('text=▶ Start')
        lab=(await pg.inner_text('.target b')).strip(); pc=pc_of(lab)
        for s in (6,5,4):
            for f in range(0,6):
                if (OPEN[6-s]+f)%12==pc: await pg.dispatch_event(f'rect.hit[data-s="{s}"][data-f="{f}"]','pointerdown'); await pg.wait_for_timeout(50)
        lab2=(await pg.inner_text('.target b')).strip(); check(lab2!=lab, f'fret finder: found every {lab}, moved on to {lab2}'); await pg.locator('.playarea').screenshot(path='/tmp/g1_finder.png'); await pg.click('.hud button')
        # --- Capo Quick: answer a few ---
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade/G_capo_quick/cq1'); await pg.click('text=▶ Start')
        for i in range(4):
            pr=await pg.inner_text('.target b'); m=re.search(r'Song in (\S+)\. You want (\w) shapes',pr); k=m.group(1).replace('♯','#').replace('♭','b'); c=(PCN[k]-PCN[m.group(2)])%12
            await pg.click(f'.choices button:text-is("{c}")'); await pg.wait_for_timeout(300)
        check(int(await pg.inner_text('.hud div b'))>=400, 'capo quick scoring'); await pg.click('.hud button')
        # --- Hear the Change: plays and accepts answers ---
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade/G_hear_the_change/hc1'); await pg.click('text=▶ Start')
        await pg.click('.choices button >> nth=1'); await pg.wait_for_timeout(1000); check(await pg.locator('.choices button').count()==2, 'hear the change (major/minor) runs'); await pg.locator('.playarea').screenshot(path='/tmp/g1_hear.png'); await pg.click('.hud button')
        await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade'); await pg.wait_for_timeout(400); xp=await pg.inner_text('.xpcard')
        tot=int(re.search(r'(\d+) XP',xp).group(1)); check(tot>=60, f'XP added ({tot}): games + 2 reviews'); await pg.screenshot(path='/tmp/g1_home2.png')
        st=await pg.inner_text('.tiles'); check('★' in st, 'best stars shown on level list')
        await pg.set_viewport_size({'width':900,'height':800}); await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade/G_note_drop/nd2'); await pg.click('text=▶ Start'); await pg.wait_for_timeout(800); await pg.screenshot(path='/tmp/g1_unfolded.png')
        check(not errs, f'no page errors {errs}'); await b.close()
    print('E2E','PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
asyncio.run(main())
