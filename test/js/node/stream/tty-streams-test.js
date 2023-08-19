import tty from "tty";

import { dlopen, suffix } from "bun:ffi";

var lazyOpenpty;
export function openpty() {
  if (!lazyOpenpty) {
    lazyOpenpty = dlopen(`libc.${suffix}`, {
      openpty: {
        args: ["ptr", "ptr", "ptr", "ptr", "ptr"],
        returns: "int",
      },
    }).symbols.openpty;
  }

  const parent_fd = new Int32Array(1).fill(0);
  const child_fd = new Int32Array(1).fill(0);

  lazyOpenpty(parent_fd, child_fd, 0, 0, 0);

  return {
    parent_fd: parent_fd[0],
    child_fd: child_fd[0],
  };
}

var lazyClose;
export function close(fd) {
  if (!lazyClose) {
    lazyClose = dlopen(`libc.${suffix}`, {
      close: {
        args: ["int"],
        returns: "int",
      },
    }).symbols.close;
  }

  lazyClose(fd);
}

describe("TTY", () => {
  it("ReadStream stdin", () => {
    const { parent_fd, child_fd } = openpty();
    const rs = new tty.ReadStream(parent_fd);
    const rs1 = tty.ReadStream(child_fd);
    expect(rs1 instanceof tty.ReadStream).toBe(true);
    expect(rs instanceof tty.ReadStream).toBe(true);
    expect(tty.isatty(rs.fd)).toBe(true);
    expect(tty.isatty(rs1.fd)).toBe(true);
    expect(rs.isRaw).toBe(false);
    expect(rs.isTTY).toBe(true);
    expect(rs.setRawMode).toBeInstanceOf(Function);
    expect(rs.setRawMode(true)).toBe(rs);
    expect(rs.isRaw).toBe(true);
    expect(rs.setRawMode(false)).toBe(rs);
    expect(rs.isRaw).toBe(false);
    close(parent_fd);
    close(child_fd);
  });
  it("WriteStream stdout", () => {
    const { child_fd, parent_fd } = openpty();
    const ws = new tty.WriteStream(child_fd);
    const ws1 = tty.WriteStream(parent_fd);
    expect(ws1 instanceof tty.WriteStream).toBe(true);
    expect(ws instanceof tty.WriteStream).toBe(true);
    expect(tty.isatty(ws.fd)).toBe(true);
    expect(ws.isTTY).toBe(true);
    // pseudo terminal, not the best test because cols and rows can be 0
    expect(ws.columns).toBeGreaterThanOrEqual(0);
    expect(ws.rows).toBeGreaterThanOrEqual(0);
    expect(ws.getColorDepth()).toBeGreaterThanOrEqual(0);
    expect(ws.hasColors(2)).toBe(true);
    close(parent_fd);
    close(child_fd);
  });
  it("process.stdio tty", () => {
    expect(process.stdin instanceof tty.ReadStream).toBe(true);
    expect(process.stdout instanceof tty.WriteStream).toBe(true);
    expect(process.stderr instanceof tty.WriteStream).toBe(true);
    expect(process.stdin.isTTY).toBe(true);
    expect(process.stdout.isTTY).toBe(true);
    expect(process.stderr.isTTY).toBe(true);
  });
  it("read and write stream prototypes", () => {
    expect(tty.ReadStream.prototype.setRawMode).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.clearLine).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.clearScreenDown).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.cursorTo).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.getColorDepth).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.getWindowSize).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.hasColors).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.hasColors).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.moveCursor).toBeInstanceOf(Function);
  });
});
