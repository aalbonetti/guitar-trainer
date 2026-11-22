# M7 end-to-end: pitch grading in headless Chrome. ?sim swaps the mic for synthesized notes (sine + harmonics,
# window.__gtSimNotes) fed through the real capture worklet, pitch tracker and onset detector.
# F.02 tuning (hold) → EL.04 octaves to a click: right notes pass, wrong notes fail (and a fold mid-attempt)
# → EL.05 bends → EL.06 double stops in assisted mode → EL.07 hymn melody an octave up (any octave counts).
# Run after `npm run build`.
import asyncio, http.server, threading, functools, sys, json, tempfile, os
from playwright.async_api import async_playwright
PORT=8783
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),functools.partial(Q,directory='dist')); threading.Thread(target=srv.serve_forever,daemon=True).start()
INIT = """window.__lat=0.12; window.__wrong=[]; window.__shift=0; window.__detune=1.5; window.__gtPitchTimeoutS=6;
window.__gtSimAuto=(kind,arg)=>{ const S=window.__gtLastPitchSetup;
  if(kind==='pitch-hold'){ const [i,start]=arg, tg=S.targets[i];
    const n = tg.from!==undefined ? {midi:tg.from, bend:tg.midi-tg.from, bendAt:0.15, bendDur:0.2} : {midi:tg.midi, cents:window.__detune};
    window.__gtSimNotes([{...n, t:start+0.3, dur:1.6, gain:0.5}]); }
  if(kind==='pitch-timed'){ const P=window.__gtLastPitchPlan, notes=[];
    P.expected.forEach((e,i)=>e.midis.forEach(m=>notes.push({midi:m+(window.__wrong.includes(i)?1:0)+window.__shift, t:e.t+window.__lat, dur:Math.max(0.2,e.dur-0.03), gain:0.45})));
    window.__gtSimNotes(notes); }
  if(kind==='pitch-free'){ const [t0]=arg, notes=[];
    S.expected.forEach((e,i)=>e.midis.forEach(m=>notes.push({midi:m+(window.__wrong.includes(i)?1:0), t:t0+0.4+i*0.9, dur:0.8, gain:0.4})));
    window.__gtSimNotes(notes); } };"""
L=json.load(open('public/catalog/lessons.json'))
def seed(passed, kv=()):
    lp=[{'lesson_id':i,'state':'passed','first_pass_day':'2026-01-01','passed_day':'2026-01-02','review_index':5,'mastered':True,'updated_at':0} for i in passed]
    f=os.path.join(tempfile.mkdtemp(),'seed.json'); json.dump({'lesson_progress':lp,'kv':list(kv)},open(f,'w')); return f
SEED1=seed(['F.01'])
# EL.04 and EL.05 start unpassed: EL.04's first pass in this test unlocks EL.06 and EL.07 (passed once is enough)
SEED2=seed([l['id'] for l in L if l['track']=='F'] + ['ER.01','ER.02','ER.03','ER.04','EL.01','EL.02','EL.03','ER.07'],
           [{'key':'ladder:EL.04','v':{'bpm':100,'clean':0,'sloppy':0}},{'key':'ladder:EL.07','v':{'bpm':80,'clean':0,'sloppy':0}}])
ok=True
def check(name, cond, extra=''):
    global ok; ok &= bool(cond); print('PASS' if cond else 'FAIL', name, extra if not cond else '')
ATT="(async()=>{const r=indexedDB.open('guitar-trainer');await new Promise(x=>r.onsuccess=x);return await new Promise(x=>{const q=r.result.transaction('attempt').objectStore('attempt').getAll();q.onsuccess=()=>x(q.result.map(a=>({l:a.lesson_id,met:a.met_target,tgt:a.at_target_tempo,mode:a.grader_mode,type:a.criterion_type,ev:a.event,sess:'session_id' in a,m:JSON.parse(a.metrics_json)})))})})()"
async def restore(pg, f):
    await pg.goto(f'http://127.0.0.1:{PORT}/?sim#/settings'); await pg.wait_for_selector('text=Restore from file')
    await pg.set_input_files('section.card:has-text("Backup") input[type=file]', f); await pg.wait_for_timeout(1500)
async def lesson(pg, id):
    await pg.goto(f'http://127.0.0.1:{PORT}/?sim#/lesson/{id}'); await pg.wait_for_selector('section.card:has-text("Pass it")')
async def result(pg, t=90000):
    await pg.wait_for_selector('.result, p.error', timeout=t); return await pg.inner_text('section.card:has-text("Pass it")')
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':412,'height':880}); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
        await pg.add_init_script(INIT)
        # ---- F.02 tuning: hold each open string within ±5 cents ----
        await restore(pg, SEED1); await lesson(pg, 'F.02')
        check('F.02 goal text', 'every open string within ±5 cents' in await pg.inner_text('.lgoal'))
        await pg.click('section.card:has-text("Pass it") button:has-text("Start")')
        await pg.wait_for_selector('.pitchrun', timeout=5000); await pg.wait_for_timeout(700)
        await pg.locator('.pitchrun').screenshot(path='/tmp/m7_hold.png')
        res=await result(pg); print('--- F.02:\n', res)
        check('F.02 all six strings held → passed', 'Passed this attempt' in res and '6/6' in res, res)
        # ---- EL.04 octaves to a click at 100 BPM ----
        await restore(pg, SEED2); await lesson(pg, 'EL.04')
        await pg.click('section.card:has-text("Pass it") button:has-text("Start at 100 BPM")')
        await pg.wait_for_selector('.pitchrun', timeout=5000); await pg.wait_for_timeout(5000)
        await pg.locator('.pitchrun').screenshot(path='/tmp/m7_timed.png')
        await pg.set_viewport_size({'width':840,'height':760}); await pg.wait_for_timeout(1500)  # unfold mid-attempt
        await pg.set_viewport_size({'width':412,'height':880})
        res=await result(pg); print('--- EL.04 right notes (folded/unfolded mid-attempt):\n', res)
        check('EL.04 right notes pass 8/8, survives a fold', 'Passed this attempt' in res and '8/8' in res, res)
        await pg.locator('section.card:has-text("Pass it")').screenshot(path='/tmp/m7_result.png')
        await pg.evaluate('window.__wrong=[2,5]')
        await pg.click('button:has-text("Go again at 100 BPM")'); await pg.wait_for_timeout(1000)
        res=await result(pg); print('--- EL.04 two wrong notes:\n', res)
        check('EL.04 wrong notes fail with 6/8', 'Not yet' in res and '6/8' in res and 'extra notes' not in res, res)
        check('result shows what was heard instead', 'heard' in res, res)
        await pg.locator('section.card:has-text("Pass it")').screenshot(path='/tmp/m7_fail.png')
        await pg.evaluate('window.__wrong=[]')
        # ---- EL.05 bends ----
        await lesson(pg, 'EL.05')
        await pg.click('section.card:has-text("Pass it") button:has-text("Start")')
        res=await result(pg); print('--- EL.05 bends:\n', res)
        check('EL.05 three bends held → passed', 'Passed this attempt' in res and '3/3' in res, res)
        # ---- EL.06 double stops, assisted by default ----
        await lesson(pg, 'EL.06')
        check('EL.06 is assisted by default', 'Assisted mode' in await pg.inner_text('section.card:has-text("Pass it")'))
        await pg.click('section.card:has-text("Pass it") button:has-text("Start")')
        res=await result(pg); print('--- EL.06 double stops:\n', res)
        check('EL.06 shows detection and asks to confirm', 'Count it' in res and '8/8' in res, res)
        await pg.click('button:has-text("Count it")'); await pg.wait_for_timeout(800)
        res=await pg.inner_text('section.card:has-text("Pass it")'); check('EL.06 confirmed and saved', 'Passed this attempt' in res and 'Saved on this phone' in res, res)
        # ---- EL.07 hymn melody, played an octave higher (any octave counts), 3/4 with a pickup ----
        await pg.evaluate('window.__shift=12')
        await lesson(pg, 'EL.07')
        await pg.click('section.card:has-text("Pass it") button:has-text("Start at 80 BPM")')
        res=await result(pg); print('--- EL.07 an octave up:\n', res)
        check('EL.07 octave-up melody passes 16/16', 'Passed this attempt' in res and '16/16' in res, res)
        await pg.evaluate('window.__shift=0')
        att=await pg.evaluate(ATT)
        for a in att: print({k:(v if k!='m' else {x:v[x] for x in ('mode','bpm','matched','total','missed','meanOffMs','cents_dev') if x in v}) for k,v in a.items()})
        check('attempts saved with grader_mode and session_id', len(att)==6 and all(a['sess'] for a in att) and [a['mode'] for a in att]==['auto','auto','auto','auto','assisted','auto'], [a['mode'] for a in att])
        check('passes recorded: first passes for F.02, EL.04, EL.05, EL.06, EL.07', [a['ev'] for a in att]==['first_pass','first_pass','none','first_pass','first_pass','first_pass'], [a['ev'] for a in att])
        g=await pg.evaluate('JSON.stringify(__gtAudio().capture)'); print('capture:', g)
        check('no page errors', not errs, errs)
        await b.close()
    print('E2E', 'PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
asyncio.run(main())
