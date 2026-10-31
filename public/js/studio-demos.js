// Original dependency-free, MIT-licensed examples. Actual 3D projection + playable game.
export function drawCrystal(canvas, t = 0) {
  const c = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height;
  const bg = c.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#061c23");
  bg.addColorStop(1, "#182541");
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "#6acdb71a";
  c.lineWidth = 1;
  for (let j = -6; j <= 6; j++) {
    c.beginPath();
    c.moveTo(w / 2 + j * 50, h * 0.75);
    c.lineTo(w / 2 + j * 160, h);
    c.stroke();
  }
  for (let j = 0; j < 6; j++) {
    c.beginPath();
    c.moveTo(0, h * 0.75 + j * j * 4);
    c.lineTo(w, h * 0.75 + j * j * 4);
    c.stroke();
  }
  const angle = t * 0.35,
    project = ([x, y, z]) => {
      const rx = x * Math.cos(angle) + z * Math.sin(angle),
        rz = -x * Math.sin(angle) + z * Math.cos(angle);
      const ry = y * 0.94 - rz * 0.34,
        depth = y * 0.34 + rz * 0.94;
      const scale = 1 / (3.5 + depth);
      return [
        w / 2 + rx * scale * h * 1.05,
        h * 0.48 + ry * scale * h * 1.05,
        depth,
      ];
    };
  const vertices = [
    [0, -1.35, 0],
    [0.72, -0.35, 0.72],
    [-0.72, -0.35, 0.72],
    [-0.72, -0.35, -0.72],
    [0.72, -0.35, -0.72],
    [0.65, 0.55, 0.65],
    [-0.65, 0.55, 0.65],
    [-0.65, 0.55, -0.65],
    [0.65, 0.55, -0.65],
    [0, 1.1, 0],
  ].map(project);
  const faces = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 4],
    [0, 4, 1],
    [1, 5, 6, 2],
    [2, 6, 7, 3],
    [3, 7, 8, 4],
    [4, 8, 5, 1],
    [9, 6, 5],
    [9, 7, 6],
    [9, 8, 7],
    [9, 5, 8],
  ];
  faces
    .map((ids, i) => ({
      ids,
      i,
      z: ids.reduce((sum, n) => sum + vertices[n][2], 0) / ids.length,
    }))
    .sort((a, b) => b.z - a.z)
    .forEach(({ ids, i }) => {
      c.beginPath();
      ids.forEach((n, j) => {
        const [x, y] = vertices[n];
        j ? c.lineTo(x, y) : c.moveTo(x, y);
      });
      c.closePath();
      c.fillStyle = [
        "#39b6b5cc",
        "#93e1cfcc",
        "#287b9fcc",
        "#203c83dd",
        "#63c7c0aa",
      ][i % 5];
      c.fill();
      c.strokeStyle = "#b6fff699";
      c.lineWidth = 1.2;
      c.stroke();
    });
  c.fillStyle = "#a4f0df";
  for (let i = 0; i < 36; i++) {
    const a = i * 2.4 + t * 0.18,
      r = 110 + 35 * Math.sin(i * 3);
    c.globalAlpha = 0.25 + (i % 4) * 0.15;
    c.beginPath();
    c.arc(
      w / 2 + Math.cos(a) * r * 1.6,
      h * 0.53 + Math.sin(a) * r * 0.5,
      1.5,
      0,
      Math.PI * 2,
    );
    c.fill();
  }
  c.globalAlpha = 1;
  c.font = "10px monospace";
  c.fillStyle = "#91bcb9";
  c.fillText("ROTATION STUDY / 001", 24, h - 22);
}
export function createOrbitGame(canvas, { status, onEnd = () => {} } = {}) {
  const c = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height;
  let x = 0.5,
    target = 0.5,
    items = [],
    running = false,
    score = 0,
    elapsed = 0,
    spawn = 0,
    keys = new Set(),
    dragging = false;
  function start() {
    x = 0.5;
    target = 0.5;
    items = [];
    running = true;
    score = 0;
    elapsed = 0;
    spawn = 0;
    keys.clear();
    if (status) status.textContent = "Score: 0 · Catch gold. Avoid pink.";
    canvas.focus();
  }
  function step(dt) {
    if (!running) return;
    elapsed += dt;
    spawn -= dt;
    if (keys.has("ArrowLeft") || keys.has("a")) target -= dt * 0.7;
    if (keys.has("ArrowRight") || keys.has("d")) target += dt * 0.7;
    target = Math.max(0.06, Math.min(0.94, target));
    x += (target - x) * Math.min(1, dt * 14);
    if (spawn <= 0) {
      items.push({
        x: 0.07 + Math.random() * 0.86,
        y: -0.06,
        gold: Math.random() > 0.42,
      });
      spawn = 0.52;
    }
    for (const item of items) {
      item.y += dt * (0.28 + Math.min(elapsed / 240, 0.16));
      if (Math.abs(item.x - x) < 0.045 && Math.abs(item.y - 0.82) < 0.055) {
        if (item.gold) {
          score += 10;
          item.y = 2;
          if (status) status.textContent = `Score: ${score} · Keep going!`;
        } else {
          running = false;
          if (status)
            status.textContent = `Final score: ${score}. Ready for another orbit?`;
          onEnd(score);
        }
      }
    }
    items = items.filter((i) => i.y < 1.2);
  }
  function render(t = 0, attract = false) {
    c.fillStyle = "#11172c";
    c.fillRect(0, 0, w, h);
    const glow = c.createRadialGradient(
      w * 0.7,
      h * 0.15,
      0,
      w * 0.7,
      h * 0.15,
      w * 0.7,
    );
    glow.addColorStop(0, "#253e64");
    glow.addColorStop(1, "#101427");
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#b9d7ef";
    for (let i = 0; i < 90; i++) {
      c.globalAlpha = 0.2 + (i % 5) * 0.14;
      const sx = (i * 137.51) % w,
        sy = (i * 61.7 + t * (15 + (i % 9))) % h;
      c.fillRect(sx, sy, i % 7 === 0 ? 2 : 1, 2);
    }
    c.globalAlpha = 1;
    c.fillStyle = "#d58460";
    c.beginPath();
    c.arc(w * 0.79, h * 0.28, h * 0.17, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#ecc3a466";
    c.lineWidth = 10;
    c.beginPath();
    c.ellipse(w * 0.79, h * 0.28, h * 0.27, h * 0.055, -0.28, 0, Math.PI * 2);
    c.stroke();
    const objects = attract
      ? Array.from({ length: 8 }, (_, i) => ({
          x: 0.1 + ((i * 0.137) % 0.85),
          y: ((t * 0.17 + i * 0.19) % 1.1) - 0.05,
          gold: i % 3 !== 0,
        }))
      : items;
    for (const item of objects) {
      c.save();
      c.translate(item.x * w, item.y * h);
      c.rotate(t + (item.gold ? 0 : 1));
      c.fillStyle = item.gold ? "#ffd159" : "#f57a98";
      c.beginPath();
      if (item.gold) {
        for (let k = 0; k < 10; k++) {
          const a = (k * Math.PI) / 5,
            r = k % 2 ? 5 : 12;
          c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
      } else {
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          c.lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
        }
      }
      c.closePath();
      c.fill();
      c.restore();
    }
    const shipX = (attract ? 0.5 + Math.sin(t * 0.9) * 0.27 : x) * w;
    c.save();
    c.translate(shipX, h * 0.82);
    c.fillStyle = "#ffbd54";
    c.beginPath();
    c.moveTo(-7, 15);
    c.lineTo(0, 28 + Math.sin(t * 25) * 5);
    c.lineTo(7, 15);
    c.fill();
    c.fillStyle = "#e9f6f5";
    c.beginPath();
    c.moveTo(0, -21);
    c.lineTo(18, 19);
    c.lineTo(0, 10);
    c.lineTo(-18, 19);
    c.closePath();
    c.fill();
    c.fillStyle = "#55c9d0";
    c.fillRect(-4, -3, 8, 11);
    c.restore();
    c.font = `bold ${w / 25}px monospace`;
    c.fillStyle = "#fff";
    c.fillText("ORBIT", 24, h - 24);
  }
  canvas.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "a", "d"].includes(e.key)) {
      keys.add(e.key);
      e.preventDefault();
    }
  });
  canvas.addEventListener("keyup", (e) => keys.delete(e.key));
  canvas.addEventListener("blur", () => keys.clear());
  const steer = (e) => {
    const b = canvas.getBoundingClientRect();
    target = Math.max(0.06, Math.min(0.94, (e.clientX - b.left) / b.width));
  };
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    steer(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) steer(e);
  });
  canvas.addEventListener("pointerup", () => (dragging = false));
  canvas.addEventListener("pointercancel", () => (dragging = false));
  return {
    start,
    step,
    render,
    stop() {
      running = false;
      keys.clear();
    },
    get running() {
      return running;
    },
  };
}
