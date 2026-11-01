// The tiny runtime every exported page runs, kept apart from the renderer so the hosting Worker (src/sites.js)
// can import exactly the same strings: it serves its own copy of assets/site.js and allows only this inline
// script by hash in a hosted site's Content Security Policy. No imports, no DOM access at load.

/** Written into every exported page as <meta name="generator">; hosting only accepts pages that carry it. */
export const GENERATOR = 'Chucksi Website';

/** The ambient canvas (manifesto hero). Standalone so the editor preview can run it too; skips canvases already live. */
export const GEN_JS = `(function(d){var de=d.documentElement,run=de.getAttribute('data-motion')!=='none'&&!!window.matchMedia&&matchMedia('(prefers-reduced-motion: no-preference)').matches;
d.querySelectorAll('canvas[data-gen]:not([data-live])').forEach(function(cv){var g=cv.getContext&&cv.getContext('2d');if(!g)return;cv.setAttribute('data-live','');var box=cv.parentNode,col=getComputedStyle(box).color,W,H,t=Math.random()*90,vis=1,dpr=Math.min(2,window.devicePixelRatio||1);
function size(){if(!cv.isConnected){removeEventListener('resize',size);return}W=cv.clientWidth;H=cv.clientHeight;cv.width=W*dpr;cv.height=H*dpr;g.setTransform(dpr,0,0,dpr,0,0);if(!run)draw()}
function draw(){g.clearRect(0,0,W,H);g.strokeStyle=col;g.lineWidth=1;var n=24,cx=W/2,sp=W*.3;for(var k=0;k<n;k++){var y0=H*.52+(k-n/2)*H*.034;g.beginPath();for(var x=-10;x<=W+10;x+=7){var e=Math.exp(-Math.pow((x-cx)/sp,2)),y=y0-e*(H*.07+k*H*.005)*Math.sin(k*.33+x/(W*.17)+t*(.55+k*.015))-e*H*.035*Math.sin(t*.4+k*.21);if(x<0)g.moveTo(x,y);else g.lineTo(x,y)}g.globalAlpha=.08+.42*Math.exp(-Math.pow((k-n/2)/(n/3.2),2));g.stroke()}g.globalAlpha=1}
size();box.classList.add('live');addEventListener('resize',size);if(!run)return;
if('IntersectionObserver'in window)new IntersectionObserver(function(es){vis=es[0].isIntersecting}).observe(cv);
(function loop(){if(!cv.isConnected)return;if(vis&&!d.hidden){t+=.0055;draw()}requestAnimationFrame(loop)})()})})(document);`;

/** The runtime every exported page loads (about 5 KB): reveal, scroll scrub and parallax, the case-study rail, the ambient canvas. Kept as a string so it can be inlined or saved. */
export const SITE_JS = `(function(){var d=document,de=d.documentElement;
if(de.classList.contains('rv')&&'IntersectionObserver'in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -6% 0px',threshold:.06});d.querySelectorAll('[data-rv]').forEach(function(el){io.observe(el)})}
var audio,cur;function set(b,on){b.setAttribute('aria-pressed',on?'true':'false')}
function prog(){var t=cur&&cur.closest('.track'),bar=t&&t.querySelector('.tbar i');if(bar&&audio.duration)bar.style.width=(audio.currentTime/audio.duration*100)+'%'}
function play(b){if(!audio){audio=new Audio();audio.addEventListener('timeupdate',prog);audio.addEventListener('ended',function(){set(cur,false);var all=[].slice.call(d.querySelectorAll('.tplay')),n=all[all.indexOf(cur)+1];if(n)play(n)})}
if(cur===b){if(audio.paused){audio.play();set(b,true)}else{audio.pause();set(b,false)}return}
if(cur)set(cur,false);cur=b;audio.src=b.getAttribute('data-audio');audio.play().catch(function(){});set(b,true)}
d.addEventListener('click',function(e){var t=e.target;if(!t.closest)return;var b=t.closest('[data-embed]');
if(b){var f=d.createElement('iframe');f.src=b.getAttribute('data-embed');f.title=b.getAttribute('data-title')||'Embedded content';f.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';f.setAttribute('allowfullscreen','');b.replaceWith(f);return}
var p=t.closest('.tplay');if(p){e.preventDefault();play(p)}
var m=t.closest('.menu-panel a');if(m){var det=m.closest('details');if(det)det.open=false}});
d.querySelectorAll('form[data-mailto]').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var l=[];new FormData(f).forEach(function(v,k){l.push(k+': '+v)});location.href='mailto:'+f.getAttribute('data-mailto')+'?subject='+encodeURIComponent(f.getAttribute('data-subject')||'Website message')+'&body='+encodeURIComponent(l.join('\\n'))})});
d.querySelectorAll('form[data-unconnected]').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var n=f.querySelector('.form-note');if(n){n.textContent='This form is not connected yet.';n.removeAttribute('hidden')}})});
var rv=de.classList.contains('rv'),wide=matchMedia('(min-width: 900px)'),rails=[].slice.call(d.querySelectorAll('[data-rail]')),scr=[].slice.call(d.querySelectorAll('[data-scrub]')),busy=0;
function lay(){var on=rv&&wide.matches;rails.forEach(function(r){var tr=r.querySelector('.rail-track');r.classList.toggle('on',on);if(!on){r.style.height='';tr.style.transform='';return}r._d=Math.max(0,tr.scrollWidth-innerWidth);r.style.height=(innerHeight+r._d)+'px'});scr.forEach(function(e){if(e.classList.contains('ann'))e.classList.toggle('on',on)});tick()}
function tick(){busy=0;var vh=innerHeight;rails.forEach(function(r){if(!r.classList.contains('on'))return;var b=r.getBoundingClientRect(),p=Math.min(1,Math.max(0,-b.top/(r._d||1))),tr=r.querySelector('.rail-track'),y=r.querySelector('[data-year-out]'),cur;tr.style.transform='translate3d('+(-p*r._d).toFixed(1)+'px,0,0)';var tx=innerWidth*(.2+.6*p),bd=1e9;[].forEach.call(tr.children,function(li){var q=li.getBoundingClientRect(),dd=Math.abs(q.left+q.width/2-tx);if(dd<bd){bd=dd;cur=li}});if(y&&cur&&y.textContent!==cur.getAttribute('data-year'))y.textContent=cur.getAttribute('data-year')});
scr.forEach(function(e){var b=e.getBoundingClientRect(),p=e.classList.contains('on')?-b.top/Math.max(1,b.height-vh):e.getAttribute('data-scrub')==='par'?(vh-b.top)/(vh+b.height):(vh*.92-b.top)/(b.height*.55+vh*.45);e.style.setProperty('--p',Math.min(1,Math.max(0,p)).toFixed(3))})}
if(rv&&(rails.length||scr.length)){addEventListener('scroll',function(){if(!busy){busy=1;requestAnimationFrame(tick)}},{passive:true});addEventListener('resize',lay);if(wide.addEventListener)wide.addEventListener('change',lay);addEventListener('load',lay);lay()}
${GEN_JS}
if(location.protocol==='file:')d.querySelectorAll('a[href]').forEach(function(a){var h=a.getAttribute('href');if(!/^[a-z][\\w+.-]*:|^#|^\\/\\//i.test(h)&&/\\/(#.*)?$/.test(h))a.setAttribute('href',h.replace(/\\/(#.*)?$/,'/index.html$1'))});
})();`;

/** The one inline script in an exported page's <head>: turns on scroll reveal before first paint. */
export const HEAD_BOOT = `<script>(function(d){var m=d.dataset.motion;if(m!=='none'&&'IntersectionObserver'in window&&matchMedia('(prefers-reduced-motion: no-preference)').matches)d.classList.add('rv')})(document.documentElement)</script>`;
