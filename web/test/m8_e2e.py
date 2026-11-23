# M8 end-to-end: chord grading in headless Chrome. ?sim swaps the mic for synthesized strums (Karplus-Strong
# strings at sounding pitch, strum spread, window.__gtSimChords) fed through the real capture worklet, onset
# detector and chroma analyzer.
# Settings rows (assisted by default) → A.01 Em↔G changes in assisted mode (confirm) at 380 px, then auto mode:
# same chord only fails → ER.05 triads to a click at 760 px: right chords pass (with a fold mid-attempt), two
# wrong bars fail with the confusion shown → A.12 own pace in assisted mode, with the Fmaj7 stand-in caught →
# A.08 capo key named on the spot, forgetting the capo fails → A.11 Amazing Grace in G to a click (G must not be
# heard as G7) → attempts saved with grader_mode + session_id.
# Run after `npm run build`.
import asyncio, http.server, threading, functools, sys, json, tempfile, os
from playwright.async_api import async_playwright
PORT=8784
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(Q,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
# window.__swap(i, ref) picks what the sim strums for box i (a ref from the exercise's voicings, or frets);
# __capo(c) the capo actually on; __same plays only the first chord of a pair (no changes).
INIT = """window.__lat=0.06; window.__swap=(i,r)=>r; window.__capo=c=>c; window.__same=false; window.__gtChangesWindowS=8;
window.__gtSimAuto=(kind,arg)=>{ const S=window.__gtLastChordSetup, ex=S.setup.ex, out=[];
  const fr = r => Array.isArray(r) ? r : ex.voicings[r].frets[0];
  if(kind==='chord-timed'){ const P=window.__gtLastChordPlan, v=S.variant;
    P.boxes.forEach((b,i)=>{ const n=Math.round((b.t1-b.t0)/P.beat)*2; for(let k=0;k<n;k++) out.push({frets:fr(window.__swap(i,b.ref)), capo:window.__capo(v.capo), t:b.t0+k*P.beat/2+window.__lat, up:k%2===1, gain:k%2?0.55:0.8, dur:P.beat/2+0.4}); }); }
  if(kind==='chord-own'){ const [t0]=arg, v=S.variant, per=ex.strums_per_chord; let t=t0+0.4;
    v.chords.forEach((r,i)=>{ for(let k=0;k<per;k++){ out.push({frets:fr(window.__swap(i,r)), capo:window.__capo(v.capo), t, dur:0.6}); t+=0.45; } t+=0.25; }); }
  if(kind==='chord-changes'){ const [i,t0,t1]=arg, pair=S.setup.pairs[i];
    for(let t=t0+0.15, k=0; t<t1-0.3; t+=0.5, k++) out.push({frets:fr(pair[window.__same?0:k%2]), t, dur:0.7}); }
  window.__gtSimChords(out); };"""
L=json.load(open('public/catalog/lessons.json'))
async def seedpage(pg, path):
    import json
    await pg.goto(f'http://127.0.0.1:{PORT}/?sim#/settings'); await pg.wait_for_function('!!window.__gtImport')
    await pg.evaluate('d => window.__gtImport(d)', json.load(open(path))); await pg.reload(); await pg.wait_for_timeout(500)
def seed(passed, kv=()):
    lp=[{'lesson_id':i,'state':'passed','first_pass_day':'2026-01-01','passed_day':'2026-01-02','review_index':5,'mastered':True,'updated_at':0} for i in passed]
    f=os.path.join(tempfile.mkdtemp(),'seed.json'); json.dump({'lesson_progress':lp,'kv':list(kv)},open(f,'w')); return f
SEED=seed([l['id'] for l in L if l['track'] in ('F','T')] + ['A.02','A.03','A.04','A.05','A.06','A.07','ER.01','ER.02','ER.03','ER.04'],
          [{'key':'ladder:A.11','v':{'bpm':80,'clean':0,'sloppy':0}}])
ok=True
def check(name, cond, extra=''):
    global ok; ok &= bool(cond); print('PASS' if cond else 'FAIL', name, extra if not cond else '')
ATT="(async()=>{const r=indexedDB.open('guitar-trainer');await new Promise(x=>r.onsuccess=x);return await new Promise(x=>{const q=r.result.transaction('attempt').objectStore('attempt').getAll();q.onsuccess=()=>x(q.result.map(a=>({l:a.lesson_id,met:a.met_target,mode:a.grader_mode,type:a.criterion_type,ev:a.event,sess:'session_id' in a,m:JSON.parse(a.metrics_json)})))})})()"
async def restore(pg, f):
    await seedpage(pg, f)
async def lesson(pg, id):
    await pg.goto(f'http://127.0.0.1:{PORT}/?sim#/lesson/{id}'); await pg.wait_for_selector(PASS)
PASS='.lpass section.card'   # the "Pass it" card (the lesson text may say "Pass it" too)
async def result(pg, t=120000):
    await pg.wait_for_selector(f'{PASS} .result, {PASS} p.error', timeout=t); return await pg.inner_text(PASS)
async def go(pg, label='Start'):
    # "Start…" on a fresh panel, "Go again…" when the last result is still on screen
    await pg.locator(f'{PASS} button:has-text("{label}"), {PASS} button:has-text("Go again")').first.click()
ROW={'chord_accuracy':'Chords: right chord on each strum','changes_per_min':'Chords: one-minute changes'}
async def set_mode(pg, key, mode):
    # the way the user would: Settings → Grading mode
    await pg.goto(f'http://127.0.0.1:{PORT}/?sim#/settings'); await pg.wait_for_selector('section.card:has-text("Grading mode")')
    await pg.locator('section.card:has-text("Grading mode") label.field', has_text=ROW[key]).locator('select').select_option(mode)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':380,'height':860}); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
        await pg.add_init_script(INIT)
        await restore(pg, SEED)
        # ---- Settings: both chord graders listed, assisted by default ----
        st=await pg.inner_text('section.card:has-text("Grading mode")')
        check('Settings lists the chord graders', 'Chords: right chord on each strum' in st and 'Chords: one-minute changes' in st, st)
        sel=await pg.eval_on_selector_all('section.card:has-text("Grading mode") select', 'els=>els.map(e=>e.value)')
        check('chord graders default to assisted', sel[-2:]==['assisted','assisted'], sel)
        # ---- A.01 Em ↔ G, assisted (default), 380 px ----
        await lesson(pg, 'A.01')
        txt=await pg.inner_text(PASS)
        check('A.01 panel: one minute, Em ↔ G, assisted', 'One minute' in txt and 'Em ↔ G' in txt and 'Assisted mode' in txt, txt)
        await pg.click(f'{PASS} button:has-text("Start")')
        await pg.wait_for_selector('.chordrun .changecount', timeout=8000); await pg.wait_for_timeout(3500)
        live=await pg.inner_text('.chordrun'); print('--- A.01 live:\n', live)
        check('A.01 live count is going up', any(ch.isdigit() and ch!='0' for ch in live.split('changes')[0]), live)
        await pg.locator('.chordrun').screenshot(path='/tmp/m8_changes_380.png')
        res=await result(pg); print('--- A.01 assisted:\n', res)
        check('A.01 detected well over 30 a minute, asks to confirm', 'Check this attempt' in res and 'Count it' in res and 'Em ↔ G' in res, res)
        await pg.click('button:has-text("Count it")'); await pg.wait_for_timeout(800)
        res=await pg.inner_text(PASS); check('A.01 confirmed → passed and saved', 'Passed this attempt' in res and 'Saved on this phone' in res, res)
        await pg.locator(PASS).screenshot(path='/tmp/m8_changes_result_380.png')
        # auto mode: only one chord → no changes → not yet
        await set_mode(pg, 'changes_per_min', 'auto'); await pg.evaluate('window.__same=true')
        await lesson(pg, 'A.01'); await go(pg)
        res=await result(pg); print('--- A.01 auto, Em only:\n', res)
        check('A.01 auto: strumming one chord fails with 0 a minute', 'Not yet' in res and '✗ Em ↔ G 0 a minute' in res.replace('\n',' '), res)
        await pg.evaluate('window.__same=false')
        # ---- ER.05 triads to a click, auto, 760 px ----
        await set_mode(pg, 'chord_accuracy', 'auto')
        await pg.set_viewport_size({'width':760,'height':900})
        await lesson(pg, 'ER.05')
        txt=await pg.inner_text(PASS); check('ER.05: timed at 70 BPM', 'to a click' in txt and 'at 70 BPM' in txt and 'Start at 70 BPM' in txt, txt)
        await pg.click(f'{PASS} button:has-text("Start at 70 BPM")')
        await pg.wait_for_selector('.chordrun b:has-text("Strum!")', timeout=10000); await pg.wait_for_timeout(5000)
        live=await pg.inner_text('.chordrun'); print('--- ER.05 live:\n', live)
        check('ER.05 live shows expected and heard ✓', 'Expected' in live and '✓' in live, live)
        await pg.locator('.chordrun').screenshot(path='/tmp/m8_timed_760.png')
        await pg.set_viewport_size({'width':380,'height':860}); await pg.wait_for_timeout(1500)   # fold mid-attempt
        await pg.set_viewport_size({'width':760,'height':900})
        res=await result(pg); print('--- ER.05 right chords:\n', res)
        check('ER.05 right chords pass and survive a fold', 'Passed this attempt' in res and 'Saved on this phone' in res, res)
        await pg.locator(PASS).screenshot(path='/tmp/m8_timed_result_760.png')
        # two bars of Em (tri_432_Em_inv1) where D belongs
        await pg.evaluate("window.__swap=(i,r)=>(i===1||i===5)?'tri_432_Em_inv1':r")
        await pg.click(f'{PASS} button:has-text("Go again")')
        res=await result(pg); print('--- ER.05 two wrong bars:\n', res)
        check('ER.05 wrong chords fail, confusion shows D heard as Em', 'Not yet' in res and 'Em ×' in res and 'sounded like Em' in res, res)
        await pg.locator(PASS).screenshot(path='/tmp/m8_timed_fail_760.png')
        await pg.evaluate("window.__swap=(i,r)=>r")
        # ---- A.12 own pace, assisted (switch back), 760 px ----
        await set_mode(pg, 'chord_accuracy', 'assisted')
        await lesson(pg, 'A.12')
        txt=await pg.inner_text(PASS); check('A.12: own pace, 4 strums each', 'own pace, 4 strums each' in txt and 'Assisted mode' in txt, txt)
        await pg.click(f'{PASS} button:has-text("Start")')
        await pg.wait_for_selector('.chordrun .strumdots', timeout=8000); await pg.wait_for_timeout(2500)
        await pg.locator('.chordrun').screenshot(path='/tmp/m8_own_760.png')
        res=await result(pg); print('--- A.12 right chords (assisted):\n', res)
        check('A.12 detected right, asks to confirm', 'Check this attempt' in res and 'meets the goal' in res and 'Count it' in res, res)
        await pg.click('button:has-text("Count it")'); await pg.wait_for_timeout(800)
        res=await pg.inner_text(PASS); check('A.12 confirmed → passed', 'Passed this attempt' in res, res)
        # Fmaj7 instead of every F: F is graded on its own and the barre's low root is checked, so this fails
        await pg.evaluate("window.__swap=(i,r)=>r==='F'?[-1,-1,3,2,1,0]:r")
        await pg.click(f'{PASS} button:has-text("Go again")')
        res=await result(pg); print('--- A.12 Fmaj7 for F:\n', res)
        check('A.12 Fmaj7 for F is detected as a miss (heard as Fmaj7)', 'misses the goal' in res and 'Fmaj7 ×' in res, res)
        await pg.click('button:has-text("Doesn\'t count")'); await pg.wait_for_timeout(800)
        res=await pg.inner_text(PASS); check('A.12 rejected → not yet, saved', 'Not yet' in res and 'Saved on this phone' in res, res)
        # the partial Bm (xx4432) for every Bm: same notes, no low B → fails
        await pg.evaluate("window.__swap=(i,r)=>r==='Bm'?[-1,-1,4,4,3,2]:r")
        await pg.click(f'{PASS} button:has-text("Go again")')
        res=await result(pg); print('--- A.12 partial Bm:\n', res)
        check('A.12 partial Bm is detected as a miss (heard as Bm (partial))', 'misses the goal' in res and 'Bm (partial) ×' in res, res)
        await pg.click('button:has-text("Doesn\'t count")'); await pg.wait_for_timeout(800)
        await pg.evaluate("window.__swap=(i,r)=>r")
        # ---- A.08: key named on the spot; forgetting the capo fails, 380 px ----
        await set_mode(pg, 'chord_accuracy', 'auto')
        await pg.set_viewport_size({'width':380,'height':860})
        await lesson(pg, 'A.08')
        await pg.click(f'{PASS} button:has-text("Start")')
        await pg.wait_for_selector('.chordrun .keyline', timeout=8000)
        key=await pg.inner_text('.chordrun .keyline'); print('A.08 key:', key)
        check('A.08 names a key with capo and shapes', 'Key of' in key and 'capo' in key, key)
        res=await result(pg); print('--- A.08 with capo:\n', res)
        check('A.08 right shapes with the capo pass', 'Passed this attempt' in res, res)
        await pg.evaluate('window.__capo=c=>0')
        await pg.click(f'{PASS} button:has-text("Go again")')
        res=await result(pg); print('--- A.08 capo forgotten:\n', res)
        check('A.08 without the capo fails and says so', 'Not yet' in res and 'capo' in res.split('Heard instead')[-1], res)
        await pg.locator(PASS).screenshot(path='/tmp/m8_capo_fail_380.png')
        await pg.evaluate('window.__capo=c=>c')
        # ---- A.11 Amazing Grace in G, 3/4 to a click at 80 (ladder seeded at the goal), 760 px ----
        await pg.set_viewport_size({'width':760,'height':900})
        await lesson(pg, 'A.11')
        txt=await pg.inner_text(PASS); check('A.11: timed at 80 BPM, choose the capo', 'Start at 80 BPM' in txt and 'Key of G' in txt, txt)
        await go(pg, 'Start at 80 BPM')
        res=await result(pg); print('--- A.11 key of G:\n', res)
        grow=[x for x in res.split('\n') if x.startswith('G\t')]
        check('A.11 key of G passes and G is not heard as G7', 'Passed this attempt' in res and grow and 'G7' not in grow[0], res)
        # ---- saved attempts ----
        att=await pg.evaluate(ATT)
        for a in att: print({k:(v if k!='m' else {x:v[x] for x in ('kind','detected_met','variant','correct','total','ratio','changes') if x in v}) for k,v in a.items()})
        by={}
        for a in att: by.setdefault(a['l'],[]).append((a['mode'],a['met']))
        exp={'A.01':[('assisted',True),('auto',False)],'ER.05':[('auto',True),('auto',False)],'A.12':[('assisted',True),('assisted',False),('assisted',False)],'A.08':[('auto',True),('auto',False)],'A.11':[('auto',True)]}
        check('attempts saved with grader_mode, result and session_id', by==exp and all(a['sess'] for a in att), by)
        check('criterion types recorded', {a['l']:a['type'] for a in att}=={'A.01':'changes_per_min','ER.05':'chord_accuracy','A.12':'chord_accuracy','A.08':'chord_accuracy','A.11':'chord_accuracy'})
        check('first passes for A.01, ER.05, A.12, A.08, A.11', sorted(a['l'] for a in att if a['ev']=='first_pass')==['A.01','A.08','A.11','A.12','ER.05'], [(a['l'],a['ev']) for a in att])
        # a double tap on Start must not start two attempts
        await lesson(pg, 'ER.05'); await pg.locator(f'{PASS} button:has-text("Go again"), {PASS} button:has-text("Start")').first.dblclick()
        await pg.wait_for_selector('.chordrun', timeout=8000); await pg.wait_for_timeout(1500)
        await pg.click('.chordrun button:has-text("Cancel")'); await pg.wait_for_timeout(1500)
        g2=await pg.evaluate('JSON.stringify(__gtAudio().capture)')
        check('double tap + cancel leaves the mic closed (one attempt only)', '"on":false' in g2, g2)
        g=await pg.evaluate('JSON.stringify(__gtAudio().capture)'); print('capture:', g)
        check('mic closed after the attempts', '"on":false' in g, g)
        check('no page errors', not errs, errs)
        await b.close()
    print('E2E', 'PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
asyncio.run(main())
