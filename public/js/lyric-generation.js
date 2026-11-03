// One generation transaction. Each stage must finish before the next can start.
// A retry can reuse corrected lyrics without sending the song for transcription again.
export async function generateLyricVideo({prepare, transcribe, compose, render, signal, onStage = () => {}}) {
  const check = () => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  for (const [name, task] of [['prepare', prepare], ['transcribe', transcribe], ['compose', compose]]) {
    check();
    if (task) { onStage(name); await task(signal); }
  }
  check(); onStage('render');
  const result = await render(signal, progress => { check(); onStage('render', progress); });
  check();
  return result;
}

// Repeated phrases get emphasis, while ordinary verses stay readable.
// This is a typography decision, not a claim of musical chorus detection.
export function directLyrics(cues) {
  const key = text => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const counts = new Map();
  for (const cue of cues) { const k = key(cue.text); counts.set(k, (counts.get(k) || 0) + 1); }
  return cues.map(cue => ({...cue, emphasis: cue.emphasis || (key(cue.text).length > 8 && counts.get(key(cue.text)) > 1)}));
}
