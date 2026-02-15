/**
 * demo-matrix-inline.ts — A single frame of matrix-style katakana rain
 * rendered inline (just one static snapshot, not animated).
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = Math.min(writer.columns || 80, 64);
const height = 20;
const screen = new Bun.TUIScreen(width, height);

// Katakana range: U+30A0 to U+30FF
const katakana: string[] = [];
for (let cp = 0x30a0; cp <= 0x30ff; cp++) {
  katakana.push(String.fromCodePoint(cp));
}

// Also include some digits and symbols for variety
const extras = "0123456789@#$%&*=+<>".split("");
const chars = [...katakana, ...extras];

// Seeded pseudo-random
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function randChar(): string {
  return chars[Math.floor(rand() * chars.length)];
}

// Create columns with "streams" of different lengths and positions
interface Stream {
  x: number;
  startY: number;
  length: number;
  speed: number; // how bright the tail is
}

const streams: Stream[] = [];
for (let x = 0; x < width; x++) {
  if (rand() < 0.7) {
    // 70% chance of having a stream in this column
    const numStreams = rand() < 0.3 ? 2 : 1;
    for (let s = 0; s < numStreams; s++) {
      streams.push({
        x,
        startY: Math.floor(rand() * height),
        length: 3 + Math.floor(rand() * (height - 3)),
        speed: 0.5 + rand() * 0.5,
      });
    }
  }
}

// Fill the screen with the background
const bgStyle = screen.style({ fg: 0x003300 });
screen.fill(0, 0, width, height, " ", bgStyle);

// Render each stream
for (const stream of streams) {
  for (let i = 0; i < stream.length; i++) {
    const y = (stream.startY + i) % height;
    const ch = randChar();

    let style: number;
    if (i === stream.length - 1) {
      // Head of the stream: bright white-green
      style = screen.style({ fg: 0xffffff, bold: true });
    } else if (i >= stream.length - 3) {
      // Near head: bright green
      style = screen.style({ fg: 0x00ff00, bold: true });
    } else {
      // Tail: fading green based on position
      const fade = (i / stream.length) * stream.speed;
      const g = Math.max(30, Math.round(200 * (1 - fade)));
      style = screen.style({ fg: (0 << 16) | (g << 8) | 0 });
    }

    screen.setText(stream.x, y, ch, style);
  }
}

// Add a few bright "sparkle" characters
for (let i = 0; i < 8; i++) {
  const x = Math.floor(rand() * width);
  const y = Math.floor(rand() * height);
  const sparkle = screen.style({ fg: 0xccffcc, bold: true });
  screen.setText(x, y, randChar(), sparkle);
}

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
