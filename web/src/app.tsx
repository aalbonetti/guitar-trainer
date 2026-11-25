import { useEffect, useState } from 'preact/hooks';
import { loadCatalog, type Catalog } from './catalog';
import { Today, Path, LessonView, Songs, Tools, Settings, trackVisibleFor } from './ui/Screens';
import { SessionBar, useDueCount } from './ui/Practice';
import { Progress } from './ui/Progress';
import { ArcadeHome, GameScreen } from './ui/Arcade';
import { DailyPage } from './ui/Daily';
import { loadXp } from './xp';
import { loadBests } from './arcade';
import { expireIdle, touch, noteTuned, dateKey } from './practice';
import { onFirstTune } from './audio/engine';
import { MetroStrip } from './ui/Tools';
import { loadProgress, saveStatus } from './progressStore';
import { useStore, useSelect } from './store';
import { update, applyUpdate } from './update';
import { attempt } from './grading/runner';
import { startActivityClock } from './activity';
import { ears } from './games/listen';

const NAV = [
  { h: '#/today', label: 'Today', icon: '☀' },
  { h: '#/path', label: 'Path', icon: '🧭' },
  { h: '#/songs', label: 'Songs', icon: '♪' },
  { h: '#/arcade', label: 'Arcade', icon: '🎮' },
  { h: '#/progress', label: 'Progress', icon: '📈', railOnly: true },
  { h: '#/tools/tuner', label: 'Tools', icon: '🎚' },
  { h: '#/settings', label: 'Settings', icon: '⚙', railOnly: true },
];
/* Progress and Settings leave the cover-screen bottom bar (5 tabs) and sit as header buttons; the rail keeps all 7. */
const HEAD = NAV.filter(n => n.railOnly);

function useHash() {
  const [h, setH] = useState(location.hash || '#/today');
  useEffect(() => { const f = () => { setH(location.hash || '#/today'); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}

/** Re-render when the date or song week changes while the app stays open: checked every minute and on resume. */
function useDateRollover() {
  const [, setKey] = useState(() => dateKey(new Date()));
  useEffect(() => {
    const check = () => setKey(dateKey(new Date()));
    const timer = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    check();
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, []);
}

export function App() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState('');
  const [, bump] = useState(0);
  const hash = useHash();
  useDateRollover();
  const save = useStore(saveStatus);
  const upd = useStore(update);
  const attempting = useSelect(attempt, a => a.phase === 'countin' || a.phase === 'playing' || a.phase === 'starting');
  const earsOn = useSelect(ears, e => e.on);
  const busy = attempting || earsOn;
  useEffect(() => {
    void expireIdle(); void loadProgress(); void loadXp(); void loadBests(); loadCatalog().then(setCat).catch(e => setErr(String(e)));
    onFirstTune(() => noteTuned());
    startActivityClock();
    const vis = () => { if (document.visibilityState === 'visible') void expireIdle(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, []);
  useEffect(() => { touch(); }, [hash]);
  const due = useDueCount(cat, cat ? trackVisibleFor(cat) : () => true);
  const [, route, arg] = hash.split('/');
  const active = NAV.find(n => n.h.split('/')[1] === route || (route === 'daily' && n.label === 'Arcade') || (route === 'lesson' && n.label === 'Path') || (route === 'song' && n.label === 'Songs'));
  let body;
  if (err) body = <div class="page"><p class="error">Couldn't load the catalog: {err}</p></div>;
  else if (!cat) body = <div class="page"><p class="muted">Loading…</p></div>;
  else if (route === 'path') body = <Path cat={cat} />;
  else if (route === 'lesson') body = <LessonView cat={cat} id={decodeURIComponent(arg || '')} />;
  else if (route === 'songs') body = <Songs cat={cat} />;
  else if (route === 'song') body = <Songs cat={cat} selected={decodeURIComponent(arg || '')} />;
  else if (route === 'tools') body = <Tools which={arg} cat={cat} />;
  else if (route === 'arcade') body = arg ? <GameScreen key={`${arg}/${hash.split('/')[3] || ''}`} cat={cat} gameId={decodeURIComponent(arg)} levelId={decodeURIComponent(hash.split('/')[3] || '')} fromDaily={hash.split('/')[4] === 'daily'} /> : <ArcadeHome cat={cat} />;
  else if (route === 'daily') body = <DailyPage cat={cat} visible={trackVisibleFor(cat)} />;
  else if (route === 'progress') body = <Progress cat={cat} />;
  else if (route === 'settings') body = <Settings onChange={() => bump(x => x + 1)} />;
  else body = <Today cat={cat} />;
  return (
    <div class="shell">
      <nav class="nav">
        <div class="brand">Guitar<span>Trainer</span></div>
        {NAV.map(n => <a href={n.h} class={(active === n ? 'on' : '') + (n.railOnly ? ' railonly' : '')} aria-current={active === n ? 'page' : undefined}><i>{n.icon}{n.label === 'Today' && due ? <b class="navbadge" aria-label={`${due} reviews due`}>{due}</b> : null}</i><span>{n.label}</span></a>)}
      </nav>
      <main class="main"><header class="topbar"><span class="brand">Guitar<span>Trainer</span></span>{HEAD.map(n => <a href={n.h} class={'headbtn' + (active === n ? ' on' : '')} aria-label={n.label} title={n.label} aria-current={active === n ? 'page' : undefined}>{n.icon}</a>)}</header>{upd.ready && !busy ? <div class="updatebanner">✨ Update ready <button class="small primary" onClick={applyUpdate}>Reload now</button></div> : null}{save.state === 'error' || save.state === 'blocked' ? <div class="savebanner">⚠ {save.msg} <button class="small" onClick={() => location.reload()}>Retry</button></div> : null}{body}</main>
      <div class="bottombars"><SessionBar /><MetroStrip /></div>
    </div>
  );
}
