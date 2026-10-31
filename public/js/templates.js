const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function templateSettings(s = {}) {
  return {
    version: 1,
    template: s.template === "game" ? "game" : "website",
    name: String(s.name || "Your studio").slice(0, 60),
    headline: String(s.headline || "Ideas, made tangible.").slice(0, 100),
    description: String(s.description || "Made with Massless.").slice(0, 400),
    accent: /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : "#d7e89c",
    speed: Math.max(1, Math.min(5, Number(s.speed) || 2)),
    asset: typeof s.asset === "string" ? s.asset.slice(0, 100) : "",
  };
}
export function renderTemplate(value, image = "") {
  const s = templateSettings(value),
    name = escape(s.name),
    headline = escape(s.headline),
    description = escape(s.description),
    accent = s.accent;
  // Only raster data URLs can be embedded; SVG and remote content are never executed.
  const art = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
    image,
  )
    ? image
    : "";
  const head = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title>`;
  if (s.template === "website")
    return (
      head +
      `<style>*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f1efe7;color:#1d2923;font:18px/1.6 system-ui}header,main,footer{padding:28px 7vw}header{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #ccc}a{color:inherit}.hero{padding:65px 0}h1{font-size:clamp(50px,9vw,120px);line-height:1;letter-spacing:-.06em;max-width:950px}h2{font-size:40px}.tag{background:${accent};border-radius:22px;padding:8px 16px;display:inline-block}img{width:100%;max-height:660px;object-fit:cover;border-radius:20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin:65px 0}.panel{padding:35px;border-top:1px solid #86918a}footer{background:#1d2923;color:#eee}@media(max-width:640px){.grid{grid-template-columns:1fr}header{flex-wrap:wrap}main{padding:20px}}</style><header><b>${name}</b><nav><a href="#work">Work</a> · <a href="#studio">Studio</a></nav></header><main><section class="hero"><span class="tag">Independent ideas. Original work.</span><h1>${headline}</h1><p>${description}</p><a href="#work">Explore the work ↓</a></section><section id="work">${art ? `<img src="${art}" alt="Featured studio project">` : '<div class="panel">Your next project starts here.</div>'}<div class="grid"><div class="panel"><small>01 / DIRECTION</small><h2>A clear point of view.</h2><p>Thoughtful work, shaped around what matters.</p></div><div class="panel"><small>02 / MAKING</small><h2>Room to experiment.</h2><p>From first sketch to finished detail.</p></div></div></section><section id="studio" class="panel"><h2>${name}</h2><p>${description}</p><p>Made with curiosity. Built with Massless.</p></section></main><footer>© ${new Date().getFullYear()} ${name} · Original website template · MIT</footer></html>`
    );
  return (
    head +
    `<style>body{margin:0;background:#11131d;color:#fff;font:16px system-ui;text-align:center}h1{margin:22px}canvas{width:100%;max-width:820px;display:block;margin:20px auto;background:#101423;touch-action:none;border-radius:18px}button{background:${accent};color:#172019;border:0;border-radius:20px;padding:12px 25px;cursor:pointer}p{padding:0 15px}</style><h1>${name}</h1><p>${headline}</p><p>${description}</p><button id="start">Start / Restart</button><p id="score" aria-live="polite">Catch stars. Dodge red debris. Arrow keys or drag to steer.</p><canvas id="game" width="820" height="540" tabindex="0" aria-label="Arcade game. Use arrow keys or drag to steer."></canvas><p>Original Massless arcade template · MIT · runs offline</p><script>const c=document.getElementById('game'),g=c.getContext('2d'),score=document.getElementById('score'),keys={},speed=${s.speed};let ship={x:410,y:450},objects=[],points=0,lives=3,running=false,last=0,spawn=0,frame=0;function reset(){ship={x:410,y:450};objects=[];points=0;lives=3;running=true;spawn=0;last=0;score.textContent='Score 0 · Lives 3';c.focus()}document.getElementById('start').onclick=reset;addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){keys[e.key]=true;e.preventDefault()}});addEventListener('keyup',e=>keys[e.key]=false);addEventListener('blur',()=>Object.keys(keys).forEach(k=>keys[k]=false));c.onpointerdown=e=>{c.setPointerCapture(e.pointerId);move(e)};c.onpointermove=e=>{if(e.buttons)move(e)};function move(e){const r=c.getBoundingClientRect();ship.x=(e.clientX-r.left)*820/r.width;ship.y=(e.clientY-r.top)*540/r.height}function draw(t){const dt=last?Math.min(.04,(t-last)/1000):0;last=t;g.fillStyle='#101423';g.fillRect(0,0,820,540);for(let i=0;i<45;i++){g.fillStyle='#343b5b';g.fillRect((i*137)%820,(i*71+t*.02)%540,2,2)}if(running){ship.x+=(keys.ArrowRight?1:0)*dt*360-(keys.ArrowLeft?1:0)*dt*360;ship.y+=(keys.ArrowDown?1:0)*dt*360-(keys.ArrowUp?1:0)*dt*360;ship.x=Math.max(18,Math.min(802,ship.x));ship.y=Math.max(25,Math.min(520,ship.y));spawn+=dt;if(spawn>.75-speed*.08){spawn=0;objects.push({x:20+Math.random()*780,y:-20,good:Math.random()>.3})}for(const o of objects){o.y+=dt*(95+speed*35);if(Math.hypot(o.x-ship.x,o.y-ship.y)<24){o.y=600;if(o.good)points++;else lives--;score.textContent='Score '+points+' · Lives '+lives;if(lives<=0){running=false;score.textContent='Finished · '+points+' points. Press Start to play again.'}}}objects=objects.filter(o=>o.y<570)}for(const o of objects){g.fillStyle=o.good?'${accent}':'#fa6767';g.beginPath();g.arc(o.x,o.y,o.good?8:13,0,Math.PI*2);g.fill()}g.fillStyle='${accent}';g.beginPath();g.moveTo(ship.x,ship.y-20);g.lineTo(ship.x-15,ship.y+14);g.lineTo(ship.x+15,ship.y+14);g.closePath();g.fill();if(!running){g.fillStyle='#ffffff';g.font='24px system-ui';g.textAlign='center';g.fillText('Press Start to play',410,260)}frame=requestAnimationFrame(draw)}frame=requestAnimationFrame(draw);<\/script></html>`
  );
}
