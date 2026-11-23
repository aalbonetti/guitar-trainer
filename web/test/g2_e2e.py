# G2 end-to-end: play mode in headless Chrome at 380 px (cover screen) and 760 px (inner screen). ?sim swaps the
# mic for synthesized notes and strums fed through the real capture worklet, pitch tracker and onset detector.
# __gtSimAnswer('right' | 'wrong' | 'octave' | 'neutral') plays a note for the question on screen; click-timed
# games get their notes/strums from __gtSimAuto. Rounds are shortened (__gtGameShortS / __gtGameShortBars).
# Note Drop, Fret Finder, Octave Jump (play, and tap at 380), Box Runner, In the Pocket (calibration, a Gap Click
# level): right answers score, wrong ones don't, and game_run is saved with mode=play.
# Run after `npm run build`.
import asyncio, http.server, threading, functools, sys, json, tempfile, os, re
from playwright.async_api import async_playwright
PORT=8786
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(Q,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{PORT}/?sim'
INIT = """window.__lat=0.12; window.__gtGameShortS=12; window.__gtGameShortBars=4;
window.__boxMod=(i,m)=>m; window.__pocketOff=i=>0;
window.__gtSimAuto=(kind,arg)=>{
  if(kind==='calibration'){ window.__gtSimStrums(arg.map(t=>t+window.__lat)); }
  if(kind==='game-box'){ const E=arg.expected, sp=E.length>1?E[1].t-E[0].t:0.5;
    window.__gtSimNotes(E.map((e,i)=>({midi:window.__boxMod(i,e.midi), t:e.t+window.__lat, dur:Math.min(0.8,sp-0.04), gain:0.45}))); }
  if(kind==='game-pocket'){ window.__gtSimStrums(arg.map((t,i)=>t+window.__lat+window.__pocketOff(i))); } };"""
# pk2 ★★ in play mode, so the Gap Click level (pk3) is open
SEED=os.path.join(tempfile.mkdtemp(),'seed.json')
json.dump({'game_best':[{'key':'G_in_the_pocket|pk2|play','game_id':'G_in_the_pocket','level_id':'pk2','mode':'play','best_score':100,'best_stars':2,'ghost':[],'at':0}]},open(SEED,'w'))
DB="(async(s)=>{const r=indexedDB.open('guitar-trainer');await new Promise(x=>r.onsuccess=x);return await new Promise(x=>{const q=r.result.transaction(s).objectStore(s).getAll();q.onsuccess=()=>x(q.result)})})"
ok=True
async def seedpage(pg, path):
    import json
    await pg.goto(f'{BASE}?sim#/settings'); await pg.wait_for_function('!!window.__gtImport')
    await pg.evaluate('d => window.__gtImport(d)', json.load(open(path))); await pg.reload(); await pg.wait_for_timeout(500)
def check(name, cond, extra=''):
    global ok; ok &= bool(cond); print('PASS' if cond else 'FAIL', name, '' if cond else extra)
async def score(pg): return int(await pg.inner_text('.hud div b'))
async def lives(pg): return (await pg.inner_text('.hud div:nth-child(3) b')).count('♥') - (await pg.inner_text('.hud .lost')).count('♥')
async def until(pg, f, t=3.0):
    for _ in range(int(t/0.1)):
        if await f(): return True
        await pg.wait_for_timeout(100)
    return False
async def _gt(pg, s0): return await score(pg) > s0
async def open_game(pg, game, level):
    await pg.goto(f'{BASE}#/arcade'); await pg.wait_for_selector('.tiles')
    await pg.goto(f'{BASE}#/arcade/{game}/{level}'); await pg.wait_for_selector('text=▶ Start')
async def start(pg, game, level, mode='play'):
    await open_game(pg, game, level)
    if await pg.locator('.segmented').count(): await pg.click(f'.segmented button:has-text("{"Play" if mode=="play" else "Tap"}")')
    await pg.click('text=▶ Start'); await pg.wait_for_selector('.playarea')
async def result(pg, t=60000):
    await pg.wait_for_selector('.result', timeout=t); return await pg.inner_text('.result')
async def last_run(pg, game):
    rows=[r for r in await pg.evaluate(DB+"('game_run')") if r['game_id']==game]; return rows[-1] if rows else None

async def run_width(b, W):
    print(f'===== {W} px =====')
    ctx=await b.new_context(viewport={'width':W,'height':860}); pg=await ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
    await pg.add_init_script(INIT)
    await seedpage(pg, SEED)
    # ---- Arcade home: the G2 games are playable ----
    await pg.goto(f'{BASE}#/arcade'); await pg.wait_for_selector('text=Octave Jump')
    tiles=await pg.inner_text('.tiles'); later=await pg.locator('details.later').count()
    check(f'{W}: Octave Jump, Box Runner, In the Pocket have tiles (since G3 nothing is "coming later")', all(x in tiles for x in ('Octave Jump','Box Runner','In the Pocket')) and later==0, later)
    check(f'{W}: Arcade home shows the streak', 'streak' in (await pg.inner_text('.xpcard')).lower())
    # ---- Note Drop, play mode ----
    await start(pg, 'G_note_drop', 'nd1'); await pg.wait_for_timeout(1300)
    gained=[]
    for i in range(5):
        s0=await score(pg); await pg.evaluate("__gtSimAnswer('right')"); r=await until(pg, lambda: _gt(pg, s0)); gained.append(r); await pg.wait_for_timeout(350)
    check(f'{W}: Note Drop play: 5 right notes score', all(gained), gained)
    if W==760:
        bb=await pg.evaluate("(()=>{const a=document.querySelector('.gboard').getBoundingClientRect(),b=document.querySelector('.gside').getBoundingClientRect();return [a.x,b.x,a.y,b.y]})()")
        check('760: unfolded layout puts the board left, read-out right', bb[0] < bb[1], bb)
    else:
        bb=await pg.evaluate("(()=>{const a=document.querySelector('.gboard').getBoundingClientRect(),b=document.querySelector('.gside').getBoundingClientRect();return [a.x,b.x,a.y,b.y]})()")
        check('380: cover-screen layout: target on top, fretboard below', bb[3] < bb[2], bb)
    await pg.screenshot(path=f'/tmp/g2_notedrop_{W}.png')
    # pause: the mic closes; the tuner and metronome sheets are in the menu; resume reopens the mic
    await pg.click('.hud button[aria-label=Pause]'); await pg.wait_for_selector('.pausemenu'); await pg.wait_for_timeout(300)
    cap=await pg.evaluate('__gtAudio().capture.on'); menu=await pg.inner_text('.pausemenu')
    await pg.click('.pausemenu button:has-text("Tuner")'); await pg.wait_for_selector('.pausemenu .tuner')
    await pg.click('.pausemenu button:has-text("Metronome")'); await pg.wait_for_selector('.pausemenu .metro')
    check(f'{W}: pause closes the mic and offers tuner + metronome', not cap and 'Resume' in menu, (cap, menu))
    await pg.screenshot(path=f'/tmp/g2_pause_{W}.png')
    await pg.click('.pausemenu button:has-text("Resume")'); await pg.wait_for_timeout(1000)
    check(f'{W}: resume reopens the mic', await pg.evaluate('__gtAudio().capture.on'))
    s0=await score(pg); l0=await lives(pg)
    await pg.evaluate("__gtSimAnswer('octave')"); await until(pg, lambda: _lives_lt(pg, l0)); await pg.wait_for_timeout(300)
    check(f'{W}: Note Drop play: an octave outside the zone costs a life, no points', await lives(pg)==l0-1 and await score(pg)==s0, (await lives(pg), l0))
    for i in range(2):
        l0=await lives(pg); await pg.evaluate("__gtSimAnswer('wrong')"); await until(pg, lambda: _lives_lt(pg, l0)); await pg.wait_for_timeout(400)
    res=await result(pg); print(res.replace('\n',' | '))
    run=await last_run(pg,'G_note_drop')
    check(f'{W}: Note Drop round saved with mode=play, 5/8 right', run and run['mode']=='play' and run['score']>0 and abs(run['accuracy']-5/8)<1e-6 and '63%' in res, run)
    check(f'{W}: results name the misses', 'To work on' in res and 'octave off' in res, res)
    # ---- Fret Finder, play mode ----
    await start(pg, 'G_fret_finder', 'ff1'); await pg.wait_for_timeout(1300)
    gained=[]
    for i in range(3):
        s0=await score(pg); await pg.evaluate("__gtSimAnswer('right')"); gained.append(await until(pg, lambda: _gt(pg, s0))); await pg.wait_for_timeout(350)
    s0=await score(pg); await pg.evaluate("__gtSimAnswer('wrong')"); await pg.wait_for_timeout(1200)
    side=await pg.inner_text('.gside')
    check(f'{W}: Fret Finder play: 3 right places score, a wrong note doesn\'t', all(gained) and await score(pg)==s0 and '✗ heard' in side, (gained, side))
    res=await result(pg, 20000); run=await last_run(pg,'G_fret_finder')
    check(f'{W}: Fret Finder round saved with mode=play, 3/4 right', run and run['mode']=='play' and run['accuracy']==0.75 and run['stars']==1, run)
    # ---- Octave Jump, play mode ----
    await start(pg, 'G_octave_jump', 'oj1'); await pg.wait_for_timeout(1300)
    s0=await score(pg); await pg.evaluate("__gtSimAnswer('neutral')"); await pg.wait_for_timeout(1200)
    neutral_ok=await score(pg)==s0 and '✗' not in await pg.inner_text('.gside')
    s0=await score(pg); await pg.evaluate("__gtSimAnswer('right')"); r1=await until(pg, lambda: _gt(pg, s0)); await pg.wait_for_timeout(400)
    s0=await score(pg); await pg.evaluate("__gtSimAnswer('octave')"); await pg.wait_for_timeout(1200); oct_side=await pg.inner_text('.gside'); r2=await score(pg)==s0
    s0=await score(pg); await pg.evaluate("__gtSimAnswer('right')"); r3=await until(pg, lambda: _gt(pg, s0))
    check(f'{W}: Octave Jump play: the low note is a free start, the octave scores, a wrong octave doesn\'t', neutral_ok and r1 and r2 and r3 and 'wrong octave' in oct_side, (neutral_ok, r1, r2, r3, oct_side))
    await pg.screenshot(path=f'/tmp/g2_octave_{W}.png')
    res=await result(pg, 20000); run=await last_run(pg,'G_octave_jump')
    check(f'{W}: Octave Jump round saved with mode=play, 2/3 right', run and run['mode']=='play' and abs(run['accuracy']-2/3)<1e-6, run)
    if W==380:
        # tap fallback: tap the octave shape
        await start(pg, 'G_octave_jump', 'oj1', mode='tap')
        sub=await pg.inner_text('.target span'); m=re.search(r'string (\d), fret (\d+)', sub); s,f=int(m.group(1)),int(m.group(2))
        s0=await score(pg); await pg.dispatch_event(f'rect.hit[data-s="{s-2}"][data-f="{f+2}"]','pointerdown'); await pg.wait_for_timeout(300)
        check('380: Octave Jump tap mode: tapping the octave shape scores', await score(pg)>s0)
        await pg.click('.hud button[aria-label=Pause]'); await pg.click('.pausemenu button:has-text("Quit")'); await pg.wait_for_selector('text=▶ Start')
        check('380: Octave Jump remembers tap mode', await pg.get_attribute('.segmented button:has-text("Tap")', 'aria-checked')=='true')
    # ---- Box Runner (quarters, 70 BPM, 4 bars = 16 notes), 2 wrong notes; at 380 the phone is unfolded mid-round ----
    await pg.evaluate("window.__boxMod=(i,m)=>(i===3||i===9)?m+1:m")
    await start(pg, 'G_box_runner', 'br1'); await pg.wait_for_timeout(6000)
    await pg.screenshot(path=f'/tmp/g2_box_{W}.png')
    if W==760:
        bb=await pg.evaluate("(()=>{const a=document.querySelector('.gboard').getBoundingClientRect(),b=document.querySelector('.gside').getBoundingClientRect();return [a.x,b.x]})()")
        check('760: Box Runner board left, read-out right', bb[0] < bb[1], bb)
    else:
        await pg.set_viewport_size({'width':760,'height':860}); await pg.wait_for_timeout(1500); await pg.set_viewport_size({'width':380,'height':860})
    res=await result(pg, 40000); print(res.replace('\n',' | ')); run=await last_run(pg,'G_box_runner')
    check(f'{W}: Box Runner: 14/16 notes right{" (survives a fold)" if W==380 else ""}, saved with mode=play', run and run['mode']=='play' and abs(run['accuracy']-14/16)<1e-6 and run['score']>0 and run['stars']==2, run)
    check(f'{W}: Box Runner misses name the note and place', len(json.loads(run['misses_json']))==2 and 'string' in res, res)
    await pg.evaluate("window.__boxMod=(i,m)=>m")
    # ---- In the Pocket: calibration first, then quarter notes (2 strums off the beat) ----
    await pg.evaluate("window.__pocketOff=i=>i===5?0.15:i===11?-0.12:0")
    await open_game(pg, 'G_in_the_pocket', 'pk1'); await pg.click('text=▶ Start')
    await pg.wait_for_selector('text=strum calibration', timeout=10000)
    await pg.click('.calib button:has-text("Calibrate")'); await pg.wait_for_selector('text=Calibrated ✓', timeout=40000); await pg.wait_for_selector('text=▶ Start', timeout=5000)
    check(f'{W}: In the Pocket asks for a strum calibration first', True)
    await pg.click('text=▶ Start'); await pg.wait_for_selector('.pocketmeter', timeout=5000); await pg.wait_for_timeout(7000)
    await pg.screenshot(path=f'/tmp/g2_pocket_{W}.png')
    res=await result(pg, 40000); print(res.replace('\n',' | ')); run=await last_run(pg,'G_in_the_pocket')
    check(f'{W}: In the Pocket: 14/16 strums in the pocket, saved with mode=play', run and run['mode']=='play' and abs(run['accuracy']-14/16)<1e-6 and run['score']>0, run)
    check(f'{W}: In the Pocket names late and early strums', 'late strums' in res and 'early strums' in res, res)
    # ---- Gap Click (pk3, opened by the seeded ★★ on pk2): the click drops out for a bar, strums continue ----
    await pg.evaluate("window.__pocketOff=i=>0")
    await open_game(pg, 'G_in_the_pocket', 'pk3'); await pg.click('text=▶ Start')
    await pg.wait_for_selector('.pocketmeter', timeout=5000)
    seen_gap=seen_back=False
    for _ in range(200):
        if await pg.locator('.result').count(): break
        t=await pg.inner_text('.playarea') if await pg.locator('.playarea').count() else ''
        seen_gap |= 'Click off' in t; seen_back |= 'Back from the 1-bar gap' in t
        await pg.wait_for_timeout(150)
    plan=await pg.evaluate('__gtGamePlan')
    res=await result(pg, 30000); run=await last_run(pg,'G_in_the_pocket')
    check(f'{W}: Gap Click: no clicks in the gap bar (16 of 20), strums through it all count', len(plan['clicks'])==16 and len(plan['slots'])==32 and run['level_id']=='pk3' and run['accuracy']==1, (len(plan['clicks']), len(plan['slots']), run))
    check(f'{W}: Gap Click shows the gap and the landing', seen_gap and seen_back, (seen_gap, seen_back))
    if W==380:
        # ---- unfold after calibrating folded: In the Pocket asks again (no false "Calibrated"), then the round starts ----
        await pg.set_viewport_size({'width':760,'height':860})
        await open_game(pg, 'G_in_the_pocket', 'pk1'); await pg.click('text=▶ Start')
        await pg.wait_for_selector('text=strum calibration', timeout=10000); await pg.wait_for_timeout(800)
        txt=await pg.inner_text('.page')
        check('fold change: In the Pocket asks for a new calibration, no stale "Calibrated"', 'Calibrated ✓' not in txt and await pg.locator('.calib button:has-text("Calibrate")').count()==1, txt)
        await pg.click('.calib button:has-text("Calibrate")'); await pg.wait_for_selector('text=Calibrated ✓', timeout=40000)
        await pg.click('text=▶ Start'); ok_start=True
        try: await pg.wait_for_selector('.pocketmeter', timeout=8000)
        except Exception: ok_start=False
        check('fold change: after calibrating, the round starts', ok_start)
        await pg.click('.hud button[aria-label=Pause]'); await pg.click('.pausemenu button:has-text("Quit")')
        await pg.set_viewport_size({'width':380,'height':860})
    # ---- practice minutes for the streak were logged while playing ----
    days=await pg.evaluate(DB+"('practice_day')")
    check(f'{W}: today has practice minutes logged (activity clock)', any(d.get('active_s',0)>=30 for d in days), days)
    check(f'{W}: no page errors', not errs, errs)
    await ctx.close()

async def _lives_lt(pg, l0): return await lives(pg) < l0

async def slow_mic(b):
    # the mic takes 1.5 s to open (a permission prompt); pausing or quitting meanwhile must not leave it open
    print('===== slow mic open =====')
    ctx=await b.new_context(viewport={'width':380,'height':860}); pg=await ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    await pg.goto(f'http://127.0.0.1:{PORT}/?sim&simdelay=1500#/arcade/G_note_drop/nd1'); await pg.wait_for_selector('text=▶ Start')
    await pg.click('.segmented button:has-text("Play")'); await pg.click('text=▶ Start'); await pg.wait_for_selector('.playarea')
    await pg.wait_for_timeout(300); await pg.click('.hud button[aria-label=Pause]'); await pg.wait_for_timeout(2500)
    paused_on=await pg.evaluate('__gtAudio().capture.on')
    await pg.click('.pausemenu button:has-text("Resume")'); await pg.wait_for_timeout(2500)
    resumed_on=await pg.evaluate('__gtAudio().capture.on')
    await pg.click('.hud button[aria-label=Pause]'); await pg.click('.pausemenu button:has-text("Resume")'); await pg.wait_for_timeout(300)
    await pg.click('.hud button[aria-label=Pause]'); await pg.click('.pausemenu button:has-text("Quit")'); await pg.wait_for_timeout(2500)
    quit_on=await pg.evaluate('__gtAudio().capture.on')
    check('slow mic: pause while opening leaves it closed; resume opens it; quit while opening closes it', not paused_on and resumed_on and not quit_on, (paused_on, resumed_on, quit_on))
    check('slow mic: no page errors', not errs, errs)
    await ctx.close()

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--autoplay-policy=no-user-gesture-required'])
        await slow_mic(b)
        for W in (380, 760): await run_width(b, W)
        await b.close()
    print('E2E', 'PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
asyncio.run(main())
