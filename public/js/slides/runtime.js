// The deck runtime: entrance animations, slide transitions and the presenter/player. It is one self-contained
// function with no imports or outside references, because the single-file HTML export embeds it verbatim
// with Function.prototype.toString(). Everything runs on the Web Animations API, so nothing is left in a
// half-animated state: keyframes use fill "backwards" and the final look is plain CSS. prefers-reduced-motion
// turns entrances off and every transition into a short cross-fade.

export function deckRuntime() {
  const W = 1280, H = 720;
  const EASE = 'cubic-bezier(.2,.75,.2,1)';
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const running = new WeakMap();

  function parseCount(s) {
    const m = String(s || '').match(/^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
    if (!m) return null;
    const value = parseFloat(m[2].replace(/,/g, ''));
    if (!isFinite(value)) return null;
    return { prefix: m[1], value, decimals: (m[2].split('.')[1] || '').length, suffix: m[3], comma: m[2].indexOf(',') >= 0 };
  }
  function fmt(c, v) {
    let s = v.toFixed(c.decimals);
    if (c.comma || Math.abs(c.value) >= 10000) { const [a, b] = s.split('.'); s = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b ? '.' + b : ''); }
    return c.prefix + s + c.suffix;
  }
  function countUp(el, delay, dur) {
    const final = el.getAttribute('data-count');
    const c = parseCount(final);
    if (!c) return;
    const t0 = performance.now() + delay;
    el.textContent = fmt(c, 0);
    const step = (now) => {
      if (!el.isConnected || el.isContentEditable) { el.textContent = final; return; }
      const f = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = 1 - Math.pow(1 - f, 3);
      el.textContent = f >= 1 ? final : fmt(c, c.value * e);
      if (f < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Stop and finish whatever is animating on a slide. */
  function settle(slide) {
    (running.get(slide) || []).forEach((a) => { try { a.cancel(); } catch (e) { /* gone */ } });
    running.delete(slide);
    slide.querySelectorAll('[data-count]').forEach((n) => { if (!n.isContentEditable) n.textContent = n.getAttribute('data-count'); });
  }

  /** Entrance: staggered text, image reveals, count-up numbers and charts that draw in. */
  function playIn(slide, opts) {
    opts = opts || {};
    settle(slide);
    const style = slide.getAttribute('data-anim') || 'rise';
    if (reduced() || style === 'none' || !slide.animate) return 0;
    const list = [];
    const nodes = Array.prototype.slice.call(slide.querySelectorAll('[data-a]'));
    let t = opts.delay || 0, last = 0;
    const gap = style === 'fade' ? 70 : 85;
    const textKF = style === 'fade' ? [{ opacity: 0 }, { opacity: 1 }]
      : style === 'pop' ? [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 0, transform: 'translateY(34px)' }, { opacity: 1, transform: 'none' }];
    let bars = 0, dots = 0;
    for (const n of nodes) {
      const a = n.getAttribute('data-a');
      let kf, dur = 700, delay = t, ease = EASE;
      if (a === 'img') { kf = [{ clipPath: 'inset(0 0 100% 0)', transform: 'scale(1.06)' }, { clipPath: 'inset(0 0 0% 0)', transform: 'none' }]; dur = 1000; ease = 'cubic-bezier(.7,0,.2,1)'; }
      else if (a === 'bar') { kf = [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }]; dur = 800; delay = t + bars++ * 60; }
      else if (a === 'rule') { kf = [{ transform: 'scaleX(0)', transformOrigin: '0 50%' }, { transform: 'scaleX(1)', transformOrigin: '0 50%' }]; dur = 1100; }
      else if (a === 'line') {
        let len = 1200;
        try { len = n.getTotalLength(); } catch (e) { /* not laid out */ }
        kf = [{ strokeDasharray: `${len} ${len}`, strokeDashoffset: len }, { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 }];
        dur = 1200; ease = 'cubic-bezier(.45,0,.2,1)';
      } else if (a === 'dot') { kf = [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }]; dur = 420; delay = t + 380 + dots++ * 70; }
      else { kf = textKF; if (a === 'n') countUp(n, t + 100, 1400); }
      const anim = n.animate(kf, { duration: dur, delay, easing: ease, fill: 'backwards' });
      list.push(anim);
      last = Math.max(last, delay + dur);
      if (a !== 'bar' && a !== 'dot') t += a === 'img' ? 140 : gap;
    }
    running.set(slide, list);
    return last;
  }

  const fadeKF = (a, b) => [{ opacity: a }, { opacity: b }];
  /** Animate from one slide element to the next. Both live in the same .dk-stack; resolves when done. */
  function transition(from, to, kind, dir) {
    dir = dir || 1;
    to.hidden = false;
    if (!from || from === to) return Promise.resolve();
    const done = () => { from.hidden = true; from.style.zIndex = ''; to.style.zIndex = ''; };
    if (!to.animate || kind === 'none') { done(); return Promise.resolve(); }
    if (reduced()) {
      const a = to.animate(fadeKF(0, 1), { duration: 180, easing: 'linear' });
      return a.finished.then(done, done);
    }
    let anims = [];
    const D = 620;
    to.style.zIndex = 2; from.style.zIndex = 1;
    if (kind === 'push') {
      anims = [
        from.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-dir * 100}%)` }], { duration: D, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' }),
        to.animate([{ transform: `translateX(${dir * 100}%)` }, { transform: 'translateX(0)' }], { duration: D, easing: 'cubic-bezier(.7,0,.2,1)' }),
      ];
    } else if (kind === 'zoom') {
      anims = [
        from.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: `scale(${dir > 0 ? 1.12 : 0.9})` }], { duration: D, easing: EASE, fill: 'forwards' }),
        to.animate([{ opacity: 0, transform: `scale(${dir > 0 ? 0.9 : 1.12})` }, { opacity: 1, transform: 'scale(1)' }], { duration: D, easing: EASE }),
      ];
    } else if (kind === 'morph') {
      const a = from.querySelector('[data-morph]'), b = to.querySelector('[data-morph]');
      anims = [from.animate(fadeKF(1, 0), { duration: 460, easing: 'ease-out', fill: 'forwards' }), to.animate(fadeKF(0, 1), { duration: 560, easing: 'ease-in-out' })];
      if (a && b && b.animate) {
        // the shared title: a ghost copy glides and rescales from where it was to where it lands
        const rs = to.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const k = rs.width / W || 1;
        const fa = parseFloat(getComputedStyle(a).fontSize) || 1, fb = parseFloat(getComputedStyle(b).fontSize) || 1;
        if (ra.width && rb.width) {
          const ghost = from.cloneNode(false);
          ghost.removeAttribute('data-id');
          ghost.setAttribute('aria-hidden', 'true');
          ghost.hidden = false;
          ghost.style.background = 'transparent';
          ghost.style.zIndex = 3;
          ghost.style.pointerEvents = 'none';
          const ca = a.cloneNode(true);
          ca.removeAttribute('data-a');
          Object.assign(ca.style, { position: 'absolute', margin: '0', left: `${(ra.left - rs.left) / k}px`, top: `${(ra.top - rs.top) / k}px`, width: `${ra.width / k + 2}px`, transformOrigin: '0 0' });
          ghost.appendChild(ca);
          to.parentNode.appendChild(ghost);
          const s = fb / fa, dx = (rb.left - ra.left) / k, dy = (rb.top - ra.top) / k;
          const colA = getComputedStyle(a).color, colB = getComputedStyle(b).color;
          b.style.opacity = '0';
          const g = ca.animate([{ transform: 'none', color: colA, opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${s})`, color: colB, opacity: 1, offset: 0.85 }, { transform: `translate(${dx}px, ${dy}px) scale(${s})`, color: colB, opacity: 0 }], { duration: 820, easing: 'cubic-bezier(.6,0,.15,1)', fill: 'forwards' });
          const show = b.animate([{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }], { duration: 820 });
          b.style.opacity = '';
          anims.push(g, show);
          g.finished.then(() => ghost.remove(), () => ghost.remove());
          b.setAttribute('data-morphed', '');
        }
      }
    } else {
      anims = [to.animate(fadeKF(0, 1), { duration: 520, easing: 'ease-out' }), from.animate(fadeKF(1, 0), { duration: 520, easing: 'ease-in', fill: 'forwards' })];
    }
    return Promise.all(anims.map((x) => x.finished.catch(() => {}))).then(() => { anims.forEach((x) => { try { x.cancel(); } catch (e) { /* gone */ } }); done(); });
  }

  /** Entrance after a morph: skip the shared title so it does not animate twice. */
  function playAfter(slide, kind) {
    const m = kind === 'morph' ? slide.querySelector('[data-morphed]') : null;
    if (m) { m.removeAttribute('data-morphed'); const keep = m.getAttribute('data-a'); m.removeAttribute('data-a'); const d = playIn(slide, { delay: 220 }); if (keep) m.setAttribute('data-a', keep); return d; }
    return playIn(slide, { delay: kind === 'push' || kind === 'zoom' ? 240 : 120 });
  }

  /**
   * A full-screen player. slides: [{ html, notes }]. opts: { title, start, accent, inline, onExit(index), onEdit, editLabel, exitLabel }
   */
  function Player(slides, opts) {
    opts = opts || {};
    const doc = document;
    const root = doc.createElement('div');
    root.className = 'dk-player' + (opts.inline ? ' inline' : '');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', (opts.title || 'Deck') + ', presentation');
    root.tabIndex = -1;
    if (opts.accent) root.style.setProperty('--dk-accent', opts.accent);
    const ic = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
    root.innerHTML = '<div class="dk-view"><div class="dk-fit"><div class="dk-stack"></div></div><div class="dk-prog"><i></i></div></div>'
      + '<div class="dk-bar">'
      + `<button type="button" data-do="prev" aria-label="Previous slide">${ic('<path d="M10 3L5 8l5 5"/>')}</button>`
      + '<span class="dk-count" aria-live="polite"></span>'
      + `<button type="button" data-do="next" aria-label="Next slide">${ic('<path d="M6 3l5 5-5 5"/>')}</button>`
      + `<span class="dk-title">${(opts.title || '').replace(/[<&>"]/g, '')}</span><span class="sp"></span>`
      + `<button type="button" data-do="notes" aria-pressed="false" class="hide-s" title="Presenter notes (N)">${ic('<path d="M3 2.5h10v11H3zM5.5 6h5M5.5 8.5h5M5.5 11h3"/>')}<span>Notes</span></button>`
      + `<button type="button" data-do="laser" aria-pressed="false" title="Laser pointer (L)">${ic('<circle cx="8" cy="8" r="2.4"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"/>')}<span class="hide-s">Laser</span></button>`
      + `<button type="button" data-do="full" class="hide-s" title="Full screen (F)">${ic('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>')}</button>`
      + (opts.onEdit ? `<button type="button" data-do="edit">${opts.editLabel || 'Edit'}</button>` : '')
      + (opts.onExit ? `<button type="button" data-do="exit" title="Exit (Esc)">${ic('<path d="M4 4l8 8M12 4l-8 8"/>')}<span class="hide-s">${opts.exitLabel || 'Exit'}</span></button>` : '')
      + '</div>';
    const view = root.querySelector('.dk-view'), fit = root.querySelector('.dk-fit'), stack = root.querySelector('.dk-stack');
    const count = root.querySelector('.dk-count'), prog = root.querySelector('.dk-prog i');
    stack.innerHTML = slides.map((s) => s.html).join('');
    const els = Array.prototype.slice.call(stack.children);
    els.forEach((e) => { e.hidden = true; });
    let cur = -1, busy = false, queued = null, notesEl = null, laserEl = null, idleT = 0;

    function scale() {
      const r = view.getBoundingClientRect();
      const k = Math.min(r.width / W, r.height / H) || 1;
      fit.style.transform = `translate(-50%, -50%) scale(${k})`;
      fit.style.width = W + 'px'; fit.style.height = H + 'px';
    }
    function sync() {
      count.textContent = `${cur + 1} / ${els.length}`;
      prog.style.width = `${((cur + 1) / els.length) * 100}%`;
      if (notesEl) notesEl.innerHTML = '<small>Notes · slide ' + (cur + 1) + '</small>' + (slides[cur].notes ? slides[cur].notes.replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c])) : 'No notes for this slide.');
      if (opts.onChange) opts.onChange(cur);
    }
    function go(i, instant) {
      i = Math.max(0, Math.min(els.length - 1, i));
      if (i === cur) return;
      if (busy) { queued = i; return; }
      const from = els[cur], to = els[i], dir = i > cur ? 1 : -1;
      const kind = instant || !from ? 'none' : (dir > 0 ? to : from).getAttribute('data-tr') || 'fade';
      cur = i;
      sync();
      busy = true;
      if (from) settle(from);
      transition(from, to, kind, dir).then(() => {
        busy = false;
        playAfter(to, kind);
        if (queued != null) { const q = queued; queued = null; go(q); }
      });
      if (kind === 'morph' || kind === 'none') { /* the entrance waits for the transition */ }
    }
    const next = () => go(cur + 1), prev = () => go(cur - 1);
    function toggleNotes(force) {
      const on = force != null ? force : !notesEl;
      if (on && !notesEl) { notesEl = doc.createElement('div'); notesEl.className = 'dk-notes'; view.appendChild(notesEl); sync(); }
      if (!on && notesEl) { notesEl.remove(); notesEl = null; }
      root.querySelector('[data-do="notes"]').setAttribute('aria-pressed', String(!!notesEl));
    }
    function toggleLaser(force) {
      const on = force != null ? force : !laserEl;
      if (on && !laserEl) { laserEl = doc.createElement('i'); laserEl.className = 'dk-laser'; laserEl.style.display = 'none'; view.appendChild(laserEl); }
      if (!on && laserEl) { laserEl.remove(); laserEl = null; }
      root.classList.toggle('laser', !!laserEl);
      root.querySelector('[data-do="laser"]').setAttribute('aria-pressed', String(!!laserEl));
    }
    let ownExit = false, wasFull = false;
    function full() {
      if (doc.fullscreenElement) { ownExit = true; doc.exitFullscreen().catch(() => {}); return; }
      if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
    }
    function onFs() {
      // leaving full screen with Esc (not with F) also leaves the presentation
      if (doc.fullscreenElement === root) { wasFull = true; return; }
      if (wasFull && !ownExit && opts.onExit && root.isConnected) exit();
      wasFull = false; ownExit = false;
      setTimeout(scale, 50);
    }
    function exit() {
      cleanup();
      if (doc.fullscreenElement) { ownExit = true; doc.exitFullscreen().catch(() => {}); }
      root.remove();
      if (opts.onExit) opts.onExit(cur);
    }
    function onKey(e) {
      if (e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
      const k = e.key;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].indexOf(k) >= 0) { e.preventDefault(); next(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].indexOf(k) >= 0) { e.preventDefault(); prev(); }
      else if (k === 'Home') { e.preventDefault(); go(0); }
      else if (k === 'End') { e.preventDefault(); go(els.length - 1); }
      else if (k === 'n' || k === 'N') toggleNotes();
      else if (k === 'l' || k === 'L') toggleLaser();
      else if (k === 'f' || k === 'F') full();
      else if (k === 'Escape' && opts.onExit) { e.preventDefault(); exit(); }
      else if (/^[1-9]$/.test(k)) go(Number(k) - 1);
      wake();
    }
    function wake() {
      root.classList.remove('idle');
      clearTimeout(idleT);
      idleT = setTimeout(() => { if (!opts.inline) root.classList.add('idle'); }, 2600);
    }
    let sx = 0, sy = 0, st = 0, moved = false;
    view.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = Date.now(); moved = false; });
    view.addEventListener('pointermove', (e) => {
      wake();
      if (Math.abs(e.clientX - sx) > 10) moved = true;
      if (laserEl) { const r = view.getBoundingClientRect(); laserEl.style.display = ''; laserEl.style.left = (e.clientX - r.left) + 'px'; laserEl.style.top = (e.clientY - r.top) + 'px'; }
    });
    view.addEventListener('pointerup', (e) => {
      if (e.target.closest && e.target.closest('.dk-notes')) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - st < 800) { if (dx < 0) next(); else prev(); return; }
      if (moved || laserEl) return;
      const r = view.getBoundingClientRect();
      if (e.clientX - r.left < r.width * 0.28) prev(); else next();
    });
    root.querySelector('.dk-bar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-do]');
      if (!b) return;
      const d = b.getAttribute('data-do');
      if (d === 'prev') prev(); else if (d === 'next') next(); else if (d === 'notes') toggleNotes(); else if (d === 'laser') toggleLaser();
      else if (d === 'full') full(); else if (d === 'exit') exit(); else if (d === 'edit') { const i = cur; cleanup(); root.remove(); if (doc.fullscreenElement) doc.exitFullscreen().catch(() => {}); opts.onEdit(i); }
    });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(scale) : null;
    function cleanup() { doc.removeEventListener('keydown', onKey); doc.removeEventListener('fullscreenchange', onFs); if (ro) ro.disconnect(); window.removeEventListener('resize', scale); clearTimeout(idleT); }
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('fullscreenchange', onFs);
    window.addEventListener('resize', scale);

    return {
      el: root,
      mount(parent, fullscreen) {
        (parent || doc.body).appendChild(root);
        if (ro) ro.observe(view);
        scale();
        go(Math.max(0, Math.min(els.length - 1, opts.start || 0)), true);
        if (fullscreen && root.requestFullscreen) root.requestFullscreen().catch(() => {});
        root.focus({ preventScroll: true });
        if (!opts.inline) {
          const help = doc.createElement('div');
          help.className = 'dk-help';
          help.textContent = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'Swipe or tap to move' : '← → to move · N notes · L laser · F full screen';
          view.appendChild(help);
          setTimeout(() => { help.style.opacity = '0'; }, 2600);
          setTimeout(() => help.remove(), 3400);
        }
        wake();
        return this;
      },
      go, next, prev, exit, toggleNotes, toggleLaser,
      get index() { return cur; },
    };
  }

  return { playIn, settle, transition, playAfter, Player, parseCount, reduced };
}
