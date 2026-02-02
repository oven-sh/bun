/**
 * demo-animation.ts — Smooth Animations & Effects
 *
 * Showcases smooth terminal animations: bouncing ball, particle fountain,
 * wave effect, and a matrix rain effect. Demonstrates the rendering
 * performance of Bun's TUI diff renderer.
 *
 * Demonstrates: high-fps animation loops, mathematical animations, particle
 * systems, color gradients, setText, fill, style (fg/bg), TUITerminalWriter,
 * TUIKeyReader, alt screen, resize.
 *
 * Run: bun run test/js/bun/tui/demos/demo-animation.ts
 * Controls: 1-4 switch effects, Space pause, Q quit
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Styles ---
const st = {
  titleBar: screen.style({ fg: 0x000000, bg: 0xe5c07b, bold: true }),
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  tabActive: screen.style({ fg: 0x000000, bg: 0xe5c07b, bold: true }),
  tabInactive: screen.style({ fg: 0xabb2bf, bg: 0x2c313a }),
  dim: screen.style({ fg: 0x5c6370 }),
  fps: screen.style({ fg: 0x98c379, bold: true }),
};

// --- State ---
let activeEffect = 0;
let paused = false;
let frame = 0;
let lastTime = Date.now();
let fpsCounter = 0;
let displayFps = 0;

const effectNames = ["Bouncing Balls", "Particles", "Sine Wave", "Matrix Rain"];

// --- Effect 1: Bouncing Balls ---
interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  char: string;
}

const balls: Ball[] = [];
const ballColors = [0xff5555, 0x55ff55, 0x5555ff, 0xffff55, 0xff55ff, 0x55ffff, 0xffffff, 0xff8800];
const ballChars = ["\u25cf", "\u2b24", "\u25c9", "\u25ce", "\u2022", "\u25cb"];

function initBalls() {
  balls.length = 0;
  for (let i = 0; i < 12; i++) {
    balls.push({
      x: Math.random() * (cols - 4) + 2,
      y: Math.random() * (rows - 6) + 3,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 1.5,
      color: ballColors[i % ballColors.length],
      char: ballChars[i % ballChars.length],
    });
  }
}

function tickBalls() {
  const minX = 1,
    maxX = cols - 2,
    minY = 2,
    maxY = rows - 2;
  for (const ball of balls) {
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vy += 0.05; // gravity

    if (ball.x <= minX || ball.x >= maxX) {
      ball.vx *= -0.95;
      ball.x = Math.max(minX, Math.min(maxX, ball.x));
    }
    if (ball.y <= minY || ball.y >= maxY) {
      ball.vy *= -0.85;
      ball.y = Math.max(minY, Math.min(maxY, ball.y));
      if (Math.abs(ball.vy) < 0.3) ball.vy = -(2 + Math.random() * 2);
    }
  }
}

function renderBalls() {
  for (const ball of balls) {
    const ix = Math.round(ball.x);
    const iy = Math.round(ball.y);
    if (ix >= 0 && ix < cols && iy >= 2 && iy < rows - 1) {
      screen.setText(ix, iy, ball.char, screen.style({ fg: ball.color, bold: true }));
    }
  }
}

// --- Effect 2: Particles ---
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
}

const particles: Particle[] = [];

function spawnParticles(count: number) {
  const cx = cols / 2;
  const cy = rows / 2;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 2;
    const hue = (frame * 2 + Math.random() * 60) % 360;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.5 - 0.5,
      life: 0,
      maxLife: 20 + Math.floor(Math.random() * 40),
      color: hslToRgb(hue, 1, 0.6),
    });
  }
}

function tickParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.03; // gravity
    p.life++;
    if (p.life >= p.maxLife || p.x < 0 || p.x >= cols || p.y < 2 || p.y >= rows - 1) {
      particles.splice(i, 1);
    }
  }
  if (!paused) spawnParticles(3);
}

function renderParticles() {
  for (const p of particles) {
    const ix = Math.round(p.x);
    const iy = Math.round(p.y);
    if (ix >= 0 && ix < cols && iy >= 2 && iy < rows - 1) {
      const fade = 1 - p.life / p.maxLife;
      const chars = ["\u2588", "\u2593", "\u2592", "\u2591", "\u00b7"];
      const ci = Math.min(chars.length - 1, Math.floor((1 - fade) * chars.length));
      const r = (p.color >> 16) & 0xff;
      const g = (p.color >> 8) & 0xff;
      const b = p.color & 0xff;
      const fr = Math.round(r * fade);
      const fg = Math.round(g * fade);
      const fb = Math.round(b * fade);
      screen.setText(ix, iy, chars[ci], screen.style({ fg: (fr << 16) | (fg << 8) | fb }));
    }
  }
}

// --- Effect 3: Sine Wave ---
function renderSineWave() {
  const centerY = Math.floor((rows - 3) / 2) + 2;
  const amplitude = Math.min((rows - 5) / 2, 8);

  for (let x = 0; x < cols; x++) {
    // Multiple overlapping waves
    const t = frame * 0.08;
    const y1 = Math.sin(x * 0.08 + t) * amplitude;
    const y2 = Math.sin(x * 0.12 + t * 1.3) * amplitude * 0.6;
    const y3 = Math.sin(x * 0.05 + t * 0.7) * amplitude * 0.4;

    // Wave 1 (blue)
    const wy1 = Math.round(centerY + y1);
    if (wy1 >= 2 && wy1 < rows - 1) {
      const hue = (x * 3 + frame * 2) % 360;
      screen.setText(x, wy1, "\u2588", screen.style({ fg: hslToRgb(hue, 0.8, 0.5) }));
    }

    // Wave 2 (trail)
    const wy2 = Math.round(centerY + y1 + y2);
    if (wy2 >= 2 && wy2 < rows - 1) {
      screen.setText(x, wy2, "\u2593", screen.style({ fg: hslToRgb((x * 3 + frame * 2 + 120) % 360, 0.6, 0.4) }));
    }

    // Wave 3 (subtle)
    const wy3 = Math.round(centerY + y3);
    if (wy3 >= 2 && wy3 < rows - 1) {
      screen.setText(x, wy3, "\u2591", screen.style({ fg: hslToRgb((x * 3 + frame * 2 + 240) % 360, 0.4, 0.3) }));
    }
  }
}

// --- Effect 4: Matrix Rain ---
interface RainDrop {
  x: number;
  y: number;
  speed: number;
  length: number;
  chars: number[];
}

const rainDrops: RainDrop[] = [];

function initRain() {
  rainDrops.length = 0;
  for (let x = 0; x < cols; x += 2) {
    if (Math.random() < 0.4) {
      rainDrops.push(makeRainDrop(x));
    }
  }
}

function makeRainDrop(x: number): RainDrop {
  const length = 5 + Math.floor(Math.random() * 15);
  const chars: number[] = [];
  for (let i = 0; i < length; i++) {
    chars.push(0x30a0 + Math.floor(Math.random() * 96)); // Katakana
  }
  return {
    x,
    y: -length - Math.floor(Math.random() * rows),
    speed: 0.3 + Math.random() * 0.7,
    length,
    chars,
  };
}

function tickRain() {
  for (let i = rainDrops.length - 1; i >= 0; i--) {
    const drop = rainDrops[i];
    drop.y += drop.speed;

    // Randomize chars occasionally
    if (Math.random() < 0.1) {
      const ci = Math.floor(Math.random() * drop.chars.length);
      drop.chars[ci] = 0x30a0 + Math.floor(Math.random() * 96);
    }

    if (drop.y > rows + drop.length) {
      rainDrops[i] = makeRainDrop(drop.x);
    }
  }

  // Spawn new drops
  if (rainDrops.length < cols / 2 && Math.random() < 0.1) {
    const x = Math.floor(Math.random() * cols);
    rainDrops.push(makeRainDrop(x));
  }
}

function renderRain() {
  for (const drop of rainDrops) {
    for (let i = 0; i < drop.length; i++) {
      const y = Math.floor(drop.y) - i;
      if (y >= 2 && y < rows - 1) {
        const brightness = i === 0 ? 1.0 : Math.max(0.1, 1.0 - (i / drop.length) * 0.8);
        const g = Math.round(255 * brightness);
        const r = i === 0 ? 200 : 0;
        const b = i === 0 ? 200 : 0;
        const color = (r << 16) | (g << 8) | b;
        const ch = String.fromCodePoint(drop.chars[i % drop.chars.length]);
        screen.setText(drop.x, y, ch, screen.style({ fg: color }));
      }
    }
  }
}

// --- HSL to RGB ---
function hslToRgb(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

// --- Main render ---
function render() {
  screen.clear();

  // Title bar
  screen.fill(0, 0, cols, 1, " ", st.titleBar);
  screen.setText(2, 0, " Animations ", st.titleBar);

  // Tabs
  let tx = 2;
  for (let i = 0; i < effectNames.length; i++) {
    const label = ` ${i + 1}:${effectNames[i]} `;
    screen.setText(tx, 1, label, i === activeEffect ? st.tabActive : st.tabInactive);
    tx += label.length + 1;
  }

  // FPS
  screen.setText(cols - 10, 1, `${displayFps} fps`, st.fps);

  // Render active effect
  switch (activeEffect) {
    case 0:
      renderBalls();
      break;
    case 1:
      renderParticles();
      break;
    case 2:
      renderSineWave();
      break;
    case 3:
      renderRain();
      break;
  }

  // Footer
  const footerText = paused ? " PAUSED | 1-4:Effect | Space:Resume | Q:Quit " : " 1-4:Effect | Space:Pause | Q:Quit ";
  screen.setText(0, rows - 1, footerText.slice(0, cols), st.footer);

  writer.render(screen, { cursorVisible: false });
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean }) => {
  const { name, ctrl } = event;

  if (name === "q" || (ctrl && name === "c")) {
    cleanup();
    return;
  }

  switch (name) {
    case "1":
      activeEffect = 0;
      initBalls();
      break;
    case "2":
      activeEffect = 1;
      particles.length = 0;
      break;
    case "3":
      activeEffect = 2;
      break;
    case "4":
      activeEffect = 3;
      initRain();
      break;
    case " ":
      paused = !paused;
      break;
  }
  render();
};

// --- Resize ---
writer.onresize = (newCols: number, newRows: number) => {
  cols = newCols;
  rows = newRows;
  screen.resize(cols, rows);
  if (activeEffect === 0) initBalls();
  if (activeEffect === 3) initRain();
  render();
};

// --- Cleanup ---
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  clearInterval(timer);
  reader.close();
  writer.exitAltScreen();
  writer.close();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// --- Animation loop ---
initBalls();
initRain();

const timer = setInterval(() => {
  if (!paused) {
    frame++;
    switch (activeEffect) {
      case 0:
        tickBalls();
        break;
      case 1:
        tickParticles();
        break;
      case 3:
        tickRain();
        break;
    }
  }

  // FPS counter
  fpsCounter++;
  const now = Date.now();
  if (now - lastTime >= 1000) {
    displayFps = fpsCounter;
    fpsCounter = 0;
    lastTime = now;
  }

  render();
}, 33); // ~30fps

render();
