import { apiFetch } from '../human.js';
import { editableFields, validateProposal, applyProposal } from './assistant.js';
import { TEMPLATES_LIST, buildTemplate } from './templates.js';

export function initAssistant({ current, commit, apply, create }) {
  const $ = id => document.getElementById(id);
  const say = text => { $('ai-status').textContent = text; };
  let pending = null, running = false;
  for (const t of TEMPLATES_LIST) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.title; $('ai-template').append(o); }
  $('ai-mode').addEventListener('change', () => { $('ai-template-row').hidden = $('ai-mode').value !== 'new'; });
  document.querySelectorAll('[data-ai-idea]').forEach(b => b.addEventListener('click', () => { $('ai-instruction').value = b.dataset.aiIdea; $('ai-instruction').focus(); }));
  $('ai-request').addEventListener('click', async () => {
    if (running) return;
    if (!$('ai-consent').checked) { say('Check the sharing notice first. Only the brief and editable page text are sent.'); return; }
    const instruction = $('ai-instruction').value.trim();
    if (!instruction) { say('Describe the change you want.'); $('ai-instruction').focus(); return; }
    commit(); const context = current(), before = JSON.stringify(context.site), mode = $('ai-mode').value;
    const base = structuredClone(mode === 'new' ? buildTemplate($('ai-template').value) : context.site);
    const fields = editableFields(base, mode === 'new' ? base.pages[0].id : context.pageId);
    running = true; pending = null; $('ai-request').disabled = true; $('ai-result').hidden = true;
    say('Writing your draft… You can keep browsing; nothing changes until you apply it.');
    try {
      const response = await apiFetch('/api/website-assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction, fields, consent: true }), signal: AbortSignal.timeout(110000) });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Use the live website studio to connect to the assistant.');
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'The assistant is unavailable.');
      const proposal = validateProposal(data, fields);
      if (!proposal.changes.length) { say(proposal.summary || 'No changes suggested. Try a more specific request.'); return; }
      const draft = applyProposal(base, proposal, fields);
      pending = { before, id: context.id, draft, mode };
      $('ai-summary').textContent = proposal.summary;
      $('ai-diff').replaceChildren(...proposal.changes.map(change => {
        const field = fields.find(f => f.path === change.path), item = document.createElement('li');
        const label = document.createElement('strong'), old = document.createElement('del'), next = document.createElement('ins');
        label.textContent = field.label; old.textContent = field.value || '(empty)'; next.textContent = change.value;
        item.append(label, old, next); return item;
      }));
      $('ai-apply').textContent = mode === 'new' ? 'Create this draft' : 'Apply changes';
      $('ai-result').hidden = false; say(`${proposal.changes.length} suggested changes. Review them below.`);
    } catch (e) { say(e.name === 'TimeoutError' ? 'The assistant took too long. Your site has not changed.' : e.message); }
    finally { running = false; $('ai-request').disabled = false; }
  });
  $('ai-discard').addEventListener('click', () => { pending = null; $('ai-result').hidden = true; say('Draft discarded. Your site is unchanged.'); });
  $('ai-apply').addEventListener('click', async () => {
    if (!pending) return;
    commit(); const ctx = current();
    if (ctx.id !== pending.id || JSON.stringify(ctx.site) !== pending.before) { say('Your site changed while this draft was being written. Ask for a fresh draft to keep your latest edits.'); pending = null; $('ai-result').hidden = true; return; }
    const draft = pending; pending = null; $('ai-apply').disabled = true;
    try {
      if (draft.mode === 'new') await create(draft.draft); else apply(draft.draft);
      $('ai-result').hidden = true;
      say(draft.mode === 'new' ? 'Draft created. Review every page and replace example content before publishing.' : 'Changes applied. Use Undo to restore the previous version.');
    } catch { say('The draft could not be applied. Your latest edits are still available; ask for a fresh draft.'); }
    finally { $('ai-apply').disabled = false; }
  });
}
