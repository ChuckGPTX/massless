// The tiny runtime every exported page runs, kept apart from the renderer so the hosting Worker (src/sites.js)
// can import exactly the same strings: it serves its own copy of assets/site.js and allows only this inline
// script by hash in a hosted site's Content Security Policy. No imports, no DOM access at load.

/** Written into every exported page as <meta name="generator">; hosting only accepts pages that carry it. */
export const GENERATOR = 'Chucksi Website';

/** Motion Loop heroes: a seamless shape loop behind the headline, coloured from the site's theme.
 * A compact copy of six loops from /js/loops-core.js (ripple, blob, orbit, dot wave, burst, flow), small enough for every
 * exported page. Skips canvases already live; one still frame when motion is off or reduced. */
export const LOOP_JS = `(function(d){var cs=d.querySelectorAll('canvas[data-loop]:not([data-live])');if(!cs.length)return;var T=6.2832,run=d.documentElement.getAttribute('data-motion')!=='none'&&!!window.matchMedia&&matchMedia('(prefers-reduced-motion: no-preference)').matches;
function e(k){return 1-Math.pow(1-k,3)}function dot(g,x,y,r){g.beginPath();g.arc(x,y,Math.max(0,r),0,T);g.fill()}
function draw(g,id,p,W,H,a,b){var u=Math.min(W,H),x=W/2,y=H/2,i,j,k,r;g.clearRect(0,0,W,H);g.lineCap='round';g.globalAlpha=1;
if(id==='ripple'){r=Math.hypot(W,H)*.55;for(i=0;i<7;i++){k=(p*2+i/7)%1;g.strokeStyle=i%2?b:a;g.globalAlpha=1-k;g.lineWidth=u*.02*(1-k*.6);g.beginPath();g.arc(x,y,k*r,0,T);g.stroke()}}
else if(id==='blob'){for(j=2;j>=0;j--){g.globalAlpha=j?.55:1;g.fillStyle=j%2?b:a;g.beginPath();for(i=0;i<=120;i++){k=i/120*T;r=u*(.2+j*.06)*(1+.12*Math.sin(3*k+T*p*(j+1))+.08*Math.sin(5*k-T*p*2));var q=k+T*p*(j%2?-1:1);g[i?'lineTo':'moveTo'](x+Math.cos(q)*r,y+Math.sin(q)*r)}g.fill()}}
else if(id==='orbit'){g.fillStyle=b;dot(g,x,y,u*.08);for(i=0;i<3;i++){var rx=u*(.18+i*.1),sp=(i+1)*(i%2?-1:1);g.save();g.translate(x,y);g.rotate(-.35+i*.35);g.strokeStyle=a;g.globalAlpha=.35;g.lineWidth=u*.006;g.beginPath();g.ellipse(0,0,rx,rx*.42,0,0,T);g.stroke();g.globalAlpha=1;g.fillStyle=i%2?a:b;k=T*p*sp;dot(g,Math.cos(k)*rx,Math.sin(k)*rx*.42,u*.035);g.restore()}}
else if(id==='grid'){r=u/9;for(j=r/2;j<H;j+=r)for(i=r/2;i<W;i+=r){k=.5-.5*Math.cos(T*(p-(i+j)/(r*36)));g.fillStyle=k>.5?a:b;dot(g,i,j,r*(.1+.3*k))}}
else if(id==='burst'){var n=Math.floor(p*3),l=p*3%1,o=e(l),t=e(Math.min(1,Math.max(0,(l-.25)/.75)));g.lineWidth=u*.018*(1-t*.8)*Math.min(1,l*12);for(i=0;i<12;i++){k=i/12*T+n*.4;var r0=u*(.08+t*.34),r1=u*(.1+o*.36);g.strokeStyle=(i+n)%2?b:a;if(r1>r0){g.beginPath();g.moveTo(x+Math.cos(k)*r0,y+Math.sin(k)*r0);g.lineTo(x+Math.cos(k)*r1,y+Math.sin(k)*r1);g.stroke()}}g.fillStyle=a;dot(g,x,y,u*.06*Math.sin(Math.PI*Math.min(1,l/.4)))}
else{r=H/9;for(i=0;i<9;i++){g.fillStyle=i%2?b:a;g.globalAlpha=.9;g.beginPath();g.moveTo(0,H);for(j=0;j<=W;j+=8)g.lineTo(j,i*r+Math.sin(j/(u*.25)+T*p*2+i*.7)*r*.45);g.lineTo(W,H);g.fill()}}}
cs.forEach(function(cv){var g=cv.getContext&&cv.getContext('2d');if(!g)return;cv.setAttribute('data-live','');var box=cv.parentNode,st=getComputedStyle(box),a=(st.getPropertyValue('--accent')||'').trim()||st.color,b=st.color,id=cv.getAttribute('data-loop'),vis=1,t0=performance.now(),dpr=Math.min(2,window.devicePixelRatio||1);
function size(){if(!cv.isConnected){removeEventListener('resize',size);return}cv.width=Math.round(cv.clientWidth*dpr);cv.height=Math.round(cv.clientHeight*dpr);if(!run)draw(g,id,.2,cv.width,cv.height,a,b)}
size();box.classList.add('live');addEventListener('resize',size);if(!run)return;
if('IntersectionObserver'in window)new IntersectionObserver(function(es){vis=es[0].isIntersecting}).observe(cv);
(function loop(now){if(!cv.isConnected)return;if(vis&&!d.hidden)draw(g,id,((now-t0)/12000)%1,cv.width,cv.height,a,b);requestAnimationFrame(loop)})(t0)})})(document);`;

/** The ambient canvas (manifesto hero). Standalone so the editor preview can run it too; skips canvases already live. */
export const GEN_JS = `(function(d){var de=d.documentElement,run=de.getAttribute('data-motion')!=='none'&&!!window.matchMedia&&matchMedia('(prefers-reduced-motion: no-preference)').matches;
d.querySelectorAll('canvas[data-gen]:not([data-live])').forEach(function(cv){var g=cv.getContext&&cv.getContext('2d');if(!g)return;cv.setAttribute('data-live','');var box=cv.parentNode,col=getComputedStyle(box).color,W,H,t=Math.random()*90,vis=1,dpr=Math.min(2,window.devicePixelRatio||1);
function size(){if(!cv.isConnected){removeEventListener('resize',size);return}W=cv.clientWidth;H=cv.clientHeight;cv.width=W*dpr;cv.height=H*dpr;g.setTransform(dpr,0,0,dpr,0,0);if(!run)draw()}
function draw(){g.clearRect(0,0,W,H);g.strokeStyle=col;g.lineWidth=1;var n=24,cx=W/2,sp=W*.3;for(var k=0;k<n;k++){var y0=H*.52+(k-n/2)*H*.034;g.beginPath();for(var x=-10;x<=W+10;x+=7){var e=Math.exp(-Math.pow((x-cx)/sp,2)),y=y0-e*(H*.07+k*H*.005)*Math.sin(k*.33+x/(W*.17)+t*(.55+k*.015))-e*H*.035*Math.sin(t*.4+k*.21);if(x<0)g.moveTo(x,y);else g.lineTo(x,y)}g.globalAlpha=.08+.42*Math.exp(-Math.pow((k-n/2)/(n/3.2),2));g.stroke()}g.globalAlpha=1}
size();box.classList.add('live');addEventListener('resize',size);if(!run)return;
if('IntersectionObserver'in window)new IntersectionObserver(function(es){vis=es[0].isIntersecting}).observe(cv);
(function loop(){if(!cv.isConnected)return;if(vis&&!d.hidden){t+=.0055;draw()}requestAnimationFrame(loop)})()})})(document);`;

/** Campaign motion: one observer, no animation loop, fine-pointer input at most once per frame. */
export const HERO_JS = `(function(){var d=document;if(d._heroStop)d._heroStop();var a=[].slice.call(d.querySelectorAll('[data-hero-motion]')),m=matchMedia('(prefers-reduced-motion: no-preference)'),p=matchMedia('(hover: hover) and (pointer: fine)');if(!a.length||!('IntersectionObserver'in window))return;var ctl=new AbortController(),opt={signal:ctl.signal};
function reset(e){e.style.removeProperty('--mx');e.style.removeProperty('--my')}
function sync(){a.forEach(function(e){var on=e._hv&&!d.hidden&&m.matches&&d.documentElement.dataset.motion!=='none';e.classList.toggle('hero-live',!!on);if(!on||!p.matches)reset(e)})}
var o=new IntersectionObserver(function(es){es.forEach(function(x){x.target._hv=x.isIntersecting});sync()});a.forEach(function(e){e.setAttribute('data-hero-live','');o.observe(e);e.addEventListener('pointermove',function(x){e._hp=x;if(e._hr)return;e._hr=requestAnimationFrame(function(){e._hr=0;if(!e.classList.contains('hero-live')||!p.matches)return;var r=e.getBoundingClientRect(),q=e._hp;e.style.setProperty('--mx',Math.max(-1,Math.min(1,(q.clientX-r.left)/r.width*2-1)).toFixed(3));e.style.setProperty('--my',Math.max(-1,Math.min(1,(q.clientY-r.top)/r.height*2-1)).toFixed(3))})},opt);e.addEventListener('pointerleave',function(){cancelAnimationFrame(e._hr);e._hr=0;reset(e)},opt)});d.addEventListener('visibilitychange',sync,opt);m.addEventListener('change',sync,opt);p.addEventListener('change',sync,opt);d._heroStop=function(){ctl.abort();o.disconnect();a.forEach(function(e){cancelAnimationFrame(e._hr);e._hr=0;e._hv=false;e.classList.remove('hero-live');e.removeAttribute('data-hero-live');reset(e)});delete d._heroStop};sync()})();`;

/** The runtime every exported page loads: reveal, scroll scrub and parallax, case-study rail and ambient motion. Kept as a string so it can be inlined or saved. */
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
${HERO_JS}
${GEN_JS}
${LOOP_JS}
if(location.protocol==='file:')d.querySelectorAll('a[href]').forEach(function(a){var h=a.getAttribute('href');if(!/^[a-z][\\w+.-]*:|^#|^\\/\\//i.test(h)&&/\\/(#.*)?$/.test(h))a.setAttribute('href',h.replace(/\\/(#.*)?$/,'/index.html$1'))});
})();`;

/** The one inline script in an exported page's <head>: turns on scroll reveal before first paint. */
export const HEAD_BOOT = `<script>(function(d){var m=d.dataset.motion;if(m!=='none'&&'IntersectionObserver'in window&&matchMedia('(prefers-reduced-motion: no-preference)').matches)d.classList.add('rv')})(document.documentElement)</script>`;
