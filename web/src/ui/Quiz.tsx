// Inline quiz: 10 generated questions, answer timing, weak-spot weighting, and lesson grading.
import { useState } from 'preact/hooks';
import type { Catalog, Lesson } from '../catalog';
import { makeQuestion, rng, type Question } from '../quiz';
import { playChords } from '../audio/engine';
import { recordAttempt, bumpQuizItem, quizWeights, progress, saveStatus } from '../progressStore';
import { computeStates } from '../progress';
import { EVENT_TEXT } from '../progress';
import { ChordDiagram } from './Diagrams';

const N = 10;
/** A quiz counts toward a quiz lesson when it's one of that lesson's quiz assets (a quiz can serve several lessons). */
export const gradesLesson = (lesson: Lesson | undefined, quizId: string): boolean =>
  !!lesson && lesson.pass_criteria.type === 'quiz' && !!lesson.assets.quizzes?.includes(quizId);
export function QuizCard({ id, lessonId, cat }: { id: string; lessonId: string; cat: Catalog }) {
  const quiz = cat.quizzes.find(q => q.id === id);
  const [qs, setQs] = useState<Question[] | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [log, setLog] = useState<{ ok: boolean; ms: number }[]>([]);
  const [t0, setT0] = useState(0);
  const [result, setResult] = useState<string>('');
  if (!quiz) return <p class="error">Unknown quiz {id}</p>;
  const lesson = cat.lessonById[lessonId];
  const grades = gradesLesson(lesson, id);
  const pass = lesson?.pass_criteria as { score?: number; max_s?: number } | undefined;

  const start = async () => {
    const w = await quizWeights(id);
    const r = rng(Date.now());
    const list = Array.from({ length: N }, () => makeQuestion(id, quiz.params as Record<string, any>, r, w));
    setQs(list); setI(0); setPicked(null); setLog([]); setResult(''); setT0(performance.now());
    if (list[0].audio) playChords(list[0].audio.midi, list[0].audio.gapS);
  };
  const answer = (c: string) => {
    if (!qs || picked) return;
    const q = qs[i], ok = c === q.answer, ms = performance.now() - t0;
    setPicked(c); setLog(l => [...l, { ok, ms }]);
    void bumpQuizItem(id, q.key, ok);
  };
  const next = async () => {
    if (!qs) return;
    if (i + 1 < qs.length) {
      setI(i + 1); setPicked(null); setT0(performance.now());
      const q = qs[i + 1]; if (q.audio) playChords(q.audio.midi, q.audio.gapS);
      return;
    }
    const correct = log.filter(x => x.ok).length, score = correct / log.length;
    const meanS = log.reduce((a, b) => a + b.ms, 0) / log.length / 1000;
    const met = score >= (pass?.score ?? 0.9) && (!pass?.max_s || meanS <= pass.max_s);
    let msg = `${correct}/${log.length} correct · ${meanS.toFixed(1)} s per answer. `;
    const locked = lesson ? computeStates(cat.lessons, cat.tracks, progress.get().lp)[lesson.id] === 'locked' : false;
    if (grades && lesson && locked) msg += 'Practice round: this lesson isn’t unlocked yet, so it doesn’t count.';
    else if (grades && lesson) {
      const ev = await recordAttempt(lesson, { met, atTarget: true, score, mode: 'auto', metrics: { correct, total: log.length, meanS } });
      msg += met ? (EVENT_TEXT[ev] || 'Target met. (Only one pass per day counts.)') : `Target is ${Math.round((pass?.score ?? 0.9) * 100)}%${pass?.max_s ? ` and ≤ ${pass.max_s} s per answer` : ''}. Try again.`;
      if (saveStatus.get().state === 'saved') msg += ' ✓ Saved on this phone.';
    } else msg += 'Practice round.';
    setResult(msg); setQs(null);
  };

  if (!qs) {
    return (
      <div class="card inset quiz">
        <b>Quiz: {quiz.prompt.replace(/\{[^}]+\}/g, '…')}</b>
        <p class="muted">{N} questions{quiz.type === 'ear' ? ' · listen, then answer' : ''}{grades ? ' · counts toward this lesson' : ' · practice'}</p>
        {result ? <p class="note">{result}</p> : null}
        <button class="primary" onClick={start}>{result ? 'Go again' : 'Start quiz'}</button>
      </div>
    );
  }
  const q = qs[i];
  return (
    <div class="card inset quiz">
      <div class="row between"><small class="muted">Question {i + 1}/{qs.length}</small><small class="muted">{log.filter(x => x.ok).length} right</small></div>
      <p class="qprompt">{q.prompt}</p>
      {q.diagram ? (() => { const c = cat.chords.find(x => x.id === q.diagram); return c ? <div class="chords"><ChordDiagram name="?" shape={{ frets: c.frets, fingers: c.fingers, barre: c.barre ? c.barre.fret : null }} size={1.3} /></div> : null; })() : null}
      {q.audio ? <button class="small" onClick={() => playChords(q.audio!.midi, q.audio!.gapS)}>🔊 Play again</button> : null}
      <div class="choices">
        {q.choices.map(c => (
          <button class={picked ? (c === q.answer ? 'right' : c === picked ? 'wrong' : '') : ''} onClick={() => answer(c)}>{c}</button>
        ))}
      </div>
      {picked ? <div class="row between"><span class={picked === q.answer ? 'okText' : 'error'}>{picked === q.answer ? 'Correct' : `Answer: ${q.answer}`}</span><button class="primary" onClick={next}>{i + 1 < qs.length ? 'Next' : 'Finish'}</button></div> : null}
    </div>
  );
}
