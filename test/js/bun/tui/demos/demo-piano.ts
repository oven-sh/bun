/**
 * demo-piano.ts — ASCII piano keyboard (2 octaves) with black and white keys
 * using box-drawing characters and half-blocks. Labels the notes.
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const width = Math.min(writer.columns || 80, 72);
const height = 14;
const screen = new Bun.TUIScreen(width, height);

// Styles
const titleStyle = screen.style({ fg: 0xffffff, bold: true });
const dimStyle = screen.style({ fg: 0x5c6370 });
const whiteKey = screen.style({ fg: 0xffffff, bg: 0xffffff });
const whiteKeyBorder = screen.style({ fg: 0x888888, bg: 0xffffff });
const blackKey = screen.style({ fg: 0x222222, bg: 0x222222 });
const labelStyle = screen.style({ fg: 0x333333, bg: 0xffffff });
const blackLabel = screen.style({ fg: 0x888888 });
const borderDark = screen.style({ fg: 0x444444 });

// Piano layout: 2 octaves
// White keys: C D E F G A B (7 per octave = 14 total)
// Black keys pattern: C# D# _ F# G# A# _ (5 per octave = 10 total)

const whiteNotes = ["C", "D", "E", "F", "G", "A", "B", "C", "D", "E", "F", "G", "A", "B"];
const octaveMarks = [4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5];

// Black key positions relative to white keys (0-indexed)
// After C(0): C#, After D(1): D#, skip E(2), After F(3): F#, After G(4): G#, After A(5): A#, skip B(6)
const blackKeyAfter = [0, 1, 3, 4, 5]; // Indices of white keys that have a sharp

const keyWidth = 4;
const totalKeys = whiteNotes.length;
const pianoWidth = totalKeys * keyWidth + 1;
const startX = Math.max(1, Math.floor((width - pianoWidth) / 2));

// Title
screen.setText(2, 0, "Piano Keyboard (2 Octaves)", titleStyle);
screen.setText(2, 1, "\u2500".repeat(width - 4), dimStyle);

const pianoTop = 3;
const whiteKeyHeight = 7;
const blackKeyHeight = 4;

// Draw white keys (background)
for (let i = 0; i < totalKeys; i++) {
  const x = startX + i * keyWidth;
  // Fill white key area
  screen.fill(x, pianoTop, keyWidth, whiteKeyHeight, " ", whiteKey);
  // Right border of each key
  for (let row = 0; row < whiteKeyHeight; row++) {
    screen.setText(x + keyWidth, pianoTop + row, "\u2502", borderDark);
  }
}

// Left border
for (let row = 0; row < whiteKeyHeight; row++) {
  screen.setText(startX, pianoTop + row, "\u2502", borderDark);
}

// Top border
screen.fill(startX, pianoTop, pianoWidth, 1, "\u2500", borderDark);
// Bottom border
screen.fill(startX, pianoTop + whiteKeyHeight, pianoWidth, 1, "\u2500", borderDark);

// White key note labels (at the bottom of keys)
for (let i = 0; i < totalKeys; i++) {
  const x = startX + i * keyWidth + 1;
  const label = whiteNotes[i] + octaveMarks[i];
  screen.setText(x, pianoTop + whiteKeyHeight - 1, label, labelStyle);
}

// Draw black keys (on top of white keys)
for (let oct = 0; oct < 2; oct++) {
  for (const bk of blackKeyAfter) {
    const whiteIdx = oct * 7 + bk;
    if (whiteIdx >= totalKeys - 1) continue;

    // Black key sits between two white keys
    const x = startX + whiteIdx * keyWidth + keyWidth - 1;
    const bkWidth = keyWidth - 1;

    // Draw black key body
    screen.fill(x, pianoTop + 1, bkWidth, blackKeyHeight, "\u2588", blackKey);
  }
}

// Black key labels above piano
const sharpNames = ["C#", "D#", "F#", "G#", "A#"];
for (let oct = 0; oct < 2; oct++) {
  for (let bi = 0; bi < blackKeyAfter.length; bi++) {
    const whiteIdx = oct * 7 + blackKeyAfter[bi];
    if (whiteIdx >= totalKeys - 1) continue;
    const x = startX + whiteIdx * keyWidth + keyWidth - 1;
    const label = sharpNames[bi] + (oct + 4);
    screen.setText(x, pianoTop + blackKeyHeight + 1, label, blackLabel);
  }
}

writer.render(screen);
writer.clear();
writer.write("\r\n");
writer.close();
