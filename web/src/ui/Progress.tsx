// Progress: streak, minutes per week, lessons passed per track, tempo ladders, recent attempts.
import { useEffect, useState } from 'preact/hooks';
import type { Catalog } from '../catalog';
import { useStore } from '../store';
import { progress, streakInfo } from '../progressStore';
import { qualifies } from '../streak';
import { computeStates, dayOf, addDays } from '../progress';
import { sessionsSince, type SessionRow } from '../practice';
import * as db from '../db';
import type { TimingCriteria } from '../grading/timing';

interface AttemptRow { lesson_id: string; criterion_type: string; grader_mode: string; score: number; met_target: boolean; at_target_tempo: boolean; metrics_json: string; event: string; day: string; at: number }
const mondayOf = (day: string) => { const [y, m, d] = day.split('-').map(Number); const t = new Date(y, m - 1, d); return addDays(day, -((t.getDay() + 6) % 7)); };

export function Progress({ cat }: { cat: Catalog }) {
  const pr = useStore(progress);
  const states = computeStates(cat.lessons, cat.tracks, pr.lp);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [ladders, setLadders] = useState<Record<string, number>>({});
  const today = dayOf();
  useEffect(() => {
    void sessionsSince(addDays(mondayOf(today), -7 * 7)).then(setSessions);
    void db.getAll<AttemptRow>('attempt').then(a => setAttempts(a.sort((x, y) => y.at - x.at))).catch(() => undefined);
    void db.getAll<{ key: string; v: { bpm: number } }>('kv').then(rows => setLadders(Object.fromEntries(rows.filter(r => r.key.startsWith('ladder:')).map(r => [r.key.slice(7), r.v.bpm])))).catch(() => undefined);
  }, []);

  // streak (5-minute days, service days, freezes) + the last 4 weeks
  const days = new Set(pr.days), svc = new Set(pr.services);
  const sk = streakInfo(today), frozen = new Set(sk.frozen);
  const last28 = Array.from({ length: 28 }, (_, i) => addDays(today, i - 27));
  const dayClass = (x: string) => (qualifies(pr.active[x] === undefined ? (days.has(x) ? { day: x } : undefined) : { day: x, active_s: pr.active[x] }, svc.has(x)) ? 'on' : frozen.has(x) ? 'frozen' : days.has(x) ? 'part' : '');

  // minutes per week, last 8 weeks: practice time tracked per day; days from before that use practice sessions
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(mondayOf(today), -7 * (7 - i)));
  const dayMin = (x: string) => (pr.active[x] !== undefined ? pr.active[x] : sessions.filter(s => s.day === x).reduce((a, s) => a + s.total_s, 0));
  const mins = weeks.map(w => Math.round(Array.from({ length: 7 }, (_, i) => dayMin(addDays(w, i))).reduce((a, b) => a + b, 0) / 60));
  const maxM = Math.max(30, ...mins);

  const timingLessons = cat.lessons.filter(l => (l.pass_criteria.type === 'timing' || (l.pass_criteria.type === 'pitch' && !!l.pass_criteria.bpm)) && (ladders[l.id] || attempts.some(a => a.lesson_id === l.id)));
  return (
    <div class="page">
      <h1>Progress</h1>
      <div class="two">
        <div>
          <section class="card">
            <h2>{sk.current ? `${sk.current}-day streak` : 'No streak yet'} <small class="muted">{sk.freezes ? `❄ ${sk.freezes} freeze${sk.freezes > 1 ? 's' : ''} · ` : ''}longest {sk.longest} · {pr.days.length} days practiced in all</small></h2>
            <div class="cal">{last28.map(x => <i class={`${dayClass(x)} ${x === today ? 'today' : ''}`} title={`${x}${svc.has(x) ? ' · played a service' : frozen.has(x) ? ' · freeze used' : pr.active[x] !== undefined ? ` · ${Math.floor(pr.active[x] / 60)} min` : ''}`} />)}</div>
            <p class="muted small">Last 4 weeks. A day counts with 5 minutes of practice (lessons, songs, tools, games) or ⛪ “Played a service”. Each 7 days of streak earns a freeze (hold up to 2); a freeze covers a missed day automatically. Today: {Math.floor(sk.todayS / 60)} min{sk.todayDone ? ' ✓' : ''}.</p>
          </section>
          <section class="card">
            <h2>Minutes per week</h2>
            <div class="weekbars">{weeks.map((w, i) => <div><i style={{ height: `${(mins[i] / maxM) * 100}%` }} /><b>{mins[i] || ''}</b><span>{w.slice(5).replace('-', '/')}</span></div>)}</div>
            <p class="muted small">Time with the app in use: lessons, songs, tools and games.</p>
          </section>
          <section class="card">
            <h2>Lessons by track</h2>
            {cat.tracks.map(t => {
              const ls = cat.lessons.filter(l => l.track === t.id), p = ls.filter(l => states[l.id] === 'passed').length, ip = ls.filter(l => states[l.id] === 'in_progress').length;
              return <div class="trackbar"><span>{t.name}</span><div><i class="p" style={{ width: `${(p / ls.length) * 100}%` }} /><i class="ip" style={{ width: `${(ip / ls.length) * 100}%` }} /></div><small>{p}/{ls.length}</small></div>;
            })}
          </section>
        </div>
        <div>
          {timingLessons.length ? <section class="card">
            <h2>Tempo ladders</h2>
            <ul class="list">{timingLessons.map(l => { const goal = (l.pass_criteria as unknown as TimingCriteria).bpm, cur = ladders[l.id] ?? Math.round(goal * 0.65);
              return <li><a href={`#/lesson/${l.id}`}><b class="lid">{l.id}</b> {l.title}<small>{cur} → {goal} BPM</small><div class="ladder"><i style={{ width: `${Math.min(100, (cur / goal) * 100)}%` }} /></div></a></li>; })}</ul>
          </section> : null}
          <section class="card">
            <h2>Recent attempts</h2>
            {attempts.length ? <ul class="list">{attempts.slice(0, 15).map(a => { const m = safe(a.metrics_json);
              return <li><a href={`#/lesson/${a.lesson_id}`}><b>{a.met_target ? '✓' : '·'} <span class="lid">{a.lesson_id}</span> {cat.lessonById[a.lesson_id]?.title}</b>
                <small>{a.day} · {a.grader_mode === 'self' ? 'self-marked' : a.criterion_type}{m.bpm ? ` · ${m.bpm} BPM` : ''}{m.maeMs !== undefined ? ` · ${m.maeMs} ms` : ''}{a.criterion_type === 'quiz' || a.criterion_type === 'pitch' ? ` · ${Math.round(a.score * 100)}%` : ''}{a.grader_mode === 'assisted' ? (a.met_target ? ' · confirmed by you' : ' · rejected by you') : ''}</small></a></li>; })}</ul>
              : <p class="muted">No attempts yet.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
function safe(s: string): Record<string, any> { try { return JSON.parse(s || '{}'); } catch { return {}; } }
