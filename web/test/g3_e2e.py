# G3 end-to-end in headless Chrome at 380 px (cover screen) and 760 px (inner screen). ?sim swaps the mic for
# synthesized strums (Karplus-Strong strings, window.__gtSimChords) fed through the real capture worklet, onset
# detector, chroma analyzer and chord verifier.
#  - DB upgrade v5 → v6: existing progress kept, badge + daily_challenge stores added
#  - Call the Number play mode (auto: right strums score, a wrong chord doesn't and is named; assisted: "I played
#    it right" counts the miss), mic closed on pause and at the end, layout per width
#  - Triad Hunt tap (tapping a triad in the window) and play
#  - Change Sprint (auto, changes counted; assisted, the round asks whether it counts)
#  - Song Run (key + capo + bars per chord chosen, scored per bar, a wrong bar named; a forgotten capo fails)
#  - Daily Challenge (built from seeded weak spots, same after reload, completes with +30 XP)
#  - heatmap on Progress, badges (Set Ready from a set list on the phone, Capo Brain, Faithful)
# Seeds via window.__gtImport (exists only with ?sim). Run after `npm run build`, on its own (not in parallel).
import asyncio, http.server, threading, functools, sys, json, tempfile, os, re, datetime
from playwright.async_api import async_playwright
PORT=8790
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(Q,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{PORT}/?sim'
# Strums land 30 ms after the click bleed (0.09 s in ?sim), like G2: a strum exactly on the bleed must beat the
# click-bleed onset floor (the M4 rule), which a restrum of a still-ringing chord sometimes doesn't in the synth.
INIT = """window.__lat=0.12; window.__gtGameShortS=12; window.__songSwap=(i,f)=>f; window.__songCapo=c=>c;
window.__gtSimAuto=(kind,arg)=>{
  if(kind==='game-sprint'){ const out=[]; let k=0; for(let t=arg.t0+0.3;t<arg.t1-0.2;t+=1.0,k++) out.push({frets:arg.cycle[k%arg.cycle.length], t:t+window.__lat, dur:0.95}); window.__gtSimChords(out); }
  if(kind==='game-song'){ const out=[]; arg.boxes.forEach((b,i)=>{ const fr=window.__songSwap(i,b.frets); const n=Math.max(1,Math.round((b.t1-b.t0)/arg.beat/2));
    for(let k=0;k<n;k++) out.push({frets:fr, capo:window.__songCapo(arg.capo), t:b.t0+k*arg.beat*2+window.__lat, dur:arg.beat*2}); }); window.__gtSimChords(out); } };"""
L=json.load(open('public/catalog/lessons.json')); GAMES=json.load(open('public/catalog/games.json'))
today=datetime.date.today(); D=lambda n:(today+datetime.timedelta(days=n)).isoformat()
lp=[{'lesson_id':l['id'],'state':'passed','first_pass_day':D(-30),'passed_day':D(-29),'review_index':1,'next_review_day':D(20),'mastered':False,'updated_at':0} for l in L if l['track'] in ('F','T','A','ER')]
for x in lp:
    if x['lesson_id']=='T.04': x['next_review_day']=D(-1)   # a review due → the Daily Challenge picks Capo Quick
HEAT=[{'quiz_id':'arcade:fretboard','item_key':k,'seen':s,'correct':c,'ms_sum':m} for k,s,c,m in [('s5f3',6,2,4000),('s6f5',5,1,3000),('s6f3',8,8,8000),('s5f5',6,6,6000),('s6f1',4,4,4400)]]
QUIZ=[{'quiz_id':'Q_capo','item_key':'Bb-G','seen':5,'correct':1}]
DAYS=[{'day':D(-i),'active_s':400} for i in range(1,32)]   # a 31-day streak before today → Faithful
RUNS=[{'game_id':'G_capo_quick','level_id':'cq1','mode':'tap','score':5000,'accuracy':1,'max_combo':4,'max_streak':31,'stars':3,'duration_s':60,'misses_json':'[]','at':1}]
SEED=os.path.join(tempfile.mkdtemp(),'seed.json')
json.dump({'lesson_progress':lp,'quiz_item_stats':HEAT+QUIZ,'practice_day':DAYS,'game_run':RUNS},open(SEED,'w'))
DB="(async(s)=>{const r=indexedDB.open('guitar-trainer');await new Promise(x=>r.onsuccess=x);return await new Promise(x=>{const q=r.result.transaction(s).objectStore(s).getAll();q.onsuccess=()=>x(q.result)})})"
OPEN=[40,45,50,55,59,64]; SH=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']; FL=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
PCN={**{n:i for i,n in enumerate(SH)},**{n:i for i,n in enumerate(FL)}}
ok=True
def check(name, cond, extra=''):
    global ok; ok &= bool(cond); print('PASS' if cond else 'FAIL', name, '' if cond else extra)
async def seedpage(pg, path, local=None):
    await pg.goto(f'{BASE}#/settings'); await pg.wait_for_function('!!window.__gtImport')
    d=json.load(open(path))
    if local: d['_local']=local
    await pg.evaluate('d => window.__gtImport(d)', d); await pg.reload(); await pg.wait_for_timeout(500)
async def score(pg): return int(await pg.inner_text('.hud div b'))
async def until(pg, f, t=4.0):
    for _ in range(int(t/0.1)):
        if await f(): return True
        await pg.wait_for_timeout(100)
    return False
async def gt(pg, s0): return await score(pg) > s0
async def open_game(pg, game, level, suffix=''):
    await pg.goto(f'{BASE}#/arcade'); await pg.wait_for_selector('.tiles')
    await pg.goto(f'{BASE}#/arcade/{game}/{level}{suffix}'); await pg.wait_for_selector('text=▶ Start')
async def start(pg, game, level, mode='play'):
    await open_game(pg, game, level); await pg.evaluate('window.__gtSimStop && __gtSimStop()')
    if await pg.locator('.segmented').count(): await pg.click(f'.segmented button:has-text("{"Play" if mode=="play" else "Tap"}")')
    await pg.click('text=▶ Start'); await pg.wait_for_selector('.playarea')
async def mic_on(pg):
    await until(pg, lambda: pg.evaluate('__gtAudio().capture.on'), 8.0); await pg.wait_for_timeout(500)
async def result(pg, t=60000):
    await pg.wait_for_selector('.result', timeout=t); return await pg.inner_text('.result')
async def last_run(pg, game):
    rows=[r for r in await pg.evaluate(DB+"('game_run')") if r['game_id']==game]; return rows[-1] if rows else None
def set_modes(m): return {'gt_grader_modes': json.dumps({'chord_accuracy': m, 'changes_per_min': m})}
async def grader(pg, m): await pg.evaluate("m => localStorage.setItem('gt_grader_modes', JSON.stringify({chord_accuracy:m, changes_per_min:m}))", m)

async def upgrade(b):
    print('===== DB upgrade v5 → v6 =====')
    ctx=await b.new_context(viewport={'width':380,'height':860}); pg=await ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    # an old (v5) database with progress in it, made before the app ever loads
    await pg.goto(f'http://127.0.0.1:{PORT}/manifest.webmanifest')
    await pg.evaluate("""() => new Promise((res, rej) => { const r = indexedDB.open('guitar-trainer', 5);
      r.onupgradeneeded = () => { const d = r.result;
        d.createObjectStore('lesson_progress', { keyPath: 'lesson_id' }); d.createObjectStore('attempt', { keyPath: 'id', autoIncrement: true }).createIndex('lesson_id', 'lesson_id');
        d.createObjectStore('practice_day', { keyPath: 'day' }); d.createObjectStore('quiz_item_stats', { keyPath: ['quiz_id', 'item_key'] }); d.createObjectStore('kv', { keyPath: 'key' });
        d.createObjectStore('calibration', { keyPath: 'key' }); d.createObjectStore('practice_session', { keyPath: 'id' }).createIndex('day', 'day'); d.createObjectStore('imported_chart', { keyPath: 'id' });
        d.createObjectStore('game_run', { keyPath: 'id', autoIncrement: true }).createIndex('game_id', 'game_id'); d.createObjectStore('game_best', { keyPath: 'key' });
        d.createObjectStore('xp_ledger', { keyPath: 'id', autoIncrement: true }); d.createObjectStore('service_day', { keyPath: 'day' }); };
      r.onsuccess = () => { const d = r.result, t = d.transaction(['lesson_progress', 'game_best', 'xp_ledger'], 'readwrite');
        t.objectStore('lesson_progress').put({ lesson_id: 'F.01', state: 'passed', first_pass_day: '2026-01-01', passed_day: '2026-01-02', review_index: 5, mastered: true, updated_at: 0 });
        t.objectStore('game_best').put({ key: 'G_capo_quick|cq1|tap', game_id: 'G_capo_quick', level_id: 'cq1', mode: 'tap', best_score: 4321, best_stars: 2, ghost: [], at: 0 });
        t.objectStore('xp_ledger').add({ at: 0, source: 'lesson_pass', ref_id: 'F.01', xp: 50 });
        t.oncomplete = () => { d.close(); res(); }; t.onerror = () => rej(t.error); }; r.onerror = () => rej(r.error); })""")
    await pg.goto(f'http://127.0.0.1:{PORT}/#/arcade'); await pg.wait_for_selector('.tiles'); await pg.wait_for_timeout(800)
    info=await pg.evaluate("""() => new Promise(res => { const r = indexedDB.open('guitar-trainer'); r.onsuccess = () => { const d = r.result; const names = [...d.objectStoreNames];
      const t = d.transaction(['lesson_progress', 'game_best', 'xp_ledger']); const out = { v: d.version, names }; let n = 0;
      for (const s of ['lesson_progress', 'game_best', 'xp_ledger']) { const q = t.objectStore(s).getAll(); q.onsuccess = () => { out[s] = q.result.length; if (++n === 3) res(out); }; } }; })""")
    check('upgrade: v6 with badge + daily_challenge, old rows kept', info['v']==6 and 'badge' in info['names'] and 'daily_challenge' in info['names'] and info['lesson_progress']==1 and info['game_best']==1 and info['xp_ledger']==1, info)
    tile=await pg.inner_text('section.tile:has-text("Capo Quick")')
    check('upgrade: the old best still shows on the Arcade', '4321' in tile, tile)
    check('upgrade: no page errors', not errs, errs)
    await ctx.close()

async def run_width(b, W):
    print(f'===== {W} px =====')
    ctx=await b.new_context(viewport={'width':W,'height':860}); pg=await ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
    await pg.add_init_script(INIT)
    await seedpage(pg, SEED, set_modes('auto'))

    # ---- Call the Number, play mode, auto grading ----
    await start(pg, 'G_call_the_number', 'cn1'); await mic_on(pg)
    gained=[]
    for i in range(3):
        s0=await score(pg); await pg.evaluate("__gtSimChordAnswer('right')"); gained.append(await until(pg, lambda: gt(pg, s0))); await pg.wait_for_timeout(600)
    s0=await score(pg); await pg.evaluate("__gtSimChordAnswer('wrong')"); await pg.wait_for_timeout(1800)
    side=await pg.inner_text('.gside')
    check(f'{W}: Call the Number play: 3 right chords score, a wrong one doesn\'t and is named', all(gained) and await score(pg)==s0 and '✗ heard' in side, (gained, side, await pg.evaluate('window.__gtStrumLog')))
    bb=await pg.evaluate("(()=>{const a=document.querySelector('.gboard').getBoundingClientRect(),b=document.querySelector('.gside').getBoundingClientRect();return [a.x,b.x,a.y,b.y]})()")
    check(f'{W}: layout ({"board left, read-out right" if W>=760 else "target on top, answers below"})', bb[0] < bb[1] if W>=760 else bb[3] < bb[2], bb)
    await pg.screenshot(path=f'/tmp/g3_callnumber_{W}.png')
    await pg.click('.hud button[aria-label=Pause]'); await pg.wait_for_selector('.pausemenu'); await pg.wait_for_timeout(300)
    check(f'{W}: pause closes the mic (chord game)', not await pg.evaluate('__gtAudio().capture.on'))
    await pg.click('.pausemenu button:has-text("Resume")'); await pg.wait_for_timeout(900)
    check(f'{W}: resume reopens it', await pg.evaluate('__gtAudio().capture.on'))
    res=await result(pg, 30000); run=await last_run(pg, 'G_call_the_number')
    ex=json.loads(run.get('extra_json') or '{}')
    check(f'{W}: round saved: play mode, auto grading, 3/4, keys tallied for All Twelve', run['mode']=='play' and run['grader_mode']=='auto' and abs(run['accuracy']-0.75)<1e-6 and ex.get('keys',{}).get('G')==[3,4], (run, await pg.evaluate('window.__gtStrumLog')))
    check(f'{W}: results name the miss with what was heard', 'To work on' in res and 'heard' in res, res)
    check(f'{W}: mic closed at the end', not await pg.evaluate('__gtAudio().capture.on'))

    # ---- assisted: a miss can be counted with "I played it right" ----
    await grader(pg, 'assisted')
    await start(pg, 'G_call_the_number', 'cn1'); await mic_on(pg)
    s0=await score(pg); await pg.evaluate("__gtSimChordAnswer('wrong')"); await until(pg, lambda: pg.locator('button.override').count())
    has=await pg.locator('button.override').count(); await pg.click('button.override'); await pg.wait_for_timeout(300)
    check(f'{W}: assisted: "I played it right" turns the miss into a right answer', has and await score(pg)>s0, has)
    await pg.click('.hud button[aria-label=Pause]'); await pg.click('.pausemenu button:has-text("Quit")'); await pg.wait_for_selector('text=▶ Start')
    await grader(pg, 'auto')

    if W==380:
        # ---- Triad Hunt, tap: tap a triad inside the window ----
        await start(pg, 'G_triad_hunt', 'th1', mode='tap'); await pg.wait_for_timeout(400)
        name=(await pg.inner_text('.target b')).replace('♯','#').replace('♭','b'); sub=await pg.inner_text('.target span')
        m=re.search(r'strings (\d)-(\d)-(\d) · frets (\d+)–(\d+)', sub); strs=[int(m.group(i)) for i in (1,2,3)]; w0,w1=int(m.group(4)),int(m.group(5))
        root=PCN[name.rstrip('m')]; want={root,(root+(3 if name.endswith('m') else 4))%12,(root+7)%12}
        sol=next(fr for a in range(w0,w1+1) for bb_ in range(w0,w1+1) for c in range(w0,w1+1) for fr in [(a,bb_,c)] if {(OPEN[6-s]+f)%12 for s,f in zip(strs,fr)}==want)
        s0=await score(pg)
        for s,f in zip(strs,sol): await pg.dispatch_event(f'rect.hit[data-s="{s}"][data-f="{f}"]','pointerdown')
        await pg.wait_for_timeout(300)
        check('380: Triad Hunt tap: a triad in the window scores', await score(pg)>s0, (name, sub, sol))
        await pg.click('.hud button[aria-label=Pause]'); await pg.click('.pausemenu button:has-text("Quit")'); await pg.wait_for_selector('text=▶ Start')
    # ---- Triad Hunt, play ----
    await start(pg, 'G_triad_hunt', 'th1'); await mic_on(pg)
    gained=[]
    for i in range(2):
        s0=await score(pg); await pg.evaluate("__gtSimChordAnswer('right')"); gained.append(await until(pg, lambda: gt(pg, s0))); await pg.wait_for_timeout(600)
    check(f'{W}: Triad Hunt play: strummed triads score', all(gained), (gained, (await pg.evaluate('window.__gtStrumLog'))[-8:], await pg.evaluate('window.__gtGameEars && window.__gtGameEars.strums.map(x=>[+x.t.toFixed(2), +x.level.toFixed(3)])')))
    await pg.screenshot(path=f'/tmp/g3_triads_{W}.png')
    res=await result(pg, 30000); run=await last_run(pg, 'G_triad_hunt')
    check(f'{W}: Triad Hunt round saved (play)', run and run['mode']=='play' and run['accuracy']==1, run)

    # ---- Change Sprint (12 s window here), auto ----
    await open_game(pg, 'G_change_sprint', 'cs1'); await pg.click('text=▶ Start'); await pg.wait_for_selector('.playarea')
    await pg.wait_for_timeout(9000); await pg.screenshot(path=f'/tmp/g3_sprint_{W}.png')
    res=await result(pg, 40000); run=await last_run(pg, 'G_change_sprint'); ex=json.loads(run.get('extra_json') or '{}')
    check(f'{W}: Change Sprint: changes counted, almost no misses, saved with the rate', run['mode']=='play' and ex.get('changes',0)>=8 and run['accuracy']>=0.85 and run['score']>0, (run, res))
    # assisted: asks at the end; "Doesn't count" saves nothing
    await grader(pg, 'assisted'); n0=len([r for r in await pg.evaluate(DB+"('game_run')") if r['game_id']=='G_change_sprint'])
    await open_game(pg, 'G_change_sprint', 'cs1'); await pg.click('text=▶ Start')
    await pg.wait_for_selector('text=Check this round', timeout=40000); card=await pg.inner_text('.result')
    await pg.click('button:has-text("Doesn\'t count")'); await pg.wait_for_selector('text=▶ Start'); await pg.wait_for_timeout(300)
    n1=len([r for r in await pg.evaluate(DB+"('game_run')") if r['game_id']=='G_change_sprint'])
    check(f'{W}: assisted Change Sprint asks whether it counts; "Doesn\'t count" saves nothing', 'heard' in card and n1==n0, (card, n0, n1))
    await grader(pg, 'auto')

    # ---- Song Run: Sing Wherever I Go (chart in A, 72 BPM): first 6 bars in Bb with capo 3 (G shapes), bar 3 wrong ----
    await pg.evaluate("window.__gtGameShortBars=6; window.__songSwap=(i,f)=>i===2?[-1,3,2,0,1,0]:f")
    await open_game(pg, 'G_song_run', 'MS_sing_wherever_i_go')
    await pg.select_option('.songsetup label:has-text("Key") select', 'Bb'); await pg.select_option('.songsetup label:has-text("Capo") select', '3')
    setup=await pg.inner_text('.songsetup')
    await pg.click('text=▶ Start'); await pg.wait_for_selector('.songboxes'); await pg.wait_for_timeout(3000)
    first=await pg.inner_text('.songboxes')
    await pg.screenshot(path=f'/tmp/g3_songrun_{W}.png')
    res=await result(pg, 60000); run=await last_run(pg, 'G_song_run'); ex=json.loads(run.get('extra_json') or '{}')
    print(res.replace('\n',' | '))
    check(f'{W}: Song Run shows G shapes for Bb with capo 3', 'G shapes' in setup and first.split('\n')[0]=='G', (setup, first))
    check(f'{W}: Song Run: 5 of 6 bars right, saved with key + capo', run['mode']=='play' and abs(run['accuracy']-5/6)<1e-6 and ex=={'key':'Bb','capo':3,'per':'1'}, run)
    check(f'{W}: Song Run names the wrong bar', 'bar 3' in res and 'heard' in res, res)
    check(f'{W}: Song Run key + capo remembered for the song view', (await pg.evaluate("JSON.parse(localStorage.getItem('gt_song_view'))['MS_sing_wherever_i_go']"))=={'key':'Bb','capo':3})
    # forgot the capo: the same shapes without it fail most bars
    await pg.evaluate("window.__songSwap=(i,f)=>f; window.__songCapo=c=>0")
    await pg.click('button:has-text("Replay")'); res=await result(pg, 60000); run=await last_run(pg, 'G_song_run')
    check(f'{W}: Song Run with the capo forgotten fails most bars', run['accuracy']<=0.5, (run, res))
    await pg.evaluate("window.__songCapo=c=>c; window.__gtGameShortBars=undefined")

    # ---- heatmap: seeded Note Drop / Fret Finder data on Progress ----
    await pg.goto(f'{BASE}#/progress'); await pg.wait_for_selector('.heatmap')
    hm=await pg.inner_text('.heatcard'); cells=await pg.locator('.heatmap i.h1, .heatmap i.h2, .heatmap i.h3, .heatmap i.h4').count()
    check(f'{W}: heatmap shows the answered spots and names hard ones', cells==5 and 'hard spots' in hm.lower() and 'string 5, fret 3' in hm, (cells, hm))
    await pg.screenshot(path=f'/tmp/g3_heatmap_{W}.png', full_page=True)

    # ---- Daily Challenge: built from the weak spots, same after a reload, +30 XP when all done ----
    await pg.goto(f'{BASE}#/daily'); await pg.wait_for_selector('ol.dailylist li')
    items1=await pg.inner_text('ol.dailylist'); await pg.reload(); await pg.wait_for_selector('ol.dailylist li'); items2=await pg.inner_text('ol.dailylist')
    row=(await pg.evaluate(DB+"('daily_challenge')"))[0]; items=json.loads(row['items_json'])
    check(f'{W}: Daily Challenge: Note Drop on the hard spots and Capo Quick (quiz misses / review due), ~10 min, same after reload',
          items1==items2 and any(i.get('game')=='G_note_drop' and i.get('focus') for i in items) and any(i.get('game')=='G_capo_quick' for i in items) and sum(i['minutes'] for i in items)==10, items)
    await pg.screenshot(path=f'/tmp/g3_daily_{W}.png', full_page=True)
    g=[i for i in items if i['kind']=='game'][0]
    await pg.goto(f"{BASE}#/arcade/{g['game']}/{g['level']}/daily"); await pg.wait_for_selector('text=▶ Start')
    check(f'{W}: a challenge round says why it was picked', 'Daily Challenge' in await pg.inner_text('.page'))
    # finish every item (rounds recorded after the challenge was made), then reopen it
    done_runs=[{'game_id':i['game'],'level_id':i['level'],'mode':i['mode'],'score':100,'accuracy':1,'max_combo':1,'stars':1,'duration_s':60,'misses_json':'[]','at':row['created_at']+1000} for i in items if i['kind']=='game']
    done_att=[{'lesson_id':i['lesson'],'criterion_type':'self_check','grader_mode':'self','score':1,'met_target':True,'at_target_tempo':True,'metrics_json':'{}','event':'none','day':D(0),'at':row['created_at']+1000} for i in items if i['kind']=='lesson']
    f=os.path.join(tempfile.mkdtemp(),'runs.json'); json.dump({'game_run':done_runs,'attempt':done_att},open(f,'w'))
    await pg.evaluate('d => window.__gtImport(d)', json.load(open(f))); await pg.goto(f'{BASE}#/arcade'); await pg.reload()
    await pg.goto(f'{BASE}#/daily'); await pg.wait_for_selector('text=Done for today', timeout=8000)
    xp=[r for r in await pg.evaluate(DB+"('xp_ledger')") if r['source']=='daily']
    check(f'{W}: Daily Challenge complete: +30 XP once', len(xp)==1 and xp[0]['xp']==30, xp)
    await pg.reload(); await pg.wait_for_selector('text=Done for today'); await pg.wait_for_timeout(500)
    check(f'{W}: reopening doesn\'t add the XP again', len([r for r in await pg.evaluate(DB+"('xp_ledger')") if r['source']=='daily'])==1)

    # ---- badges: Capo Brain (31 in a row seeded), Faithful (31-day streak), Set Ready (set list on the phone, ★★★ on its one song) ----
    await pg.evaluate("""() => localStorage.setItem('gt_setlist_v1', JSON.stringify({ weeks: ['w1'], importedAt: '2026-11-01', songs: [{ name: 'Placeholder la la', plays: 1, isNew: false, weeks: ['w1'], last: 'w1', lastIndex: 0, outlineId: 'MS_way_maker' }] }))""")
    f2=os.path.join(tempfile.mkdtemp(),'best.json'); json.dump({'game_best':[{'key':'G_song_run|MS_way_maker|play','game_id':'G_song_run','level_id':'MS_way_maker','mode':'play','best_score':9999,'best_stars':3,'ghost':[],'at':0}]},open(f2,'w'))
    await pg.evaluate('d => window.__gtImport(d)', json.load(open(f2)))
    await pg.goto(f'{BASE}#/arcade'); await pg.reload(); await pg.wait_for_selector('section.badges'); await pg.wait_for_timeout(1200)
    earned=[r['badge_id'] for r in await pg.evaluate(DB+"('badge')")]; card=await pg.inner_text('section.badges'); tile=await pg.inner_text('section.tile.songrun')
    check(f'{W}: badges earned on opening the Arcade: Capo Brain, Faithful, Set Ready', {'B_capo_brain','B_faithful','B_set_ready'} <= set(earned) and 'B_whole_neck' not in earned, (earned, card))
    check(f'{W}: Set Ready progress on the Song Run tile; badges card shows progress', '1 of 1 church songs' in tile and 'of 12 keys' in card, (tile, card))
    await pg.screenshot(path=f'/tmp/g3_home_{W}.png', full_page=True)
    check(f'{W}: no page errors', not errs, errs)
    await ctx.close()

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--autoplay-policy=no-user-gesture-required'])
        if not os.environ.get('G3_WIDTHS'): await upgrade(b)
        for W in [int(x) for x in os.environ.get('G3_WIDTHS', '380,760').split(',')]: await run_width(b, W)
        await b.close()
    print('E2E', 'PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
asyncio.run(main())
