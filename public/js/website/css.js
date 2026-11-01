// The stylesheet every Chucksi site ships: a fluid type and spacing system, the section layouts,
// one flavour block per style, motion that respects prefers-reduced-motion, and (in the editor only)
// the editing overlay. Colours and fonts come from theme.js as CSS custom properties.

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.6'/%3E%3C/svg%3E\")";

export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:400 1.0625rem/1.62 var(--font-b);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
img,svg,video{display:block;max-width:100%}
img{height:auto}
a{color:inherit}
p,ul,ol,figure,blockquote,h1,h2,h3,h4{margin:0}
ul[class],ol[class]{list-style:none;padding:0}
button,input,textarea,select{font:inherit;color:inherit}
[hidden]{display:none!important}
.sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
:focus-visible{outline:2px solid var(--accent-text);outline-offset:3px;border-radius:2px}
.skip{position:absolute;left:-9999px;top:12px;z-index:100;background:var(--bg);color:var(--text);padding:.7em 1em;border-radius:var(--r-sm)}
.skip:focus{left:12px}
:root{--max:1200px;--gut:clamp(20px,5vw,56px);--sec:calc(clamp(64px,8.5vw,128px)*var(--sp));--rv-d:20px}
.wrap{width:min(var(--max),100% - 2*var(--gut));margin-inline:auto}
.wrap.narrow{width:min(880px,100% - 2*var(--gut))}
.center{text-align:center}
.center .actions,.actions.center{justify-content:center}
.sec{position:relative;isolation:isolate;padding-block:var(--sec);overflow-x:clip}
.t-alt,.t-inv,.t-acc{background:var(--bg);color:var(--text)}
.ic{width:1.15em;height:1.15em;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex:none}

/* type */
.h1,.h2,.h3,.f-brand,.stat-v,.amount,.step-num,.listing-price,.home-price,.mcat-h,.day-h,.stmt-t,.ch-t,.rail-year,.case-year,.stmt-mark,.stmt-q,.ch-n{font-family:var(--font-h);font-weight:var(--hw);letter-spacing:var(--ht);text-transform:var(--hc);font-stretch:var(--h-str,100%)}
.h1,.h2{line-height:var(--hl);text-wrap:balance;overflow-wrap:break-word}
.h1{font-size:clamp(2.55rem,1.5rem + 4.4vw,5.6rem)}
.h1-xl{font-size:clamp(2.6rem,.9rem + 8.2vw,9.6rem);line-height:calc(var(--hl) - .06)}
.h1-sm{font-size:clamp(2.3rem,1.5rem + 3.3vw,4.6rem)}
.h2{font-size:clamp(2rem,1.35rem + 2.6vw,3.6rem)}
.h2.xl{font-size:clamp(2.3rem,1.3rem + 4vw,5rem)}
.h3{font-size:clamp(1.14rem,1.04rem + .4vw,1.38rem);line-height:1.25;text-transform:none;letter-spacing:calc(var(--ht) * .4)}
.h3.lg{font-size:clamp(1.5rem,1.2rem + 1.1vw,2.2rem);line-height:1.12}
.h1 em,.h2 em,.f-brand em{font-style:var(--h-ital);color:var(--accent-text)}
.eyebrow{font-size:.78rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-text);line-height:1.3}
.lead{font-size:clamp(1.06rem,1rem + .38vw,1.3rem);line-height:1.55;color:var(--muted);max-width:40em}
.center .lead,.lead.center{margin-inline:auto}
.muted{color:var(--muted)}
.sm{font-size:.92rem}
.body-l{font-size:1.1rem}
.fine{font-size:.86rem;color:var(--muted);margin-top:18px}
.prose p+p{margin-top:1em}
.prose{max-width:62ch}
.center .prose{margin-inline:auto}
.sec-head{display:grid;gap:16px;max-width:760px;margin-bottom:clamp(36px,5vw,64px)}
.sec-head.center{margin-inline:auto;text-align:center;justify-items:center}

/* buttons */
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.6em;min-height:52px;padding:.7em 1.5em;border-radius:var(--r-btn);background:var(--accent);color:var(--accent-ink);border:1.5px solid var(--accent);font:600 1rem/1.2 var(--font-b);text-decoration:none;text-align:center;cursor:pointer;transition:transform .25s,box-shadow .25s,background-color .25s,border-color .25s,color .25s}
.btn .arr{width:1.1em;height:1.1em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .25s;flex:none}
.btn .ic{stroke-width:1.8}
.btn.alt{background:transparent;color:var(--text);border-color:var(--line-2)}
.btn.wide{width:100%}
.btn.sm{min-height:40px;padding:.45em 1.05em;font-size:.9rem}
.note{display:flex;gap:.5em;align-items:center;margin-top:22px;color:var(--muted);font-size:.94rem}
.note .ic{color:var(--accent-text)}
.pill{display:inline-block;width:max-content;background:var(--bg);color:var(--text);border:1px solid var(--line);font-size:.74rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:.45em .8em;border-radius:999px}

/* media and generated placeholder art */
.media{position:relative;overflow:hidden;border-radius:var(--r-lg);background:var(--surface-2)}
.media img{width:100%;height:100%;object-fit:cover}
.media .ph{position:absolute;inset:0}
.ph{background-color:var(--surface-2);overflow:hidden}
.ph::after{content:'';position:absolute;inset:0;background-image:${GRAIN};opacity:.22;mix-blend-mode:overlay;pointer-events:none}
.ph-0{background:radial-gradient(110% 85% at 12% 18%,color-mix(in srgb,var(--accent) 62%,transparent) 0,transparent 58%),radial-gradient(90% 80% at 88% 86%,color-mix(in srgb,var(--accent-2) 70%,transparent) 0,transparent 62%),linear-gradient(160deg,var(--surface-2),var(--bg))}
.ph-1{background:radial-gradient(circle at 68% 38%,color-mix(in srgb,var(--accent-2) 85%,transparent) 0 17%,transparent 17.4%),linear-gradient(180deg,color-mix(in srgb,var(--accent) 30%,var(--surface-2)) 0 62%,color-mix(in srgb,var(--accent) 70%,var(--bg)) 62% 100%)}
.ph-2{background:conic-gradient(from 210deg at 30% 70%,color-mix(in srgb,var(--accent) 70%,transparent),color-mix(in srgb,var(--accent-2) 55%,transparent),var(--surface-2),color-mix(in srgb,var(--accent) 70%,transparent))}
.ph-3{background:radial-gradient(140% 70% at 50% 110%,color-mix(in srgb,var(--accent) 80%,transparent) 0 40%,transparent 40.5%),radial-gradient(120% 60% at 20% 105%,color-mix(in srgb,var(--accent-2) 70%,transparent) 0 45%,transparent 45.5%),linear-gradient(180deg,var(--surface-2),color-mix(in srgb,var(--accent-2) 25%,var(--bg)))}
.ph-4{background:repeating-linear-gradient(135deg,transparent 0 22px,color-mix(in srgb,var(--text) 5%,transparent) 22px 23px),radial-gradient(90% 90% at 80% 20%,color-mix(in srgb,var(--accent) 55%,transparent),transparent 60%),linear-gradient(200deg,color-mix(in srgb,var(--accent-2) 35%,var(--surface-2)),var(--surface-2))}

/* site header */
.site-head{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--bg) 84%,transparent);-webkit-backdrop-filter:saturate(160%) blur(14px);backdrop-filter:saturate(160%) blur(14px);border-bottom:1px solid var(--line)}
.site-head .wrap{display:flex;align-items:center;gap:20px;min-height:72px}
.brand{display:inline-flex;align-items:center;gap:.55em;font-family:var(--font-h);font-weight:var(--hw);font-stretch:var(--h-str,100%);font-size:1.28rem;letter-spacing:var(--ht);text-transform:var(--hc);text-decoration:none;line-height:1.1;min-width:0}
.brand-mark{width:32px;height:32px;flex:none;border-radius:var(--r-sm);background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;font-size:1rem;line-height:1}
.brand-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.site-head .wrap>nav{margin-left:auto}
.nav-list{display:flex;gap:2px;align-items:center}
.nav-list a{display:block;padding:.5em .85em;border-radius:var(--r-btn);color:var(--muted);text-decoration:none;font-weight:500;font-size:.96rem;transition:color .2s,background-color .2s}
.nav-list a:hover,.nav-list a[aria-current="page"]{color:var(--text);background:var(--surface-2)}
.head-cta{margin-left:6px}
.menu{display:none;margin-left:auto;position:static}
.menu summary{list-style:none;cursor:pointer;width:44px;height:44px;display:grid;place-items:center;border-radius:var(--r-sm);border:1px solid var(--line-2)}
.menu summary::-webkit-details-marker{display:none}
.menu summary span,.menu summary span::before,.menu summary span::after{display:block;width:18px;height:1.6px;background:currentColor;position:relative;transition:transform .25s}
.menu summary span::before,.menu summary span::after{content:'';position:absolute}
.menu summary span::before{top:-6px}.menu summary span::after{top:6px}
.menu[open] summary span{background:transparent}
.menu[open] summary span::before{transform:translateY(6px) rotate(45deg)}
.menu[open] summary span::after{transform:translateY(-6px) rotate(-45deg)}
.menu-panel{position:absolute;left:0;right:0;top:100%;background:var(--bg);border-bottom:1px solid var(--line);padding:12px var(--gut) 24px;display:grid;gap:4px;box-shadow:0 24px 40px -24px rgba(0,0,0,.35)}
.menu-panel a:not(.btn){display:block;padding:.8em 0;font-size:1.15rem;font-weight:500;text-decoration:none;border-bottom:1px solid var(--line)}
.menu-panel .btn{margin-top:14px}
@media (max-width:860px){.site-head .wrap>nav,.nav-list,.head-cta{display:none}.menu{display:block}}

/* hero */
.s-hero{padding-block:clamp(48px,7vw,108px)}
.hero-in .h1{margin-top:18px}
.hero-in .lead{margin-top:24px}
.hero-in .eyebrow+.h1{margin-top:18px}
.hero-in>.h1:first-child{margin-top:0}
.hero-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:clamp(36px,6vw,96px);align-items:center}
.hero-art{position:relative}
.hero-blob{position:absolute;z-index:-1;right:-8%;bottom:-8%;width:62%;aspect-ratio:1;border-radius:50%;background:var(--accent-soft)}
.v-centered .hero-in{max-width:920px;margin-inline:auto}
.v-centered .hero-in .note{justify-content:center}
.hero-glow{position:absolute;z-index:-1;left:-10%;right:-10%;top:-30%;height:90%;background:radial-gradient(50% 50% at 50% 40%,color-mix(in srgb,var(--accent) 20%,transparent),transparent 70%);pointer-events:none}
.hero-shot{margin-top:clamp(48px,7vw,88px)}
.hero-shot .media{box-shadow:0 50px 90px -50px rgba(0,0,0,.45);border:1px solid var(--line)}
.v-cover{min-height:min(90vh,880px);display:grid;align-items:end;padding-block:clamp(140px,22vh,240px) clamp(48px,8vw,104px);color:#fff;--text:#fff;--muted:rgba(255,255,255,.88);--accent-text:#fff;--line-2:rgba(255,255,255,.55);--line:rgba(255,255,255,.25)}
.v-cover .hero-in{max-width:940px}
.v-cover .h1{font-size:clamp(2.8rem,1.4rem + 6vw,7.4rem);text-shadow:0 2px 30px rgba(0,0,0,.25)}
.v-cover .lead{color:rgba(255,255,255,.9)}
.cover-media{position:absolute;inset:0;z-index:-2}
.cover-media .media{height:100%;border-radius:0}
.cover-shade{position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(0,0,0,.28) 0%,rgba(0,0,0,.18) 35%,rgba(0,0,0,.78) 100%)}
.v-editorial .h1{margin-top:22px}
.ed-row{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:clamp(24px,5vw,72px);align-items:end;margin-top:clamp(28px,4vw,48px)}
.ed-row .lead{margin:0}
.ed-row .actions{margin-top:0}
.ed-media{margin-top:clamp(40px,6vw,80px)}
.v-banner{padding-block:clamp(64px,9vw,128px) clamp(28px,4vw,56px)}
.v-banner .hero-in{max-width:900px}
.v-banner+.sec:not([class*=" t-"]){padding-top:clamp(28px,4vw,56px)}

/* logos */
.s-logos{padding-block:clamp(36px,5vw,64px)}
.logos-title{text-align:center;color:var(--muted);font-size:.9rem;margin-bottom:22px}
.logos{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:14px clamp(28px,5vw,64px)}
.logos li{font-family:var(--font-h);font-weight:var(--hw);font-size:clamp(1.15rem,1rem + .7vw,1.6rem);letter-spacing:var(--ht);color:var(--muted);white-space:nowrap}
.marquee{overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)}
.marquee-track{display:flex;width:max-content}
.marquee .logos{flex-wrap:nowrap;padding-right:clamp(28px,5vw,64px)}

/* cards and icon badges */
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:clamp(22px,2.6vw,34px)}
.ibadge{display:inline-grid;place-items:center;width:48px;height:48px;border-radius:var(--r);background:var(--accent-soft);color:var(--accent-text);margin-bottom:22px}
.ibadge .ic{width:24px;height:24px}
.fcards,.ficons{display:grid;gap:clamp(14px,2vw,24px);grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr))}
.fcards.n4,.ficons.n4{grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr))}
.fcard .h3,.fic .h3{margin-bottom:10px}
.fic{border-top:1px solid var(--line-2);padding-top:28px}
.fic .ibadge{background:none;width:auto;height:auto;margin-bottom:18px}
.fic .ibadge .ic{width:30px;height:30px}
.frows{display:grid;gap:clamp(48px,7vw,104px)}
.frow{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:clamp(28px,5vw,88px);align-items:center}
.frow:nth-child(even) .media{order:2}
.frow .num{display:block;font-weight:600;color:var(--accent-text);margin-bottom:14px;font-variant-numeric:tabular-nums}
.frow .h3{margin-bottom:14px}
.frow .body-l{color:var(--muted);max-width:34em}
.bento{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.bento-cell{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;grid-column:span 1;min-width:0}
.bento-cell.wide{grid-column:span 2}
.bento-cell.full{grid-column:1/-1}
.bento-cell .media{border-radius:0;flex:1}
.bento-cell:not(.wide):not(.full){padding:clamp(22px,2.6vw,32px);justify-content:space-between}
.bento-cell:not(.wide):not(.full) .bento-copy{margin-top:auto}
.bento-cell.wide .bento-copy,.bento-cell.full .bento-copy{padding:22px clamp(22px,2.6vw,32px) 26px}
.bento-copy .h3{margin-bottom:8px}

/* split layouts */
.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(32px,6vw,104px);align-items:center}
.split-copy .h2{margin-top:16px}
.split-copy .prose,.split-copy .lead{margin-top:22px}
.split-copy .eyebrow+.h2{margin-top:16px}
.split-copy>.h2:first-child{margin-top:0}
.checks{display:grid;gap:12px;margin-top:26px}
.checks li{display:flex;gap:.7em;align-items:flex-start}
.checks .ic{color:var(--accent-text);margin-top:.25em}
.checks.sm{font-size:.95rem;gap:10px;margin-top:6px}
.checks.cols{display:block;columns:2 240px;column-gap:32px}
.checks.cols li{break-inside:avoid;margin-bottom:12px}
.s-about .narrow .h2{margin-top:16px}
.s-about .narrow .prose{margin-top:24px;font-size:1.1rem}
.about-wide{margin-top:clamp(40px,6vw,72px)}

/* gallery */
.gal-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(10px,1.4vw,18px)}
.gal-masonry{columns:3 260px;column-gap:clamp(10px,1.4vw,18px)}
.gal-masonry figure{break-inside:avoid;margin-bottom:clamp(10px,1.4vw,18px)}
figcaption{font-size:.9rem;color:var(--muted);margin-top:.7em}
.strip{display:grid;grid-auto-flow:column;grid-auto-columns:clamp(230px,30vw,400px);gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding:0 var(--gut) 10px;scroll-padding-inline:var(--gut);scrollbar-width:thin;scrollbar-color:var(--line-2) transparent}
.strip figure{scroll-snap-align:start}

/* reviews */
.quotes{display:grid;gap:clamp(14px,2vw,24px);grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))}
.quote{position:relative;display:flex;flex-direction:column;gap:18px}
.qmark{font:400 4.2rem/1 var(--font-h);color:var(--accent-text);height:.45em;margin-top:-.08em}
.quote blockquote{font-size:1.08rem;line-height:1.55}
.quote figcaption{display:flex;gap:12px;align-items:center;margin-top:auto;font-size:.95rem;color:var(--text)}
.quote figcaption b,.quote figcaption small{display:block}
.quote figcaption small{color:var(--muted);font-size:.86rem}
.avatar{width:44px;height:44px;flex:none;border-radius:50%;background:var(--accent-soft);color:var(--accent-text);display:grid;place-items:center;font-weight:700;font-size:.88rem}
.quote.big{align-items:center;text-align:center}
.quote.big blockquote{font-family:var(--font-h);font-weight:var(--hw);font-size:clamp(1.55rem,1.05rem + 2vw,2.7rem);line-height:1.22;letter-spacing:var(--ht);text-wrap:balance}
.quote.big figcaption{margin-top:12px;text-align:left}
.is-ph{border-style:dashed;border-color:var(--line-2)}
.quote.big.is-ph{border:1px dashed var(--line-2);border-radius:var(--r-lg);padding:clamp(28px,4vw,48px)}
.ph-tag{position:absolute;top:14px;right:14px;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:.35em .65em;border-radius:999px;background:var(--surface-2);color:var(--muted);border:1px dashed var(--line-2)}

/* pricing */
.tiers{display:grid;gap:clamp(14px,2vw,22px);grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));align-items:stretch}
.tiers.n2{max-width:820px;margin-inline:auto}
.tier{position:relative;display:flex;flex-direction:column;gap:14px}
.tier .btn{margin-top:auto}
.tier .checks{margin-bottom:10px}
.tier.featured{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),0 30px 60px -36px color-mix(in srgb,var(--accent) 70%,transparent)}
.tier-badge{position:absolute;top:-13px;left:24px;background:var(--accent);color:var(--accent-ink);font-size:.74rem;font-weight:700;letter-spacing:.04em;padding:.4em .85em;border-radius:999px}
.price{display:flex;align-items:baseline;flex-wrap:wrap;gap:.35em}
.amount{font-size:clamp(2.2rem,1.8rem + 1.6vw,3.1rem);line-height:1}
.per{color:var(--muted)}
.plist{border-top:1px solid var(--line)}
.prow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:baseline;padding:24px 0;border-bottom:1px solid var(--line)}
.prow .leader{display:none}
.prow .muted{margin-top:6px}
.prow-price{font-family:var(--font-h);font-weight:var(--hw);font-size:1.5rem;text-align:right}
.prow-price small{display:block;font:400 .85rem var(--font-b);color:var(--muted)}

/* faq */
.faq-wrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.45fr);gap:clamp(32px,6vw,104px);align-items:start}
.faq-wrap .sec-head{position:sticky;top:110px}
.faq{border-top:1px solid var(--line)}
.faq-item{border-bottom:1px solid var(--line)}
.faq-item summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:24px;padding:24px 0;font-weight:600;font-size:clamp(1.04rem,1rem + .25vw,1.18rem)}
.faq-item summary::-webkit-details-marker{display:none}
.pm{position:relative;width:20px;height:20px;flex:none;color:var(--accent-text)}
.pm::before,.pm::after{content:'';position:absolute;left:0;right:0;top:50%;height:1.6px;margin-top:-.8px;background:currentColor;transition:transform .3s}
.pm::after{transform:rotate(90deg)}
.faq-item[open] .pm::after{transform:rotate(0)}
.faq-item .prose{padding:0 40px 26px 0}
.qa-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(28px,4vw,48px) clamp(32px,6vw,88px)}
.qa .h3{margin-bottom:10px}

/* team */
.people{display:grid;gap:clamp(16px,2vw,28px);grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))}
.person .media{margin-bottom:18px}
.role{color:var(--accent-text);font-weight:600;font-size:.92rem;margin:.3em 0 .5em}
.people-list{display:grid;gap:0;border-top:1px solid var(--line)}
.person-row{display:grid;grid-template-columns:88px minmax(0,1fr);gap:24px;align-items:center;padding:22px 0;border-bottom:1px solid var(--line)}
.media.round{border-radius:50%}

/* steps and timeline */
.steps{display:grid;gap:clamp(20px,3vw,36px);grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}
.step{position:relative;padding-top:30px;border-top:1.5px solid var(--line-2)}
.step::before{content:'';position:absolute;top:-1.5px;left:0;width:56px;height:1.5px;background:var(--accent)}
.step-num{font-size:clamp(2.6rem,2rem + 2vw,3.8rem);line-height:1;color:var(--accent-text);margin-bottom:18px}
.step .h3{margin-bottom:8px}
.tl li{display:grid;grid-template-columns:170px minmax(0,1fr);gap:32px}
.tl-date{font-weight:600;color:var(--accent-text);padding-top:.15em}
.tl li>div{position:relative;border-left:1.5px solid var(--line-2);padding:0 0 44px 32px}
.tl li:last-child>div{padding-bottom:0}
.tl li>div::before{content:'';position:absolute;left:-6.5px;top:.42em;width:11px;height:11px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 5px var(--bg)}
.tl .h3{margin-bottom:6px}

/* stats */
.s-stats{padding-block:clamp(48px,7vw,96px)}
.stats{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))}
.v-row .stat{border-left:1px solid var(--line-2);padding-left:24px}
.stat-v{font-size:clamp(2.4rem,1.7rem + 2.8vw,4.4rem);line-height:1.02;overflow-wrap:anywhere}
.stat-v.long{font-size:clamp(1.5rem,1.2rem + 1.2vw,2.3rem);line-height:1.15}
.stat-l{color:var(--muted);margin-top:.55em}

/* call to action */
.s-cta .h2+.lead{margin-top:20px}
.cta-card{position:relative;overflow:hidden;isolation:isolate;border-radius:calc(var(--r-lg) * 1.2);background:var(--accent-soft);padding:clamp(48px,8vw,120px) clamp(24px,5vw,72px)}
.cta-card .lead{color:var(--text)}
.cta-art{position:absolute;inset:auto -12% -55% auto;width:62%;aspect-ratio:1;border-radius:50%;z-index:-1;opacity:.55;filter:blur(2px)}
.cta-in{max-width:760px;margin-inline:auto}

/* forms */
.form{display:grid;gap:16px}
.field{display:grid;gap:7px}
.field label{font-size:.9rem;font-weight:600}
.field input,.field textarea,.sform input{width:100%;background:var(--bg);border:1px solid var(--line-2);border-radius:var(--r-sm);padding:.85em 1em;color:var(--text);transition:border-color .2s,box-shadow .2s}
.field textarea{resize:vertical;min-height:130px}
.field input:focus,.field textarea:focus,.sform input:focus{outline:none;border-color:var(--accent-text);box-shadow:0 0 0 3px var(--accent-soft)}
.form-note{font-size:.86rem;color:var(--muted)}
.form-note:empty{display:none}
.clist{display:grid;gap:14px;margin-top:30px}
.clist li{display:flex;gap:12px;align-items:flex-start}
.clist .ic{color:var(--accent-text);margin-top:.28em}
.clist a{text-decoration:none;border-bottom:1px solid var(--line-2)}
.clist span{white-space:pre-line}
.clist.inline{display:flex;flex-wrap:wrap;justify-content:center;gap:12px 28px;margin-top:28px}
.contact-split{align-items:start}
.s-contact .narrow .form{margin-top:8px}
.sform{display:flex;flex-wrap:wrap;gap:10px;margin-top:30px;max-width:540px}
.center .sform{margin-inline:auto}
.sform input{flex:1 1 220px;min-height:54px;border-radius:var(--r-btn);padding:0 1.25em}
.sform .btn{flex:0 0 auto;min-height:54px}
.signup-card{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:clamp(24px,5vw,64px);align-items:center;padding:clamp(28px,5vw,64px)}
.signup-card .h2{margin-top:14px}
.signup-card .lead{margin-top:16px}
.signup-card .sform{margin-top:0}
.s-signup .narrow .h2{margin-top:16px}
.s-signup .narrow .lead{margin-top:18px}

/* embeds (load on click: nothing third-party until the visitor asks) */
.embed{position:relative;border-radius:var(--r-lg);overflow:hidden;aspect-ratio:16/9;background:var(--surface-2)}
.embed-audio{aspect-ratio:auto;height:352px}
.embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.embed-facade{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;background:none;cursor:pointer;color:inherit}
.embed-facade .ph{position:absolute;inset:0}
.facade-btn{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:.6em;background:var(--bg);color:var(--text);padding:.95em 1.5em;border-radius:999px;font-weight:600;box-shadow:0 14px 40px -12px rgba(0,0,0,.45);white-space:nowrap;transition:transform .25s}
.facade-cap{position:absolute;left:16px;bottom:14px;max-width:calc(100% - 32px);background:var(--bg);color:var(--text);padding:.35em .75em;border-radius:var(--r-sm);font-size:.86rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.embed-facade:hover .facade-btn{transform:translate(-50%,-50%) scale(1.04)}

/* posts and listings */
.posts{display:grid;gap:clamp(20px,3vw,36px);grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr))}
.post a{display:grid;gap:10px;text-decoration:none}
.post .media{margin-bottom:8px}
.date{font-size:.86rem;color:var(--muted)}
.more{display:inline-flex;align-items:center;gap:.4em;color:var(--accent-text);font-weight:600;margin-top:4px}
.more .arr,.post-row .arr,.back .arr{width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .25s}
.post-list{border-top:1px solid var(--line)}
.post-row{display:grid;grid-template-columns:130px minmax(0,1fr) auto;gap:24px;align-items:baseline;padding:26px 0;border-bottom:1px solid var(--line);text-decoration:none}
.post-row .h3{display:block;margin-bottom:6px}
.homes{display:grid;gap:clamp(16px,2.4vw,28px);grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
.home-card a{display:block;height:100%;text-decoration:none;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden}
.home-media{position:relative}
.home-media .media{border-radius:0}
.home-media .pill{position:absolute;top:14px;left:14px}
.home-copy{padding:20px 22px 24px}
.home-price{font-size:1.65rem;line-height:1.1;margin-bottom:6px}
.homes.rows{grid-template-columns:1fr}
.home-card.row a{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr)}
.home-card.row .home-copy{padding:clamp(22px,3vw,40px);align-self:center}
.facts{display:flex;flex-wrap:wrap;gap:18px 34px}
.facts li{display:flex;align-items:center;gap:12px}
.facts .ic{width:1.5em;height:1.5em;color:var(--accent-text)}
.facts b{display:block;font-size:1.15rem;font-weight:600;line-height:1.2}
.facts small{display:block;color:var(--muted);font-size:.8rem}
.facts.sm{gap:6px 18px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
.facts.sm .ic{width:1.15em;height:1.15em}
.facts.sm b,.facts.sm small{display:inline;font-size:.92rem}
.facts.sm small{margin-left:.3em}
.mosaic{display:grid;grid-template-columns:2fr 1fr 1fr;grid-template-rows:repeat(2,clamp(150px,21vw,300px));gap:10px;border-radius:var(--r-lg);overflow:hidden}
.mosaic .media{border-radius:0;height:100%}
.mosaic .media:first-child{grid-row:span 2}
.mosaic.n4 .media:nth-child(4){grid-column:span 2}
.mosaic.n3,.mosaic.n2{grid-template-columns:2fr 1fr}
.mosaic.n2 .media:nth-child(2){grid-row:span 2}
.mosaic.n1{grid-template-columns:1fr}
.listing-body{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:clamp(32px,5vw,80px);margin-top:clamp(32px,5vw,56px);align-items:start}
.listing-main .facts{padding-bottom:30px;margin-bottom:30px;border-bottom:1px solid var(--line)}
.listing-main .h3{margin:36px 0 16px}
.listing-aside{position:sticky;top:96px;display:grid;gap:12px}
.listing-aside .pill{margin-bottom:4px}
.listing-price{font-size:clamp(2rem,1.6rem + 1.6vw,2.9rem);line-height:1}
.listing-aside .muted{margin-bottom:8px}
.listing-hero{margin-bottom:8px}
.listing-more{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px;margin-top:clamp(32px,5vw,56px)}

/* music */
.tracks-split{grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);align-items:center}
.cover-art{box-shadow:0 40px 80px -40px rgba(0,0,0,.55)}
.tracks-cover .media{max-width:420px;margin:0 auto 36px}
.tracks{border-top:1px solid var(--line);text-align:left}
.track{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr) auto auto;gap:16px;align-items:center;padding:14px 6px;border-bottom:1px solid var(--line)}
.tplay{width:40px;height:40px;border-radius:50%;border:0;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;cursor:pointer;padding:0}
.tplay .ic{width:15px;height:15px;fill:currentColor;stroke:none}
.tplay .i-pause,.tplay[aria-pressed="true"] .i-play{display:none}
.tplay[aria-pressed="true"] .i-pause{display:block}
.tnum{color:var(--muted);font-variant-numeric:tabular-nums;text-align:center;font-size:.92rem}
.tmeta b{display:block;font-weight:600}
.tmeta small{display:block;font-size:.86rem}
.tlen{color:var(--muted);font-variant-numeric:tabular-nums;font-size:.92rem}
.tlink{font-size:.88rem;font-weight:600;color:var(--accent-text)}
.tbar{position:absolute;left:0;right:0;bottom:-1px;height:2px;pointer-events:none}
.tbar i{display:block;height:100%;width:0;background:var(--accent)}

/* schedule */
.day-h{font-size:clamp(1.3rem,1.1rem + .8vw,1.7rem);margin:40px 0 6px}
.day-h:first-child{margin-top:0}
.slots{border-top:1px solid var(--line)}
.slot{display:grid;grid-template-columns:130px minmax(0,1fr) auto;gap:24px;align-items:baseline;padding:22px 0;border-bottom:1px solid var(--line)}
.slot-time{font-weight:600;color:var(--accent-text);font-variant-numeric:tabular-nums}
.slot .muted{margin-top:4px}
.days{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
.day .day-h{margin:0 0 10px}
.day .slots{border-top:0}
.day .slot{grid-template-columns:76px minmax(0,1fr);gap:16px;padding:16px 0}
.day .slot .btn{grid-column:2;justify-self:start}
.day .slot:last-child{border-bottom:0}

/* menu */
.menu.columns{columns:2 330px;column-gap:clamp(32px,6vw,104px)}
.mcat{break-inside:avoid;margin-bottom:clamp(36px,5vw,56px)}
.mcat-h{font-size:clamp(1.35rem,1.15rem + .8vw,1.8rem);padding-bottom:14px;margin-bottom:20px;border-bottom:1px solid var(--line-2)}
.menu.list .mcat-h{text-align:center;border-bottom:0;padding-bottom:0}
.mcat ul{display:grid;gap:20px}
.dish-top{display:flex;align-items:baseline;gap:12px}
.dish-top b{font-weight:600;font-size:1.06rem}
.leader{flex:1;min-width:24px;border-bottom:1px dotted var(--line-2);transform:translateY(-.3em)}
.dish-price{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.dish .muted{margin-top:4px;font-size:.96rem;max-width:42ch}

/* footer */
.s-footer{padding-block:clamp(56px,7vw,96px) 30px}
.f-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr);gap:40px}
.f-brand{font-size:clamp(1.6rem,1.2rem + 1.5vw,2.5rem);line-height:1.05;margin-bottom:.45em}
.f-about .muted{max-width:34ch}
.f-h{font-size:.76rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
.f-links{display:flex;flex-wrap:wrap;gap:10px 26px}
.f-links.col{flex-direction:column;gap:10px}
.f-links a{text-decoration:none}
.f-links a:hover,.f-contact a:hover{text-decoration:underline;text-underline-offset:4px}
.f-contact{display:grid;gap:6px;margin-top:22px;color:var(--muted)}
.f-contact a{text-decoration:none}
.f-bottom{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;margin-top:clamp(40px,6vw,72px);padding-top:24px;border-top:1px solid var(--line);font-size:.88rem;color:var(--muted)}
.credit{margin-left:.4em}
.credit a{color:inherit;text-underline-offset:3px}
.f-simple .f-brand{margin-bottom:.3em}
.f-simple nav{margin-top:28px}
.f-simple .f-links{justify-content:center}
.f-simple .f-bottom{justify-content:center}

/* article pages */
.s-article{padding-block:clamp(48px,7vw,96px)}
.back{display:inline-flex;align-items:center;gap:.5em;color:var(--muted);text-decoration:none;margin-bottom:36px;font-weight:500}
.back .arr{transform:rotate(180deg)}
.s-article .h1{margin-top:14px}
.s-article .lead{margin-top:18px}
.article-media{margin:clamp(32px,5vw,56px) 0}
.article-body{font-size:1.14rem;line-height:1.72}
.s-article>.wrap>.pill{margin-bottom:10px}

/* responsive */
@media (max-width:900px){
  .hero-grid,.split,.frow,.listing-body,.signup-card,.faq-wrap,.tracks-split,.ed-row{grid-template-columns:minmax(0,1fr)}
  .frow:nth-child(even) .media{order:0}
  .hero-art{max-width:560px}
  .faq-wrap .sec-head{position:static}
  .listing-aside{position:static}
  .bento{grid-template-columns:repeat(2,minmax(0,1fr))}
  .bento-cell.wide,.bento-cell.full{grid-column:1/-1}
  .f-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  .f-about{grid-column:1/-1}
  .gal-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .home-card.row a{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:620px){
  body{font-size:1rem}
  .qa-grid,.bento,.gal-grid{grid-template-columns:minmax(0,1fr)}
  .tl li{grid-template-columns:minmax(0,1fr);gap:6px}
  .tl li>div{padding-bottom:32px}
  .slot,.post-row{grid-template-columns:minmax(0,1fr);gap:6px}
  .slot .btn{justify-self:start;margin-top:8px}
  .post-row .arr{display:none}
  .mosaic{grid-template-columns:1fr 1fr;grid-template-rows:none}
  .mosaic .media{aspect-ratio:1/1}
  .mosaic .media:first-child{grid-column:1/-1;grid-row:auto;aspect-ratio:4/3}
  .mosaic.n4 .media:nth-child(4){grid-column:auto}
  .track{grid-template-columns:40px minmax(0,1fr) auto;gap:12px}
  .track .tlink{display:none}
  .faq-item .prose{padding-right:0}
  .v-row .stat{border-left:0;border-top:1px solid var(--line-2);padding:18px 0 0}
  .person-row{grid-template-columns:64px minmax(0,1fr);gap:16px}
  .actions .btn{flex:1 1 auto}
  .f-grid{grid-template-columns:minmax(0,1fr)}
  .site-head .wrap{min-height:64px}
}

/* generated placeholder art (art.js): colours follow the section's tone */
.art{position:absolute;inset:0;width:100%;height:100%;display:block}
.art .k-bg{fill:var(--c-bg)}
.art .k-a{fill:var(--c-a)}.art .k-a2{fill:color-mix(in srgb,var(--c-a) 58%,var(--c-bg))}.art .k-a3{fill:color-mix(in srgb,var(--c-a) 26%,var(--c-bg))}
.art .k-b{fill:var(--c-b)}.art .k-b2{fill:color-mix(in srgb,var(--c-b) 62%,var(--c-paper))}.art .k-b3{fill:color-mix(in srgb,var(--c-b) 30%,var(--c-bg))}
.art .k-ink{fill:var(--c-ink)}.art .k-ink2{fill:color-mix(in srgb,var(--c-ink) 11%,var(--c-bg))}.art .k-ink3{fill:color-mix(in srgb,var(--c-ink) 6%,var(--c-bg))}
.art .k-paper{fill:var(--c-paper)}.art .o5{opacity:.45}
.art .k-sh{fill:color-mix(in srgb,var(--c-ink) 18%,transparent)}
.art .k-ring{fill:none;stroke:color-mix(in srgb,var(--c-ink) 16%,transparent);stroke-width:1.2}
.art .k-groove{fill:none;stroke:color-mix(in srgb,var(--c-paper) 16%,transparent);stroke-width:1}
.art .k-beam{fill:color-mix(in srgb,var(--c-paper) 9%,transparent)}
.art .k-cloth{fill:color-mix(in srgb,var(--c-ink) 84%,var(--c-a))}
.art .k-coat{fill:var(--coat)}.art .k-pants{fill:var(--pants)}.art .k-shoe{fill:#161514}.art .k-skin{fill:var(--sk)}.art .k-fold{fill:none;stroke:rgba(0,0,0,.2);stroke-width:1.4}
.art .hair{fill:color-mix(in srgb,var(--c-ink) 70%,#2a1c14)}
.s-a{stop-color:var(--c-a)}.s-a2{stop-color:color-mix(in srgb,var(--c-a) 50%,var(--c-paper))}.s-a-d{stop-color:color-mix(in srgb,var(--c-a) 68%,#000)}
.s-b{stop-color:var(--c-b)}.s-b2{stop-color:color-mix(in srgb,var(--c-b) 60%,var(--c-paper))}.s-b3{stop-color:color-mix(in srgb,var(--c-b) 30%,var(--c-bg))}.s-b-d{stop-color:color-mix(in srgb,var(--c-b) 66%,#000)}.s-b0{stop-color:var(--c-b);stop-opacity:0}
.s-paper{stop-color:var(--c-paper)}.s-bg{stop-color:var(--c-bg)}.s-ink{stop-color:var(--c-ink)}.s-ink2{stop-color:color-mix(in srgb,var(--c-ink) 12%,var(--c-bg))}
.s-sk{stop-color:var(--sk)}.s-sk-l{stop-color:color-mix(in srgb,var(--sk) 72%,#fff)}.s-sk-d{stop-color:color-mix(in srgb,var(--sk) 74%,#000)}
.s-shd{stop-color:color-mix(in srgb,var(--c-ink) 26%,transparent)}.s-sh0{stop-color:color-mix(in srgb,var(--c-ink) 0%,transparent)}
.s-coat{stop-color:var(--coat)}.s-coat-d{stop-color:color-mix(in srgb,var(--coat) 72%,#000)}.s-coat-l{stop-color:color-mix(in srgb,var(--coat) 86%,#fff)}
.s-pants{stop-color:var(--pants)}.s-pants-d{stop-color:color-mix(in srgb,var(--pants) 78%,#000)}
.s-top{stop-color:var(--top)}.s-top-l{stop-color:color-mix(in srgb,var(--top) 84%,#fff)}.s-top-d{stop-color:color-mix(in srgb,var(--top) 70%,#000)}
.art .k-a-d{fill:color-mix(in srgb,var(--c-a) 62%,#000)}
.art .k-hair{fill:var(--hair)}.art .k-sleeve{fill:color-mix(in srgb,var(--coat) 80%,#000)}.art .k-inner{fill:color-mix(in srgb,var(--pants) 60%,#fff)}
.art .k-lapel{fill:none;stroke:rgba(0,0,0,.22);stroke-width:1.1}.art .k-crease{fill:none;stroke:rgba(255,255,255,.12);stroke-width:1}.art .k-belt{fill:color-mix(in srgb,var(--coat) 70%,#000)}
.art .k-frame{fill:none;stroke:var(--c-paper);stroke-width:6}
.art .k-road{fill:none;stroke:var(--c-paper);stroke-width:5}.art .k-route{fill:none;stroke:var(--c-a);stroke-width:4;stroke-linecap:round}
.art .k-tick{stroke:color-mix(in srgb,var(--c-paper) 30%,transparent);stroke-width:2}.art .k-tick-on{stroke:var(--c-paper);stroke-width:2.4}
.ph,.motif,.amb{--c-bg:var(--surface-2);--c-a:var(--accent);--c-b:var(--accent-2);--c-ink:var(--text);--c-paper:var(--bg)}
.ph:has(.art)::after{opacity:.16}

/* statement */
.stmt{display:grid;gap:24px;justify-items:start}
.stmt.center{justify-items:center}
.stmt-t{font-size:clamp(1.9rem,1.05rem + 3.3vw,4.5rem);line-height:1.07;text-wrap:balance;max-width:21ch}
.stmt.center .stmt-t{margin-inline:auto}
.v-left .stmt-t{max-width:26ch}
.stmt-t em,.ch-t em{font-style:var(--h-ital);color:var(--accent-text)}
.stmt-note{color:var(--muted);font-size:.95rem}
.stmt-frame{display:grid;grid-template-columns:auto minmax(0,1fr);border:1px solid var(--line-2);border-radius:var(--r-lg);overflow:hidden;background:var(--surface)}
.stmt-mark{display:grid;place-items:center;min-width:1.6em;padding:clamp(18px,3vw,40px) clamp(18px,3vw,44px);border-right:1px solid var(--line-2);font-size:clamp(3.6rem,1.6rem + 7vw,9rem);line-height:.9;letter-spacing:-.04em;color:transparent;-webkit-text-stroke:1.2px var(--text);font-variant-numeric:tabular-nums}
.stmt-body{display:grid;gap:18px;align-content:center;padding:clamp(24px,4vw,56px)}
.stmt-q{font-size:clamp(1.35rem,1rem + 1.3vw,2.2rem);line-height:1.28;text-wrap:balance;text-transform:none}
.stmt-frame figcaption{color:var(--muted)}
.stmt-frame figcaption span::before{content:'— '}

/* lookbook */
.lb-full{display:grid;gap:clamp(6px,.8vw,12px)}
.lb-full .lb-item{position:relative}
.lb-full .media{border-radius:0;aspect-ratio:auto!important;height:min(100svh,64vw);min-height:440px}
.lb-cap{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;margin-top:12px;font-size:.74rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.lb-full .lb-cap{position:absolute;left:clamp(10px,1.6vw,22px);bottom:clamp(10px,1.6vw,22px);margin:0;background:var(--surface);color:var(--text);padding:.85em 1.1em;border-radius:var(--r-sm);max-width:calc(100% - 24px);box-shadow:0 10px 30px -18px rgba(0,0,0,.4)}
.lb-n,.lb-note{color:var(--muted);font-variant-numeric:tabular-nums}
.lb-pair{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:clamp(40px,6vw,96px) clamp(12px,2vw,28px);align-items:end}
.lb-pair .lb-item:nth-child(4n+1){grid-column:1/8}
.lb-pair .lb-item:nth-child(4n+2){grid-column:9/13;align-self:start}
.lb-pair .lb-item:nth-child(4n+3){grid-column:2/6;align-self:start}
.lb-pair .lb-item:nth-child(4n+4){grid-column:7/13}
.lb-offset{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(12px,2vw,28px)}
.lb-offset .lb-item:nth-child(3n+2){margin-top:clamp(48px,9vw,160px)}
.lb-offset .lb-item:nth-child(3n+3){margin-top:clamp(24px,4.5vw,80px)}

/* products */
.prod-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:clamp(28px,4vw,52px)}
.prod-head .sec-head{margin-bottom:0}
.prod-count{display:flex;gap:28px;align-items:baseline;font-size:.74rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.prod-count b{color:var(--text);font-weight:700;font-variant-numeric:tabular-nums}
.prods{display:grid;gap:clamp(22px,2.6vw,36px) clamp(10px,1.2vw,16px);grid-template-columns:repeat(4,minmax(0,1fr))}
.prods.n3{grid-template-columns:repeat(3,minmax(0,1fr))}.prods.n2{grid-template-columns:repeat(2,minmax(0,1fr))}.prods.n1{grid-template-columns:minmax(0,380px)}
.prod-a{display:block;text-decoration:none;color:inherit}
.prod-media{border-radius:var(--r)}
.prod-meta{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 12px;margin-top:14px;align-items:baseline}
.prod-name{font:600 .92rem/1.3 var(--font-b);letter-spacing:0;text-transform:none}
.prod-price{font-size:.92rem;font-variant-numeric:tabular-nums;text-align:right}
.prod-note{grid-column:1/-1;color:var(--muted);font-size:.86rem}
.prods.lineup{display:flex;gap:clamp(8px,1.4vw,22px);overflow-x:auto;scroll-snap-type:x mandatory;padding:0 0 14px;justify-content:safe center;scrollbar-width:thin;scrollbar-color:var(--line-2) transparent}
.prods.lineup .prod{flex:0 0 clamp(112px,10.5vw,168px);scroll-snap-align:start}
.prods.lineup .prod-media{background:none;border-radius:0}
.prods.lineup .art .bgr{fill:var(--bg)}
.prods.lineup .ph{background:none}.prods.lineup .ph::after,.prods.lineup .art .vig{display:none}
.prods.lineup .prod-meta{grid-template-columns:1fr;text-align:center;gap:0}
.prods.lineup .prod-price{text-align:center;color:var(--muted)}
.prods.lineup .prod-note{display:none}

/* chapters (long read) */
.chs{display:grid;gap:clamp(96px,13vw,200px)}
.ch-art{width:min(440px,92%);margin:0 auto clamp(28px,4vw,52px);color:var(--text)}
.motif{display:block;width:100%;height:auto;overflow:visible}
.motif *{fill:none;stroke:currentColor;stroke-width:1.1;vector-effect:non-scaling-stroke;stroke-linecap:round}
.motif .fill{fill:currentColor}
.motif .sun{stroke:none}
.motif .ray{stroke:color-mix(in srgb,currentColor 55%,transparent)}
.ch-t{font-size:clamp(1.9rem,1.15rem + 2.8vw,3.8rem);line-height:1.07;text-wrap:balance}
.ch-p{margin-top:22px;color:var(--muted);font-size:clamp(1rem,.96rem + .2vw,1.14rem)}
.chs.stack .ch-p{margin-inline:auto;max-width:44ch}
.chs.split .ch{display:grid;grid-template-columns:minmax(72px,.28fr) minmax(0,1fr);gap:clamp(24px,5vw,80px)}
.chs.split .ch-art{margin:0 0 30px;width:min(360px,100%)}
.ch-n{position:sticky;top:110px;align-self:start;font-size:clamp(3rem,2rem + 4vw,6.4rem);line-height:.9;color:transparent;-webkit-text-stroke:1.2px var(--line-2)}

/* case studies */
.rail-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px}
.rail-head .sec-head{margin-bottom:0}
.rail-year{font-size:clamp(3rem,1.8rem + 5vw,7.6rem);line-height:.86;letter-spacing:-.045em;font-variant-numeric:tabular-nums;color:var(--text);text-transform:none}
.rail-track{display:flex;gap:clamp(32px,5vw,104px);overflow-x:auto;scroll-snap-type:x mandatory;padding:clamp(32px,5vw,64px) var(--gut) 18px;scroll-padding-inline:var(--gut);align-items:flex-start;scrollbar-width:thin;scrollbar-color:var(--line-2) transparent;list-style:none;margin:0}
.case{flex:0 0 clamp(270px,44vw,640px);scroll-snap-align:start}
.case:nth-child(3n+2){flex-basis:clamp(220px,27vw,400px)}
.case-media{border-radius:var(--r)}
.case-meta{margin-top:22px;max-width:44ch}
.case-t{font:600 1.08rem/1.3 var(--font-b);letter-spacing:0;text-transform:none}
.case-sub{display:flex;flex-wrap:wrap;gap:2px 0;color:var(--muted);margin-top:4px}
.case-sub>*+*::before{content:'·';margin:0 .55em;color:var(--line-2)}
.case-p{margin-top:12px;color:var(--muted)}
.case-credits{display:flex;flex-wrap:wrap;gap:2px 14px;margin-top:14px;font-size:.86rem;color:var(--muted)}
.mlink{display:inline-flex;align-items:center;gap:.4em;margin-top:14px;color:var(--accent-text);text-decoration:none;font-weight:500}
.mlink:hover{text-decoration:underline;text-underline-offset:4px}
.rail.on .rail-in{position:sticky;top:0;height:100svh;overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding-top:40px}
.rail.on .rail-track{overflow:visible;scroll-snap-type:none;width:max-content;will-change:transform}
.s-cases:has(.rail.on){padding-block:0}
.case-list{display:grid;gap:clamp(64px,9vw,140px)}
.case-row{display:grid;grid-template-columns:minmax(0,.3fr) minmax(0,1fr);gap:clamp(24px,5vw,80px);align-items:start}
.case-year{position:sticky;top:110px;font-size:clamp(2.6rem,1.5rem + 4.4vw,6.4rem);line-height:.9;letter-spacing:-.045em;font-variant-numeric:tabular-nums}
.case-main .case-meta{max-width:62ch}

/* annotated image */
.s-annotated{padding-bottom:0}
.ann-head{display:grid;justify-items:center;gap:18px}
.ann-head .sec-head{margin-bottom:clamp(28px,4vw,48px)}
.ann-stage .ann-status{position:absolute;z-index:2;left:50%;top:clamp(14px,2.4vw,26px);transform:translateX(-50%);white-space:nowrap}
.ann-status{display:inline-flex;align-items:center;gap:.6em;padding:.55em 1.05em .55em .8em;border-radius:999px;background:var(--surface);border:1px solid var(--line);font-size:.86rem;font-weight:500;box-shadow:0 8px 24px -14px rgba(0,0,0,.3)}
.spin{width:12px;height:12px;flex:none;border-radius:50%;border:1.6px solid var(--line-2);border-top-color:var(--text)}
.ann-stage{position:relative;width:min(620px,84vw);margin:0 auto}
.ann.wide .ann-stage{width:min(1000px,90vw)}
.ann-media{border-radius:var(--r-lg) var(--r-lg) 0 0}
.ann-tags{position:absolute;inset:0;pointer-events:none;list-style:none;margin:0;padding:0}
.tag{position:absolute;pointer-events:auto;display:inline-flex;align-items:center;gap:.5em;white-space:nowrap;font-size:.84rem;font-weight:500;padding:.5em .95em .5em .55em;border-radius:999px;background:var(--surface);color:var(--text);border:1px solid var(--line);box-shadow:0 10px 26px -14px rgba(0,0,0,.4)}
.tag .ic{width:1.25em;height:1.25em;padding:3px;border-radius:50%;background:var(--accent);color:var(--accent-ink);stroke-width:2.6}
.tag::before{content:'';position:absolute;top:50%;height:1px;width:clamp(36px,7vw,110px);background:var(--line-2)}
.tg0,.tg2,.tg4{left:calc(100% + clamp(36px,7vw,110px))}.tg0::before,.tg2::before,.tg4::before{right:100%}
.tg1,.tg3,.tg5{right:calc(100% + clamp(36px,7vw,110px))}.tg1::before,.tg3::before,.tg5::before{left:100%}
.tg0{top:30%}.tg1{top:22%}.tg2{top:52%}.tg3{top:60%}.tg4{top:76%}.tg5{top:84%}
.ann.on .ann-in{position:sticky;top:0;height:100svh;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}
.ann.on{height:210svh}
.ann.on .ann-stage{width:min(620px,(100svh - 300px) * .8)}
.s-annotated:has(.ann.on){padding-top:0}

/* hero: portrait, ambient, runway, name card */
.v-portrait{padding-bottom:0}
.v-portrait .hero-in{max-width:900px;margin-inline:auto}
.portrait-stage{width:min(660px,88vw);margin:clamp(40px,6vw,72px) auto 0}
.portrait-media{border-radius:var(--r-lg) var(--r-lg) 0 0;background:none}
@media (min-width:900px){.portrait-stage{margin-top:clamp(28px,3vw,44px)}.v-portrait .portrait-media{aspect-ratio:1/1!important}}
.v-ambient{min-height:min(100svh,1100px);display:grid;align-items:center;padding-block:clamp(120px,18vh,200px)}
.v-ambient .hero-in{max-width:1080px}
.v-ambient .h1{font-size:clamp(2.6rem,1.1rem + 5.6vw,7.2rem)}
.v-ambient .lead{margin-inline:auto}
.v-ambient .actions{justify-content:center}
.gen{position:absolute;inset:0;z-index:-1;overflow:hidden;color:var(--text);pointer-events:none}
.gen svg,.gen canvas{position:absolute;inset:0;width:100%;height:100%}
.amb path{fill:none;stroke:color-mix(in srgb,var(--text) 30%,transparent);stroke-width:1;vector-effect:non-scaling-stroke}
.gen canvas{opacity:0;transition:opacity 1.4s}
.gen.live canvas{opacity:1}
.gen.live .amb path{opacity:0;transition:opacity 1.4s}
.scroll-cue{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);display:grid;justify-items:center;gap:10px;font-size:.68rem;letter-spacing:.24em;text-transform:uppercase;color:var(--muted)}
.scroll-cue span{width:1px;height:44px;background:linear-gradient(var(--text),transparent)}
.v-runway{padding:0}
.runway{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);min-height:min(100svh,1040px)}
.runway-copy{display:flex;flex-direction:column;justify-content:flex-end;padding:clamp(110px,16vh,180px) var(--gut) clamp(32px,5vw,64px)}
.runway-copy .lead{margin-top:18px}
.runway-media .media{height:100%;border-radius:0;aspect-ratio:auto!important;min-height:520px}
.runway-t{font-size:clamp(2.4rem,.9rem + 4.6vw,6.2rem);line-height:.92;margin-top:16px}
.chip-note{display:inline-flex;align-self:flex-start;margin-top:28px;padding:.75em 1em;background:var(--surface);border-radius:var(--r-sm);font-size:.72rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.v-minimal{padding-block:clamp(80px,13vw,180px) clamp(24px,4vw,56px)}
.min-grid{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:32px;align-items:start}
.min-t{font-size:clamp(2.2rem,1.3rem + 3.2vw,4.4rem);line-height:1.06}
.min-sub{font-family:var(--font-h);font-size:clamp(1.25rem,.95rem + 1.3vw,2.2rem);line-height:1.18;color:var(--muted);margin-top:.2em;max-width:26ch;text-wrap:balance}
.min-side{display:grid;gap:12px;justify-items:end;text-align:right}
.min-links{display:grid;gap:2px;justify-items:end}
.min-links .mlink{margin:0;font-size:clamp(1.05rem,.95rem + .4vw,1.3rem);font-weight:400;color:var(--muted)}
.min-links .mlink:hover{color:var(--text);text-decoration:none}

@media (max-width:900px){
  .runway{grid-template-columns:minmax(0,1fr)}
  .runway-copy{padding-top:clamp(96px,22vw,140px)}
  .runway-media .media{min-height:0;aspect-ratio:4/5!important;height:auto}
  .prods{grid-template-columns:repeat(2,minmax(0,1fr))}
  .prods.n1{grid-template-columns:minmax(0,1fr)}
  .lb-pair,.lb-offset{grid-template-columns:minmax(0,1fr)}
  .lb-pair .lb-item:nth-child(n){grid-column:1/-1}
  .lb-offset .lb-item:nth-child(n){margin-top:0}
  .lb-full .media{height:auto;min-height:0;aspect-ratio:4/5!important}
  .case-row,.chs.split .ch{grid-template-columns:minmax(0,1fr);gap:14px}
  .case-year,.ch-n{position:static}
  .tag{font-size:.74rem;padding:.4em .7em .4em .45em}
  .tag::before{display:none}
  .tg0,.tg2,.tg4{left:auto;right:10px}.tg1,.tg3,.tg5{right:auto;left:10px}
  .prod-head{flex-wrap:wrap}
  .rail-head{align-items:flex-end}
  .rail-year{font-size:clamp(2.2rem,1.4rem + 4vw,3.4rem)}
  .case,.case:nth-child(3n+2){flex-basis:min(78vw,520px)}
}
@media (max-width:620px){
  .stmt-frame{grid-template-columns:minmax(0,1fr)}
  .stmt-mark{border-right:0;border-bottom:1px solid var(--line-2);justify-content:start}
  .min-grid{grid-template-columns:minmax(0,1fr)}
  .min-side{justify-items:start;text-align:left}
  .min-links{justify-items:start}
  .v-ambient .h1{font-size:clamp(2.3rem,1rem + 8vw,3.4rem)}
}

/* ---------- style flavours ---------- */
[data-style="editorial"] .eyebrow{display:flex;align-items:center;gap:.9em}
[data-style="editorial"] .eyebrow::before{content:'';width:28px;height:1px;background:currentColor;flex:none}
[data-style="editorial"] .center>.eyebrow,[data-style="editorial"] .sec-head.center .eyebrow{justify-content:center}
[data-style="editorial"] .sec.s-hero+.sec:not([class*=" t-"]),[data-style="editorial"] .sec:not([class*=" t-"])+.sec:not([class*=" t-"]):not(.s-footer){border-top:1px solid var(--line)}
[data-style="editorial"] .ibadge{border-radius:50%}
[data-style="swiss"] .eyebrow{display:flex;align-items:center;gap:.7em;color:var(--muted);letter-spacing:.1em}
[data-style="swiss"] .eyebrow::before{content:'';width:8px;height:8px;border-radius:2px;background:var(--accent);flex:none}
[data-style="swiss"] .center>.eyebrow,[data-style="swiss"] .sec-head.center .eyebrow,[data-style="swiss"] .v-centered .eyebrow{justify-content:center}
[data-style="swiss"] .hero-glow{background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(55% 60% at 50% 45%,#000,transparent);mask-image:radial-gradient(55% 60% at 50% 45%,#000,transparent);top:0;height:100%}
[data-style="swiss"] .card,[data-style="swiss"] .bento-cell{box-shadow:none}
[data-style="friendly"] .eyebrow{display:inline-flex;width:max-content;max-width:100%;background:var(--accent-soft);padding:.55em 1.05em;border-radius:999px;letter-spacing:.04em;text-transform:none;font-size:.88rem}
[data-style="friendly"] .card,[data-style="friendly"] .bento-cell,[data-style="friendly"] .home-card a{border-color:transparent;box-shadow:0 1px 2px rgba(0,0,0,.04),0 14px 36px -18px rgba(0,0,0,.2)}
[data-style="friendly"] .ibadge{border-radius:50%}
[data-style="friendly"] .hero-blob{border-radius:42% 58% 63% 37%/45% 41% 59% 55%}
[data-style="luxe"] .eyebrow{letter-spacing:.32em;font-size:.72rem;font-weight:500}
[data-style="luxe"] .btn{text-transform:uppercase;letter-spacing:.16em;font-size:.8rem;font-weight:600}
[data-style="luxe"] .card,[data-style="luxe"] .bento-cell{background:transparent;border-color:var(--line-2)}
[data-style="luxe"] .h1,[data-style="luxe"] .h2{font-weight:var(--hw)}
[data-style="luxe"] .sec-head.center .eyebrow,[data-style="luxe"] .center>.eyebrow{display:flex;align-items:center;gap:1em;justify-content:center}
[data-style="luxe"] .sec-head.center .eyebrow::before,[data-style="luxe"] .sec-head.center .eyebrow::after,[data-style="luxe"] .center>.eyebrow::before,[data-style="luxe"] .center>.eyebrow::after{content:'';width:32px;height:1px;background:currentColor}
[data-style="luxe"] .ibadge{background:none;border:1px solid var(--line-2);border-radius:50%}
[data-style="bold"] .card,[data-style="bold"] .bento-cell,[data-style="bold"] .home-card a,[data-style="bold"] .media:not(.round),[data-style="bold"] .embed,[data-style="bold"] .cta-card{border:2px solid var(--text);box-shadow:6px 6px 0 var(--text)}
[data-style="bold"] .cover-media .media,[data-style="bold"] .bento-cell .media,[data-style="bold"] .home-media .media,[data-style="bold"] .mosaic .media{border:0;box-shadow:none}
[data-style="bold"] .btn{border:2px solid var(--text);box-shadow:4px 4px 0 var(--text);text-transform:uppercase;font-weight:800;letter-spacing:.02em}
[data-style="bold"] .v-cover .btn{border-color:#fff;box-shadow:4px 4px 0 #000}
[data-style="bold"] .eyebrow{display:inline-block;width:max-content;max-width:100%;background:var(--text);color:var(--bg);padding:.45em .7em;letter-spacing:.1em}
[data-style="bold"] .v-cover .eyebrow{background:#fff;color:#111}
[data-style="bold"] .h1 em,[data-style="bold"] .h2 em{font-style:normal;background:var(--accent);color:var(--accent-ink);padding:0 .1em;-webkit-box-decoration-break:clone;box-decoration-break:clone}
[data-style="bold"] .t-acc .h2 em{background:var(--text);color:var(--bg)}
[data-style="bold"] .h1-xl{font-size:clamp(2.3rem,.5rem + 8vw,8.6rem)}
[data-style="bold"] .ibadge{border:2px solid var(--text);background:var(--accent);color:var(--accent-ink);border-radius:0}
[data-style="bold"] .tier.featured{box-shadow:6px 6px 0 var(--accent)}
[data-style="aurora"] body{background:radial-gradient(1100px 700px at 85% -12%,color-mix(in srgb,var(--accent) 24%,transparent),transparent 62%),radial-gradient(900px 600px at -12% 8%,color-mix(in srgb,var(--accent-2) 14%,transparent),transparent 62%),var(--bg) no-repeat}
[data-style="aurora"] .card,[data-style="aurora"] .bento-cell{background:color-mix(in srgb,var(--surface) 72%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-color:color-mix(in srgb,var(--text) 12%,transparent)}
[data-style="aurora"][data-mode="dark"] .h1 em,[data-style="aurora"][data-mode="dark"] .h2 em{font-style:normal;background:linear-gradient(92deg,var(--accent-text),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
[data-style="aurora"] .btn:not(.alt){box-shadow:0 10px 34px -10px color-mix(in srgb,var(--accent) 85%,transparent)}
[data-style="aurora"] .hero-glow{background:radial-gradient(45% 45% at 40% 40%,color-mix(in srgb,var(--accent) 34%,transparent),transparent 70%),radial-gradient(40% 40% at 65% 55%,color-mix(in srgb,var(--accent-2) 22%,transparent),transparent 70%)}
[data-style="aurora"] .eyebrow{display:inline-flex;width:max-content;max-width:100%;padding:.5em 1em;border-radius:999px;border:1px solid var(--line-2);background:color-mix(in srgb,var(--surface) 60%,transparent);letter-spacing:.08em}
[data-style="studio"] .eyebrow{text-transform:none;letter-spacing:0;font-size:1rem;font-weight:500;color:var(--muted)}
[data-style="studio"] .card,[data-style="studio"] .bento-cell{border-color:transparent}
[data-style="studio"] .h1,[data-style="studio"] .h2{line-height:1}

/* Atelier (editorial-shop): tiny uppercase chrome in floating chips, wide caps, square corners, product first */
[data-style="editorial-shop"] body{font-size:.96rem}
[data-style="editorial-shop"] .site-head{position:fixed;left:0;right:0;top:0;background:none;border:0;-webkit-backdrop-filter:none;backdrop-filter:none;pointer-events:none}
[data-style="editorial-shop"] .site-head .wrap{pointer-events:auto;width:auto;max-width:calc(100% - 28px);margin:14px;display:inline-flex;gap:18px;min-height:0;padding:10px 12px 10px 16px;background:var(--surface);border-radius:2px;box-shadow:0 1px 0 color-mix(in srgb,var(--text) 6%,transparent)}
[data-style="editorial-shop"] .brand{font-size:1rem;letter-spacing:.01em}
[data-style="editorial-shop"] .brand-mark{display:none}
[data-style="editorial-shop"] .nav-list{counter-reset:nv;gap:0}
[data-style="editorial-shop"] .nav-list li{counter-increment:nv}
[data-style="editorial-shop"] .nav-list a{font-size:.68rem;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text);padding:.4em .55em;border-radius:0}
[data-style="editorial-shop"] .nav-list a::after{content:counter(nv,decimal-leading-zero);margin-left:.55em;color:var(--muted);font-weight:500}
[data-style="editorial-shop"] .nav-list a:hover,[data-style="editorial-shop"] .nav-list a[aria-current="page"]{background:none;text-decoration:underline;text-underline-offset:3px}
[data-style="editorial-shop"] .menu summary{width:38px;height:34px;border-radius:2px}
[data-style="editorial-shop"] .menu-panel{top:calc(100% + 6px);left:14px;right:14px;border-radius:2px;border:0;background:var(--surface)}
[data-style="editorial-shop"] .btn{border-radius:2px;min-height:44px;padding:.55em 1.2em;font-size:.7rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
[data-style="editorial-shop"] .btn.sm{min-height:30px;padding:.35em .9em;font-size:.64rem}
[data-style="editorial-shop"] .btn .arr{display:none}
[data-style="editorial-shop"] .eyebrow{font-size:.68rem;letter-spacing:.07em;color:var(--text);font-weight:600}
[data-style="editorial-shop"] .h1{font-size:clamp(2rem,.9rem + 3.6vw,4.6rem)}
[data-style="editorial-shop"] .h2{font-size:clamp(1.5rem,1rem + 1.8vw,2.7rem);line-height:1}
[data-style="editorial-shop"] .h2.xl{font-size:clamp(1.8rem,1rem + 2.6vw,3.4rem)}
[data-style="editorial-shop"] .h3{font-family:var(--font-b);font-stretch:100%;text-transform:none;font-weight:600;font-size:1rem;letter-spacing:0}
[data-style="editorial-shop"] .h1 em,[data-style="editorial-shop"] .h2 em,[data-style="editorial-shop"] .stmt-t em{font-style:normal;color:var(--muted)}
[data-style="editorial-shop"] .lead{font-size:1rem;max-width:34em}
[data-style="editorial-shop"] .stmt-t{font-size:clamp(1.35rem,.8rem + 2vw,2.7rem);line-height:1.02;max-width:27ch}
[data-style="editorial-shop"] .media,[data-style="editorial-shop"] .card,[data-style="editorial-shop"] .bento-cell{border-radius:2px}
[data-style="editorial-shop"] .card,[data-style="editorial-shop"] .bento-cell{border-color:transparent}
[data-style="editorial-shop"] .prod-media{background:none}
[data-style="editorial-shop"] .prod-name,[data-style="editorial-shop"] .prod-price{font-size:.72rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
[data-style="editorial-shop"] .prod-note{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase}
[data-style="editorial-shop"] .v-banner{padding-top:clamp(120px,14vw,190px)}
[data-style="editorial-shop"] .faq-item summary{font-size:.95rem}
[data-style="editorial-shop"] .s-footer{font-size:.74rem;letter-spacing:.06em;text-transform:uppercase}
[data-style="editorial-shop"] .f-brand{font-size:clamp(1.6rem,1rem + 3vw,3.6rem)}
[data-style="editorial-shop"] .f-about .muted{text-transform:none;letter-spacing:0;font-size:.92rem}
[data-style="editorial-shop"] .sform input{border-radius:2px}
[data-style="editorial-shop"] .s-signup .h2{font-size:clamp(1.4rem,1rem + 1.6vw,2.4rem)}

/* Manifesto: black, light statements, one gradient, line art */
[data-style="manifesto"] .site-head{background:color-mix(in srgb,var(--bg) 72%,transparent);border-bottom:0}
[data-style="manifesto"] .brand{font-weight:400;font-size:1.05rem;letter-spacing:0}
[data-style="manifesto"] .brand-mark{background:none;border:1px solid currentColor;color:var(--text);border-radius:50%;font-size:.85rem;width:28px;height:28px}
[data-style="manifesto"] .nav-list a{font-weight:400}
[data-style="manifesto"] .eyebrow{font-size:.7rem;letter-spacing:.26em;font-weight:500;color:var(--muted)}
[data-style="manifesto"] .h1 em,[data-style="manifesto"] .h2 em,[data-style="manifesto"] .stmt-t em,[data-style="manifesto"] .ch-t em{font-style:normal;background:linear-gradient(92deg,var(--accent-text),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
[data-style="manifesto"] .btn{border-radius:999px;font-weight:500}
[data-style="manifesto"] .btn:not(.alt){background:var(--text);color:var(--bg);border-color:var(--text)}
[data-style="manifesto"] .card,[data-style="manifesto"] .bento-cell{background:transparent;border-color:var(--line-2)}
[data-style="manifesto"] .stmt-t{font-weight:300}
[data-style="manifesto"] .stmt-frame{background:transparent}
[data-style="manifesto"] .ibadge{background:none;border:1px solid var(--line-2);border-radius:50%}
[data-style="manifesto"] .art [class*="k-"]:not(.glow),[data-style="manifesto"] .art .keep:not(.bgr){fill:none;stroke:color-mix(in srgb,var(--text) 62%,transparent);stroke-width:1.1;vector-effect:non-scaling-stroke}
[data-style="manifesto"] .art .bgr{fill:var(--bg);stroke:none}
[data-style="manifesto"] .ph::after{display:none}
[data-style="manifesto"] .media{background:var(--bg);border:1px solid var(--line)}
[data-style="manifesto"] .s-signup .sform input{border-radius:999px}

/* Timeline (portfolio-timeline): white, regular weights, grey links, work in order */
[data-style="portfolio-timeline"] .site-head{background:color-mix(in srgb,var(--bg) 92%,transparent);border-bottom:0}
[data-style="portfolio-timeline"] .site-head .wrap{min-height:84px}
[data-style="portfolio-timeline"] body:has(.v-minimal) .site-head{display:none}
[data-style="portfolio-timeline"] .v-minimal{padding-top:clamp(56px,9vw,128px)}
[data-style="portfolio-timeline"] .brand{font-weight:400;font-size:1.2rem;letter-spacing:-.01em}
[data-style="portfolio-timeline"] .brand-mark{display:none}
[data-style="portfolio-timeline"] .nav-list a{color:var(--muted);font-weight:300;font-size:1.05rem;padding:.3em .55em}
[data-style="portfolio-timeline"] .nav-list a:hover,[data-style="portfolio-timeline"] .nav-list a[aria-current="page"]{background:none;color:var(--text)}
[data-style="portfolio-timeline"] .head-cta{background:none;border:0;color:var(--text);padding:.3em .55em;min-height:0;font-weight:400;font-size:1.05rem}
[data-style="portfolio-timeline"] .head-cta .arr{display:none}
[data-style="portfolio-timeline"] .eyebrow{text-transform:none;letter-spacing:0;font-size:1rem;font-weight:400;color:var(--muted)}
[data-style="portfolio-timeline"] .h1 em,[data-style="portfolio-timeline"] .h2 em,[data-style="portfolio-timeline"] .stmt-t em{font-style:normal;color:var(--muted)}
[data-style="portfolio-timeline"] .btn{border-radius:999px;font-weight:500}
[data-style="portfolio-timeline"] .stmt-t{font-size:clamp(1.6rem,1.05rem + 2.2vw,3.1rem);line-height:1.18;max-width:24ch}
[data-style="portfolio-timeline"] .card,[data-style="portfolio-timeline"] .bento-cell{border-color:transparent}
[data-style="portfolio-timeline"] .cta-card{background:var(--surface)}
[data-style="portfolio-timeline"] .s-footer .f-brand{font-weight:400}

/* Product (ai-product): warm white, tight grotesk, pill controls, a dark band for proof */
[data-style="ai-product"] .site-head{background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:0}
[data-style="ai-product"] .brand-mark{border-radius:50%}
[data-style="ai-product"] .nav-list a{color:var(--text);font-size:.92rem;font-weight:500}
[data-style="ai-product"] .btn{border-radius:999px;min-height:46px;padding:.6em 1.35em;font-weight:500;font-size:.96rem}
[data-style="ai-product"] .btn.sm{min-height:36px;padding:.4em 1em;font-size:.88rem}
[data-style="ai-product"] .btn .arr{display:none}
[data-style="ai-product"] .eyebrow{display:inline-flex;width:max-content;max-width:100%;align-items:center;gap:.5em;padding:.45em .95em;border-radius:999px;background:var(--surface);border:1px solid var(--line);letter-spacing:0;text-transform:none;font-size:.86rem;font-weight:500;color:var(--text)}
[data-style="ai-product"] .eyebrow::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--accent-2)}
[data-style="ai-product"] .h1{font-size:clamp(2.5rem,1.2rem + 3.7vw,4.7rem)}
[data-style="ai-product"] .v-portrait{padding-top:clamp(40px,5vw,72px)}
[data-style="ai-product"] .v-portrait .hero-in{max-width:1120px}
[data-style="ai-product"] .h1 em,[data-style="ai-product"] .h2 em{font-style:normal;color:var(--muted)}
[data-style="ai-product"] .t-inv .h2 em{color:var(--muted)}
[data-style="ai-product"] .card,[data-style="ai-product"] .bento-cell{border-color:var(--line);box-shadow:none}
[data-style="ai-product"] .t-inv .bento-cell{background:var(--surface)}
[data-style="ai-product"] .bento-cell .media{margin:10px 10px 0;border-radius:calc(var(--r) - 4px)}
[data-style="ai-product"] .strip .media{border-radius:var(--r)}
[data-style="ai-product"] .tier.featured{box-shadow:0 30px 60px -36px rgba(0,0,0,.4)}
[data-style="ai-product"] .t-inv + .t-inv{padding-top:0}

/* ---------- motion ---------- */
html[data-motion="lively"]{--rv-d:42px}
@media (prefers-reduced-motion:no-preference){
  html:not([data-motion="none"]){scroll-behavior:smooth}
  html:not([data-motion="none"]) .media img{transition:transform .9s cubic-bezier(.2,.7,.2,1)}
  html:not([data-motion="none"]) .btn:hover{transform:translateY(-1px)}
  html:not([data-motion="none"]) .btn:not(.alt):hover{box-shadow:0 12px 26px -12px color-mix(in srgb,var(--accent) 80%,transparent)}
  html:not([data-motion="none"]) .btn:hover .arr,html:not([data-motion="none"]) a:hover .more .arr,html:not([data-motion="none"]) .post-row:hover .arr{transform:translateX(4px)}
  html:not([data-motion="none"]) .back:hover .arr{transform:rotate(180deg) translateX(4px)}
  html:not([data-motion="none"]) .fcard,html:not([data-motion="none"]) .tier,html:not([data-motion="none"]) .home-card a,html:not([data-motion="none"]) .bento-cell{transition:transform .45s cubic-bezier(.2,.7,.2,1),box-shadow .45s}
  html:not([data-motion="none"]) .fcard:hover,html:not([data-motion="none"]) .home-card a:hover,html:not([data-motion="none"]) .bento-cell:hover{transform:translateY(-5px)}
  html:not([data-motion="none"]) a:hover .media img,html:not([data-motion="none"]) figure:hover .media img,html:not([data-motion="none"]) .frow:hover .media img,html:not([data-motion="none"]) .bento-cell:hover .media img{transform:scale(1.045)}
  html[data-motion="lively"] .tier:hover{transform:translateY(-6px)}
  [data-style="bold"] .btn:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--text)}
  html:not([data-motion="none"]) .marquee-track{animation:mz-marquee 38s linear infinite}
  html:not([data-motion="none"]):not(.editing) .s-hero .hero-in>*,html:not([data-motion="none"]):not(.editing) .hero-art,html:not([data-motion="none"]):not(.editing) .hero-shot{animation:mz-rise 1s cubic-bezier(.2,.7,.2,1) both}
  .s-hero .hero-in>:nth-child(2){animation-delay:.08s!important}
  .s-hero .hero-in>:nth-child(3){animation-delay:.16s!important}
  .s-hero .hero-in>:nth-child(4),.s-hero .hero-art,.s-hero .hero-shot{animation-delay:.24s!important}
  .s-hero .hero-in>:nth-child(5){animation-delay:.32s!important}
  html.rv [data-rv]:not(.in){opacity:0;transform:translateY(var(--rv-d));animation:mz-show 0s 3s forwards}
  html.rv [data-rv]{transition:opacity .9s cubic-bezier(.2,.7,.2,1),transform .9s cubic-bezier(.2,.7,.2,1);transition-delay:calc(var(--i,0) * 90ms)}
  html.rv[data-motion="lively"] [data-rv]:not(.in){transform:translateY(var(--rv-d)) scale(.97)}
  html:not([data-motion="none"]) .spin{animation:mz-spin 1s linear infinite}
  html.rv .stmt[data-scrub] .w{opacity:clamp(.14,calc((var(--p,0) * (var(--n) + 8) - var(--k)) / 4),1);transition:opacity .25s}
  html.rv .ann.on .tag{opacity:clamp(0,calc((var(--p,0) * (var(--n) + 1.2) - var(--k) - .25) * 4),1);transform:translateY(calc((1 - clamp(0,calc((var(--p,0) * (var(--n) + 1.2) - var(--k) - .25) * 4),1)) * 10px))}
  html.rv .ch[data-rv] .motif *{stroke-dasharray:1 1;stroke-dashoffset:1;transition:stroke-dashoffset 2.4s cubic-bezier(.45,0,.2,1) .15s}
  html.rv .ch[data-rv].in .motif *{stroke-dashoffset:0}
  html.rv .ch[data-rv] .motif .sun{opacity:0;transition:opacity 1.8s .9s}
  html.rv .ch[data-rv].in .motif .sun{opacity:1}
  html:not([data-motion="none"]):not(.editing) .scroll-cue span{animation:mz-cue 2.4s cubic-bezier(.6,0,.2,1) infinite;transform-origin:top}
  html:not([data-motion="none"]) .prod-media img,html:not([data-motion="none"]) .prod-media .art{transition:transform .9s cubic-bezier(.2,.7,.2,1)}
  html:not([data-motion="none"]) .prod:hover .prod-media .art{transform:scale(1.035)}
}
@keyframes mz-rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes mz-show{to{opacity:1;transform:none}}
@keyframes mz-marquee{to{transform:translateX(-50%)}}
@keyframes mz-spin{to{transform:rotate(1turn)}}
@keyframes mz-cue{0%{transform:scaleY(0)}50%{transform:scaleY(1)}100%{transform:scaleY(1);opacity:0}}
@media (prefers-reduced-motion:reduce){.marquee .logos[aria-hidden]{display:none}.marquee .logos{flex-wrap:wrap}.marquee-track{width:auto;justify-content:center}.marquee{-webkit-mask-image:none;mask-image:none}}
html[data-motion="none"] .marquee .logos[aria-hidden]{display:none}
html[data-motion="none"] .marquee .logos{flex-wrap:wrap}
html[data-motion="none"] .marquee-track{width:auto;justify-content:center}
@media print{.site-head,.menu,.embed{display:none}.sec{padding-block:24px}}
`;

/** Only in the editor: hover outlines, the inline editing state, placeholders and the section bar. */
export const EDIT_CSS = `
html.editing{scroll-behavior:auto}
[data-edit]{cursor:text;outline:1.5px dashed transparent;outline-offset:4px;border-radius:2px;transition:outline-color .12s}
[data-edit]:hover{outline-color:rgba(59,130,246,.75)}
[data-edit][contenteditable]{outline:2px solid #3b82f6;outline-offset:4px;cursor:text;-webkit-user-modify:read-write-plaintext-only}
.btn [data-edit][contenteditable]{outline-color:#fff}
[data-empty]::before{content:attr(data-ph);opacity:.5;font-style:italic;font-weight:400}
[data-empty][contenteditable]::before{content:''}
.sec:not(.mz-sel) [data-empty],.sec:not(.mz-sel) .mz-only{display:none}
.sec:not(.mz-sel) .note:empty{display:none}
[data-img]{cursor:pointer}
.media:hover>[data-img],.media:hover>.ph[data-img]{outline:3px solid #3b82f6;outline-offset:-3px}
.mz-ph-img{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:.5em;padding:.6em 1em;border-radius:999px;background:rgba(10,10,12,.72);color:#fff;font:600 13px/1 system-ui,sans-serif;white-space:nowrap;opacity:0;transition:opacity .15s;pointer-events:none}
.mz-ic{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8}
.media:hover .mz-ph-img,.mz-sel .mz-ph-img{opacity:1}
[data-sid]{scroll-margin-top:80px}
[data-sid]:hover{box-shadow:inset 0 0 0 1.5px rgba(59,130,246,.5)}
[data-sid].mz-sel{box-shadow:inset 0 0 0 2.5px #3b82f6}
[data-sid][data-hidden]{opacity:.35}
.mz-ph{background:rgba(250,204,21,.28);box-shadow:0 0 0 2px rgba(250,204,21,.28);border-radius:2px}
[data-ph-item]{outline:1.5px dashed rgba(234,160,8,.8);outline-offset:6px}
.mz-hint{padding:24px;border:1.5px dashed var(--line-2);border-radius:var(--r);color:var(--muted);text-align:center;font-size:.95rem}
.mz-bar{position:absolute;z-index:60;top:10px;right:10px;display:flex;gap:2px;padding:3px;border-radius:10px;background:#111114;box-shadow:0 8px 24px rgba(0,0,0,.35);font:500 12px/1 system-ui,-apple-system,sans-serif;color:#f4f4f1}
.mz-bar b{padding:7px 9px 7px 8px;font-weight:600;color:#ffbf2f;white-space:nowrap}
.mz-bar button{all:unset;cursor:pointer;display:grid;place-items:center;width:28px;height:26px;border-radius:7px;color:#d8d8dc}
.mz-bar button:hover{background:#2a2a30;color:#fff}
.mz-bar button:disabled{opacity:.3;cursor:default}
.mz-bar svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.mz-add{all:unset;position:absolute;z-index:60;left:50%;bottom:-15px;transform:translateX(-50%);cursor:pointer;width:30px;height:30px;border-radius:50%;background:#3b82f6;color:#fff;display:grid;place-items:center;box-shadow:0 6px 18px rgba(0,0,0,.3)}
.mz-add svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2}
`;
