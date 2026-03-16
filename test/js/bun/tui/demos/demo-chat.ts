/**
 * demo-chat.ts — Chat Interface
 *
 * A polished chat interface with message bubbles, timestamps, an input field
 * with a blinking cursor, typing indicators, and a simulated bot.
 *
 * Run: bun run test/js/bun/tui/demos/demo-chat.ts
 * Controls: Type to compose, Enter to send, Up/Down to scroll, Ctrl+C to quit
 */

const writer = new Bun.TUITerminalWriter(Bun.stdout);
const reader = new Bun.TUIKeyReader();
let cols = writer.columns || 80;
let rows = writer.rows || 24;
let screen = new Bun.TUIScreen(cols, rows);

writer.enterAltScreen();
writer.enableBracketedPaste();

// --- Styles ---
const st = {
  titleBar: screen.style({ fg: 0x000000, bg: 0x98c379, bold: true }),
  myBg: screen.style({ fg: 0xffffff, bg: 0x2d5a9e }),
  myName: screen.style({ fg: 0xa8d0ff, bg: 0x2d5a9e, bold: true }),
  myTime: screen.style({ fg: 0x7cacd6, bg: 0x2d5a9e }),
  theirBg: screen.style({ fg: 0xdcdcdc, bg: 0x383838 }),
  theirName: screen.style({ fg: 0x98c379, bg: 0x383838, bold: true }),
  theirTime: screen.style({ fg: 0x777777, bg: 0x383838 }),
  systemMsg: screen.style({ fg: 0x5c6370, italic: true }),
  inputBorder: screen.style({ fg: 0x61afef }),
  inputText: screen.style({ fg: 0xffffff }),
  inputPlaceholder: screen.style({ fg: 0x5c6370, italic: true }),
  online: screen.style({ fg: 0x98c379, bold: true }),
  typing: screen.style({ fg: 0xe5c07b, italic: true }),
};

// --- Data ---
interface Message {
  sender: string;
  text: string;
  time: Date;
  isMe: boolean;
  isSystem?: boolean;
}

const messages: Message[] = [
  { sender: "", text: "Welcome to Bun TUI Chat!", time: new Date(), isMe: false, isSystem: true },
  {
    sender: "Bun Bot",
    text: "Hey! I'm a demo bot. Try sending me a message!",
    time: new Date(Date.now() - 60000),
    isMe: false,
  },
  {
    sender: "Bun Bot",
    text: "This chat is built with Bun.TUIScreen and Bun.TUIKeyReader. The message bubbles use fill() for backgrounds and setText() for content.",
    time: new Date(Date.now() - 30000),
    isMe: false,
  },
];

let inputText = "";
let inputCursor = 0;
let scrollOffset = 0;
let typingTimer: ReturnType<typeof setTimeout> | null = null;
let showTyping = false;

const botReplies = [
  "That's cool! The TUI library uses Ghostty's cell grid internally.",
  "Try resizing the terminal — the layout adapts automatically!",
  "The diff renderer only updates changed cells. Super efficient!",
  "Each style is interned with a numeric ID. Up to 4096 unique styles.",
  "Did you know? The renderer uses synchronized update markers to prevent flicker.",
  "Mouse tracking is supported too — check out demo-mouse!",
  "You can use hyperlinks in the terminal with screen.hyperlink()!",
  "Nice message! The word wrapping handles long text gracefully.",
];

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let cur = "";
    for (const word of words) {
      if (cur.length === 0) {
        cur = word;
      } else if (cur.length + 1 + word.length <= width) {
        cur += " " + word;
      } else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur.length > 0) lines.push(cur);
  }
  return lines.length > 0 ? lines : [""];
}

function sendMessage(text: string) {
  if (text.trim().length === 0) return;
  messages.push({ sender: "You", text: text.trim(), time: new Date(), isMe: true });
  inputText = "";
  inputCursor = 0;
  scrollOffset = 0;
  showTyping = true;
  render();

  typingTimer = setTimeout(
    () => {
      showTyping = false;
      messages.push({
        sender: "Bun Bot",
        text: botReplies[Math.floor(Math.random() * botReplies.length)],
        time: new Date(),
        isMe: false,
      });
      scrollOffset = 0;
      render();
    },
    600 + Math.random() * 1000,
  );
}

// --- Render ---
function render() {
  screen.clear();

  // Title bar
  screen.fill(0, 0, cols, 1, " ", st.titleBar);
  screen.setText(2, 0, " Chat ", st.titleBar);
  const onlineText = "\u25cf Online";
  screen.setText(cols - onlineText.length - 2, 0, onlineText, st.online);

  // Input box (bottom 3 rows)
  const inputY = rows - 3;
  screen.drawBox(0, inputY, cols, 3, { style: "rounded", styleId: st.inputBorder });
  if (inputText.length > 0) {
    screen.setText(2, inputY + 1, inputText.slice(0, cols - 4), st.inputText);
  } else {
    screen.setText(2, inputY + 1, "Type a message...", st.inputPlaceholder);
  }

  // Typing indicator
  const typingY = showTyping ? inputY - 1 : inputY;
  if (showTyping) {
    screen.setText(2, inputY - 1, "Bun Bot is typing...", st.typing);
  }

  // Message area
  const msgTop = 1;
  const msgBot = typingY;
  const msgH = msgBot - msgTop;
  if (msgH <= 0) {
    writer.render(screen, {
      cursorVisible: true,
      cursorX: 2 + inputCursor,
      cursorY: inputY + 1,
      cursorStyle: "line",
      cursorBlinking: true,
    });
    return;
  }

  const bubbleMaxW = Math.min(Math.floor(cols * 0.7), cols - 6);

  // Build rendered lines for all messages
  interface RenderedLine {
    x: number;
    width: number;
    text: string;
    style: number;
  }
  const allLines: RenderedLine[][] = []; // each message = array of rendered lines

  for (const msg of messages) {
    const msgLines: RenderedLine[] = [];
    if (msg.isSystem) {
      const line = `\u2500\u2500 ${msg.text} \u2500\u2500`;
      msgLines.push({
        x: Math.max(0, Math.floor((cols - line.length) / 2)),
        width: line.length,
        text: line,
        style: st.systemMsg,
      });
    } else {
      const textW = bubbleMaxW - 4;
      const wrapped = wrapText(msg.text, textW);
      const contentW = Math.max(...wrapped.map(l => l.length), msg.sender.length + formatTime(msg.time).length + 3);
      const bubbleW = Math.min(bubbleMaxW, contentW + 4);
      const bx = msg.isMe ? cols - bubbleW - 1 : 1;
      const bgSt = msg.isMe ? st.myBg : st.theirBg;
      const nameSt = msg.isMe ? st.myName : st.theirName;
      const timeSt = msg.isMe ? st.myTime : st.theirTime;

      // Name + time line (with bg fill)
      const timeStr = formatTime(msg.time);
      msgLines.push({ x: bx, width: bubbleW, text: `__BG__`, style: bgSt }); // background marker
      msgLines[msgLines.length - 1] = { x: bx, width: bubbleW, text: "", style: bgSt }; // fill bg
      // We'll render name and time separately
      msgLines.push({ x: bx + 2, width: 0, text: msg.sender, style: nameSt });
      msgLines.push({ x: bx + bubbleW - timeStr.length - 2, width: 0, text: timeStr, style: timeSt });

      // Text lines
      for (const line of wrapped) {
        msgLines.push({ x: bx, width: bubbleW, text: "", style: bgSt }); // bg
        msgLines.push({ x: bx + 2, width: 0, text: line, style: bgSt }); // text
      }
    }
    allLines.push(msgLines);
  }

  // Calculate per-message rendered heights
  const msgRenderedH: number[] = messages.map((msg, i) => {
    if (msg.isSystem) return 1;
    const textW = bubbleMaxW - 4;
    return wrapText(msg.text, textW).length + 1; // +1 for name row
  });

  // Render from bottom up with scroll
  let drawY = msgBot - 1 + scrollOffset;
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const msg = messages[mi];
    const h = msgRenderedH[mi];
    const topRow = drawY - h + 1;

    if (topRow < msgBot && drawY >= msgTop) {
      if (msg.isSystem) {
        if (drawY >= msgTop && drawY < msgBot) {
          const line = `\u2500\u2500 ${msg.text} \u2500\u2500`;
          screen.setText(Math.max(0, Math.floor((cols - line.length) / 2)), drawY, line, st.systemMsg);
        }
      } else {
        const textW = bubbleMaxW - 4;
        const wrapped = wrapText(msg.text, textW);
        const contentW = Math.max(...wrapped.map(l => l.length), msg.sender.length + formatTime(msg.time).length + 3);
        const bubbleW = Math.min(bubbleMaxW, contentW + 4);
        const bx = msg.isMe ? cols - bubbleW - 1 : 1;
        const bgSt = msg.isMe ? st.myBg : st.theirBg;
        const nameSt = msg.isMe ? st.myName : st.theirName;
        const timeSt = msg.isMe ? st.myTime : st.theirTime;

        // Fill bubble background
        for (let r = 0; r < h; r++) {
          const ry = topRow + r;
          if (ry >= msgTop && ry < msgBot) {
            screen.fill(bx, ry, bubbleW, 1, " ", bgSt);
          }
        }

        // Name + time
        if (topRow >= msgTop && topRow < msgBot) {
          screen.setText(bx + 2, topRow, msg.sender, nameSt);
          const timeStr = formatTime(msg.time);
          screen.setText(bx + bubbleW - timeStr.length - 2, topRow, timeStr, timeSt);
        }

        // Text
        for (let li = 0; li < wrapped.length; li++) {
          const ry = topRow + 1 + li;
          if (ry >= msgTop && ry < msgBot) {
            screen.setText(bx + 2, ry, wrapped[li], bgSt);
          }
        }
      }
    }
    drawY = topRow - 1; // 1-line gap between messages
  }

  writer.render(screen, {
    cursorX: 2 + Math.min(inputCursor, cols - 4),
    cursorY: inputY + 1,
    cursorVisible: true,
    cursorStyle: "line",
    cursorBlinking: true,
  });
}

// --- Input ---
reader.onkeypress = (event: { name: string; ctrl: boolean; alt: boolean }) => {
  const { name, ctrl, alt } = event;

  if (ctrl && name === "c") {
    cleanup();
    return;
  }

  switch (name) {
    case "enter":
      sendMessage(inputText);
      break;
    case "backspace":
      if (inputCursor > 0) {
        inputText = inputText.slice(0, inputCursor - 1) + inputText.slice(inputCursor);
        inputCursor--;
      }
      break;
    case "delete":
      if (inputCursor < inputText.length)
        inputText = inputText.slice(0, inputCursor) + inputText.slice(inputCursor + 1);
      break;
    case "left":
      if (inputCursor > 0) inputCursor--;
      break;
    case "right":
      if (inputCursor < inputText.length) inputCursor++;
      break;
    case "home":
      inputCursor = 0;
      break;
    case "end":
      inputCursor = inputText.length;
      break;
    case "up":
      scrollOffset += 2;
      break;
    case "down":
      scrollOffset = Math.max(0, scrollOffset - 2);
      break;
    default:
      if (!ctrl && !alt && name.length === 1) {
        inputText = inputText.slice(0, inputCursor) + name + inputText.slice(inputCursor);
        inputCursor++;
      }
      break;
  }
  render();
};

reader.onpaste = (text: string) => {
  const line = text.split("\n")[0];
  inputText = inputText.slice(0, inputCursor) + line + inputText.slice(inputCursor);
  inputCursor += line.length;
  render();
};

writer.onresize = (c: number, r: number) => {
  cols = c;
  rows = r;
  screen.resize(cols, rows);
  render();
};

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  if (typingTimer) clearTimeout(typingTimer);
  writer.disableBracketedPaste();
  reader.close();
  writer.exitAltScreen();
  writer.close();
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

render();
