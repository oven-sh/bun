/**
 * demo-snake.ts — Snake Game
 *
 * Classic snake game with food collection, growing tail, collision detection,
 * speed increase, score tracking, and game over / restart.
 *
 * Demonstrates: setInterval game loop, keyboard input, dynamic cell rendering,
 * fill, setText, style (fg/bg/bold), drawBox, alt screen, TUITerminalWriter,
 * TUIKeyReader, and resize handling.
 *
 * Run: bun run test/js/bun/tui/demos/demo-snake.ts
 * Controls: Arrow keys / WASD to move, R to restart, Q / Ctrl+C to quit
 */

// --- Setup ---
const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();

// --- Styles ---
const styles = {
  titleBar: screen.style({ fg: 0x000000, bg: 0x98c379, bold: true }),
  border: screen.style({ fg: 0x5c6370 }),
  snakeHead: screen.style({ fg: 0x000000, bg: 0x98c379, bold: true }),
  snakeBody: screen.style({ fg: 0x000000, bg: 0x61afef }),
  food: screen.style({ fg: 0xe06c75, bold: true }),
  empty: screen.style({ bg: 0x1e2127 }),
  score: screen.style({ fg: 0xe5c07b, bold: true }),
  label: screen.style({ fg: 0xabb2bf }),
  gameOver: screen.style({ fg: 0xe06c75, bold: true }),
  gameOverBg: screen.style({ fg: 0xffffff, bg: 0xe06c75, bold: true }),
  footer: screen.style({ fg: 0x5c6370, italic: true }),
  highScore: screen.style({ fg: 0xc678dd, bold: true }),
  speed: screen.style({ fg: 0x56b6c2 }),
};

// --- Game constants ---
const HEADER_H = 1;
const FOOTER_H = 1;
const SIDEBAR_W = 20;

function fieldWidth() {
  return Math.max(10, cols - SIDEBAR_W - 2);
}
function fieldHeight() {
  return Math.max(6, rows - HEADER_H - FOOTER_H - 2);
}
function fieldX() {
  return 1;
}
function fieldY() {
  return HEADER_H + 1;
}

// --- Game state ---
type Point = { x: number; y: number };
type Direction = "up" | "down" | "left" | "right";

let snake: Point[] = [];
let direction: Direction = "right";
let nextDirection: Direction = "right";
let food: Point = { x: 0, y: 0 };
let score = 0;
let highScore = 0;
let gameOver = false;
let paused = false;
let tickCount = 0;
let baseInterval = 120; // ms per tick
let currentInterval = baseInterval;

function resetGame() {
  const fw = fieldWidth();
  const fh = fieldHeight();
  const startX = Math.floor(fw / 2);
  const startY = Math.floor(fh / 2);
  snake = [
    { x: startX, y: startY },
    { x: startX - 1, y: startY },
    { x: startX - 2, y: startY },
  ];
  direction = "right";
  nextDirection = "right";
  score = 0;
  gameOver = false;
  paused = false;
  tickCount = 0;
  currentInterval = baseInterval;
  spawnFood();
}

function spawnFood() {
  const fw = fieldWidth();
  const fh = fieldHeight();
  let attempts = 0;
  do {
    food = {
      x: Math.floor(Math.random() * fw),
      y: Math.floor(Math.random() * fh),
    };
    attempts++;
  } while (snake.some(s => s.x === food.x && s.y === food.y) && attempts < 1000);
}

function tick() {
  if (gameOver || paused) return;
  tickCount++;

  direction = nextDirection;

  // Move head
  const head = snake[0];
  let nx = head.x;
  let ny = head.y;
  switch (direction) {
    case "up":
      ny--;
      break;
    case "down":
      ny++;
      break;
    case "left":
      nx--;
      break;
    case "right":
      nx++;
      break;
  }

  const fw = fieldWidth();
  const fh = fieldHeight();

  // Wall collision
  if (nx < 0 || nx >= fw || ny < 0 || ny >= fh) {
    gameOver = true;
    if (score > highScore) highScore = score;
    return;
  }

  // Self collision
  if (snake.some(s => s.x === nx && s.y === ny)) {
    gameOver = true;
    if (score > highScore) highScore = score;
    return;
  }

  snake.unshift({ x: nx, y: ny });

  // Food collision
  if (nx === food.x && ny === food.y) {
    score += 10;
    // Speed up every 50 points
    if (score % 50 === 0 && currentInterval > 50) {
      currentInterval = Math.max(50, currentInterval - 10);
      restartTimer();
    }
    spawnFood();
  } else {
    snake.pop();
  }
}

// --- Render ---
function render() {
  screen.clear();

  const fx = fieldX();
  const fy = fieldY();
  const fw = fieldWidth();
  const fh = fieldHeight();

  // Title bar
  screen.fill(0, 0, cols, HEADER_H, " ", styles.titleBar);
  const title = " Snake Game ";
  screen.setText(Math.max(0, Math.floor((cols - title.length) / 2)), 0, title, styles.titleBar);

  // Game field background
  screen.fill(fx, fy, fw, fh, " ", styles.empty);

  // Border around field
  screen.drawBox(fx - 1, fy - 1, fw + 2, fh + 2, { style: "rounded", styleId: styles.border });

  // Draw food
  screen.setText(fx + food.x, fy + food.y, "\u2665", styles.food); // heart

  // Draw snake
  for (let i = snake.length - 1; i >= 0; i--) {
    const seg = snake[i];
    if (seg.x >= 0 && seg.x < fw && seg.y >= 0 && seg.y < fh) {
      if (i === 0) {
        // Head - directional character
        let headChar = "\u25cf"; // filled circle
        switch (direction) {
          case "up":
            headChar = "\u25b2";
            break; // ▲
          case "down":
            headChar = "\u25bc";
            break; // ▼
          case "left":
            headChar = "\u25c0";
            break; // ◀
          case "right":
            headChar = "\u25b6";
            break; // ▶
        }
        screen.setText(fx + seg.x, fy + seg.y, headChar, styles.snakeHead);
      } else {
        screen.setText(fx + seg.x, fy + seg.y, "\u2588", styles.snakeBody); // full block
      }
    }
  }

  // --- Sidebar ---
  const sx = fx + fw + 2;
  const sw = cols - sx - 1;
  if (sw > 8) {
    let sy = fy;

    screen.setText(sx, sy, "Score", styles.label);
    sy++;
    screen.setText(sx, sy, `${score}`, styles.score);
    sy += 2;

    screen.setText(sx, sy, "High Score", styles.label);
    sy++;
    screen.setText(sx, sy, `${highScore}`, styles.highScore);
    sy += 2;

    screen.setText(sx, sy, "Length", styles.label);
    sy++;
    screen.setText(sx, sy, `${snake.length}`, styles.label);
    sy += 2;

    screen.setText(sx, sy, "Speed", styles.label);
    sy++;
    const speedPct = Math.round(((baseInterval - currentInterval) / (baseInterval - 50)) * 100);
    screen.setText(sx, sy, `${speedPct}%`, styles.speed);
    sy += 2;

    if (paused) {
      screen.setText(sx, sy, "PAUSED", styles.gameOver);
    }
  }

  // Game over overlay
  if (gameOver) {
    const msgW = 24;
    const msgH = 5;
    const mx = Math.floor((fw - msgW) / 2) + fx;
    const my = Math.floor((fh - msgH) / 2) + fy;
    screen.drawBox(mx, my, msgW, msgH, { style: "double", styleId: styles.gameOver, fill: true });
    screen.setText(mx + Math.floor((msgW - 9) / 2), my + 1, "GAME OVER", styles.gameOverBg);
    const scoreText = `Score: ${score}`;
    screen.setText(mx + Math.floor((msgW - scoreText.length) / 2), my + 2, scoreText, styles.score);
    screen.setText(mx + Math.floor((msgW - 16) / 2), my + 3, "R to restart", styles.label);
  }

  // Footer
  const footerY = rows - 1;
  const footerText = " Arrows/WASD: Move | P: Pause | R: Restart | Q: Quit ";
  screen.setText(0, footerY, footerText.slice(0, cols), styles.footer);

  writer.render(screen, { cursorVisible: false });
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean }) => {
  const { name, ctrl } = event;

  if (name === "q" || (ctrl && name === "c")) {
    cleanup();
    return;
  }

  if (name === "r") {
    resetGame();
    render();
    return;
  }

  if (name === "p" && !gameOver) {
    paused = !paused;
    render();
    return;
  }

  if (gameOver || paused) return;

  // Direction changes — prevent 180-degree reversal
  switch (name) {
    case "up":
    case "w":
    case "k":
      if (direction !== "down") nextDirection = "up";
      break;
    case "down":
    case "s":
    case "j":
      if (direction !== "up") nextDirection = "down";
      break;
    case "left":
    case "a":
    case "h":
      if (direction !== "right") nextDirection = "left";
      break;
    case "right":
    case "d":
    case "l":
      if (direction !== "left") nextDirection = "right";
      break;
  }
};

// --- Resize ---
writer.onresize = (newCols: number, newRows: number) => {
  cols = newCols;
  rows = newRows;
  screen.resize(cols, rows);
  render();
};

// --- Timer management ---
let timer: ReturnType<typeof setInterval>;

function restartTimer() {
  clearInterval(timer);
  timer = setInterval(() => {
    tick();
    render();
  }, currentInterval);
}

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

// --- Start ---
resetGame();
render();
restartTimer();
