import { useEffect, useState } from 'preact/hooks';
import { loadCatalog, type Catalog } from './catalog';
import { Today, Path, LessonView, Songs, Tools, Settings, trackVisibleFor } from './ui/Screens';
import { SessionBar, useDueCount } from './ui/Practice';
import { Progress } from './ui/Progress';
import { ImportView, ChartView } from './ui/Charts';
import { loadCharts } from './charts';
import { ArcadeHome, GameScreen } from './ui/Arcade';
import { loadXp } from './xp';
import { loadBests } from './arcade';
import { expireIdle, touch, noteTuned } from './practice';
import { onFirstTune } from './audio/engine';
import { MetroStrip } from './ui/Tools';
import { loadProgress, saveStatus } from './progressStore';
import { useStore } from './store';
import { update, applyUpdate } from './update';
import { attempt } from './grading/runner';
import { startActivityClock } from './activity';
import { ears } from './games/listen';

const NAV = [
  { h: '#/today', label: 'Today', icon: '☀' },
  { h: '#/path', label: 'Path', icon: '🧭' },
  { h: '#/songs', label: 'Songs', icon: '♪' },
  { h: '#/arcade', label: 'Arcade', icon: '🎮' },
  { h: '#/progress', label: 'Progress', icon: '📈' },
  { h: '#/tools/tuner', label: 'Tools', icon: '🎚' },
  { h: '#/settings', label: 'Settings', icon: '⚙' },
];

function useHash() {
  const [h, setH] = useState(location.hash || '#/today');
  useEffect(() => { const f = () => { setH(location.hash || '#/today'); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}

export function App() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState('');
  const [, bump] = useState(0);
  const hash = useHash();
  const save = useStore(saveStatus);
  const upd = useStore(update);
  const att = useStore(attempt);
  const ear = useStore(ears);
  const busy = att.phase === 'countin' || att.phase === 'playing' || att.phase === 'starting' || ear.on;
  useEffect(() => {
    void expireIdle(); void loadProgress(); void loadCharts(); void loadXp(); void loadBests(); loadCatalog().then(setCat).catch(e => setErr(String(e)));
    onFirstTune(() => noteTuned());
    startActivityClock();
    const vis = () => { if (document.visibilityState === 'visible') void expireIdle(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, []);
  useEffect(() => { touch(); }, [hash]);
  const due = useDueCount(cat, cat ? trackVisibleFor(cat) : () => true);
  const [, route, arg] = hash.split('/');
  const active = NAV.find(n => n.h.split('/')[1] === route || (route === 'lesson' && n.label === 'Path') || ((route === 'song' || route === 'import' || route === 'chart') && n.label === 'Songs'));
  let body;
  if (err) body = <div class="page"><p class="error">Couldn't load the catalog: {err}</p></div>;
  else if (!cat) body = <div class="page"><p class="muted">Loading…</p></div>;
  else if (route === 'path') body = <Path cat={cat} />;
  else if (route === 'lesson') body = <LessonView cat={cat} id={decodeURIComponent(arg || '')} />;
  else if (route === 'songs') body = <Songs cat={cat} initialTab={arg} />;
  else if (route === 'import') body = <ImportView cat={cat} />;
  else if (route === 'chart') body = <ChartView cat={cat} id={decodeURIComponent(arg || '')} />;
  else if (route === 'song') body = <Songs cat={cat} selected={decodeURIComponent(arg || '')} />;
  else if (route === 'tools') body = <Tools which={arg} cat={cat} />;
  else if (route === 'arcade') body = arg ? <GameScreen cat={cat} gameId={decodeURIComponent(arg)} levelId={decodeURIComponent(hash.split('/')[3] || '')} /> : <ArcadeHome cat={cat} />;
  else if (route === 'progress') body = <Progress cat={cat} />;
  else if (route === 'settings') body = <Settings cat={cat} onChange={() => bump(x => x + 1)} />;
  else body = <Today cat={cat} />;
  return (
    <div class="shell">
      <nav class="nav">
        <div class="brand">Guitar<span>Trainer</span></div>
        {NAV.map(n => <a href={n.h} class={active === n ? 'on' : ''}><i>{n.icon}{n.label === 'Today' && due ? <b class="navbadge" aria-label={`${due} reviews due`}>{due}</b> : null}</i><span>{n.label}</span></a>)}
      </nav>
      <main class="main">{upd.ready && !busy ? <div class="updatebanner">✨ Update ready <button class="small primary" onClick={applyUpdate}>Reload now</button></div> : null}{save.state === 'error' || save.state === 'blocked' ? <div class="savebanner">⚠ {save.msg} <button class="small" onClick={() => location.reload()}>Retry</button></div> : null}{body}</main>
      <div class="bottombars"><SessionBar /><MetroStrip /></div>
    </div>
  );
}
