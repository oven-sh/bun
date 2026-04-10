// Regression test for https://github.com/oven-sh/bun/issues/29112
//
// node-pty sets O_NONBLOCK on the PTY master fd and then wraps it in
// `new tty.ReadStream(fd)`. Previously, Bun's `fs.ReadStream._read`
// treated EAGAIN (expected on a non-blocking fd when no data is ready)
// as a fatal error, destroyed the stream, and closed the fd. That left
// node-pty's cached `_fd` pointing at a closed fd, so a subsequent
// `pty.resize(fd, ...)` call would throw `ioctl(2) failed, EBADF`.
//
// The fix is to retry the read on EAGAIN/EWOULDBLOCK (matching Node),
// so the stream stays alive and the fd remains valid.

import { dlopen, FFIType, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import tty from "node:tty";

const describePosix = process.platform === "win32" ? describe.skip : describe;

describePosix("issue #29112 — tty.ReadStream on non-blocking PTY fd", () => {
  // Resolve the libc symbols we need to open a PTY and drive ioctl()
  // directly. This mirrors exactly what node-pty's native addon does.
  const libc = dlopen(`libc.${process.platform === "darwin" ? "dylib" : "so.6"}`, {
    openpty: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "int" },
    close: { args: ["int"], returns: "int" },
    fcntl: { args: ["int", "int", "int"], returns: "int" },
    ioctl: { args: ["int", FFIType.u64, "ptr"], returns: "int" },
  }).symbols;

  const F_SETFL = 4;
  const O_NONBLOCK = process.platform === "darwin" ? 0x0004 : 0o4000;
  // TIOCSWINSZ (the ioctl node-pty's `resize` calls).
  const TIOCSWINSZ = process.platform === "darwin" ? 0x80087467n : 0x5414n;

  function openPty(): { parent: number; child: number } {
    const parent = new Int32Array(1);
    const child = new Int32Array(1);
    const r = libc.openpty(parent, child, null, null, null);
    if (r !== 0) throw new Error("openpty failed");
    return { parent: parent[0], child: child[0] };
  }

  function setNonblock(fd: number) {
    const r = libc.fcntl(fd, F_SETFL, O_NONBLOCK);
    if (r < 0) throw new Error("fcntl O_NONBLOCK failed");
  }

  function setWinsize(fd: number, cols: number, rows: number): number {
    // struct winsize { unsigned short ws_row, ws_col, ws_xpixel, ws_ypixel; }
    const winsize = new Uint16Array(4);
    winsize[0] = rows;
    winsize[1] = cols;
    return libc.ioctl(fd, TIOCSWINSZ, ptr(winsize));
  }

  test("EAGAIN on non-blocking PTY read does not destroy the stream or close the fd", async () => {
    const { parent, child } = openPty();
    try {
      // node-pty's native addon sets O_NONBLOCK on the master fd. This is
      // what makes fs.read return EAGAIN when no data is buffered.
      setNonblock(parent);

      // Before the fix, the first `_read` on this fd would get EAGAIN,
      // bubble up to `errorOrDestroy`, destroy the stream, and close the
      // fd — exactly what node-pty's JS wrapper tries to recover from in
      // its 'error' handler but can't, because the fd is already gone.
      const rs = new tty.ReadStream(parent);

      const closed = new Promise<void>(resolve => rs.once("close", () => resolve()));
      const errors: Error[] = [];
      rs.on("error", err => errors.push(err));
      rs.on("data", () => {});

      // Give the read loop a few event-loop turns to hit EAGAIN. Racing
      // against `close` means: if the bug is present, the stream will
      // close quickly and we observe it; if it isn't, the timeout wins.
      await Promise.race([closed, new Promise<void>(r => setImmediate(() => setImmediate(r)))]);

      // The fd must still be open — this is what node-pty's
      // `pty.resize(this._fd, cols, rows, ...)` call does. If Bun closed
      // the fd behind node-pty's back, this ioctl returns -1 / EBADF.
      const ioctlResult = setWinsize(parent, 120, 40);
      expect(ioctlResult).toBe(0);

      // And the stream itself must still be alive.
      expect(rs.destroyed).toBe(false);
      // No stream 'error' event should have surfaced from EAGAIN — the
      // fix retries the read internally instead of calling errorOrDestroy.
      expect(errors).toEqual([]);

      rs.destroy();
    } finally {
      libc.close(parent);
      libc.close(child);
    }
  });
});
