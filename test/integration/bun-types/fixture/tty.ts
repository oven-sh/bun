import * as tty from "tty";

const rs = new tty.ReadStream(234, {
  allowHalfOpen: true,
  readable: true,
  signal: new AbortSignal(),
  writable: true,
});

const ws = new tty.WriteStream(234);

process.stdin.setRawMode(true);
process.stdin.setRawMode(false);
process.stdin.isRaw;
process.stdin.setRawMode(true).isRaw;

rs.isRaw;
rs.setRawMode(true);
rs.setRawMode(false);
rs.setRawMode(true).isRaw;
rs.isTTY;

ws.isPaused;
ws.isTTY;
ws.bytesWritten;
ws.bytesRead;
ws.columns;
ws.rows;
ws.isTTY;
ws.clearLine(1);
ws.clearLine(0);
ws.clearScreenDown();
ws.cursorTo(1);
ws.cursorTo(1, 2);
ws.cursorTo(1, () => {});
ws.cursorTo(1, 2, () => {});
ws.moveCursor(1, 2);
ws.moveCursor(1, 2, () => {});
ws.clearLine(1, () => {});
ws.clearLine(0, () => {});
ws.clearScreenDown(() => {});
ws.cursorTo(1, () => {});

process.stdout.clearLine;
process.stdout.clearScreenDown;
process.stdout.cursorTo;
process.stdout.moveCursor;
process.stdout.getColorDepth;
process.stdout.getWindowSize;
