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
import { isMusl, isWindows } from "harness";
import { writeSync } from "node:fs";
import tty from "node:tty";

// `describe.skipIf` — *not* `describe.skip` — because `bun:test` still executes
// the suite callback for `describe.skip` to register the nested tests, and we
// must not touch `dlopen("libc.so.6")` on Windows.
const describePosix = describe.skipIf(isWindows);

// Resolve the libraries node-pty's native addon touches. On Darwin everything
// is in libc.dylib. On glibc Linux, openpty(3) historically lived in libutil
// (it moved into libc only in glibc 2.34), so load it from libutil.so.1 to
// support older distros too. On musl Linux (e.g. Alpine) there is no separate
// libutil — openpty is in musl libc — and the SONAME is
// `libc.musl-<arch>.so.1` rather than `libc.so.6`.
function resolveLibPaths(): { libcPath: string; openptyLibPath: string } {
  if (process.platform === "darwin") {
    return { libcPath: "libc.dylib", openptyLibPath: "libc.dylib" };
  }
  if (isMusl) {
    const muslArch =
      process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : (process.arch as string);
    const muslLibc = `libc.musl-${muslArch}.so.1`;
    return { libcPath: muslLibc, openptyLibPath: muslLibc };
  }
  return { libcPath: "libc.so.6", openptyLibPath: "libutil.so.1" };
}

describePosix("issue #29112 — tty.ReadStream on non-blocking PTY fd", () => {
  const { libcPath, openptyLibPath } = resolveLibPaths();

  const libc = dlopen(libcPath, {
    close: { args: ["int"], returns: "int" },
    fcntl: { args: ["int", "int", "int"], returns: "int" },
    ioctl: { args: ["int", FFIType.u64, "ptr"], returns: "int" },
  }).symbols;

  const libutil = dlopen(openptyLibPath, {
    openpty: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "int" },
  }).symbols;

  const F_SETFL = 4;
  const O_NONBLOCK = process.platform === "darwin" ? 0x0004 : 0o4000;
  // TIOCSWINSZ (the ioctl node-pty's `resize` calls).
  const TIOCSWINSZ = process.platform === "darwin" ? 0x80087467n : 0x5414n;

  function openPty(): { parent: number; child: number } {
    const parent = new Int32Array(1);
    const child = new Int32Array(1);
    const r = libutil.openpty(parent, child, null, null, null);
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

      // Before the fix, the first `_read` on this fd would go to the
      // threadpool, get EAGAIN, bubble up to `errorOrDestroy`, destroy
      // the stream, and close the fd — exactly what node-pty's JS
      // wrapper tries to recover from in its 'error' handler but can't,
      // because the fd is already gone.
      const rs = new tty.ReadStream(parent);

      const closed = new Promise<void>(resolve => rs.once("close", () => resolve()));
      const errors: Error[] = [];
      const chunks: Buffer[] = [];
      rs.on("error", err => errors.push(err));
      rs.on("data", chunk => chunks.push(Buffer.from(chunk)));

      // The bug path runs entirely off-main: _read schedules a threadpool
      // fs.read, the worker calls pread(), pread returns EAGAIN, the
      // worker posts the callback back to the main thread, the callback
      // invokes errorOrDestroy → destroy → close, and close goes back to
      // the threadpool to actually close(fd). Two `setImmediate` turns
      // isn't enough to guarantee that whole chain has run. Instead,
      // actively probe both outcomes: either the stream ends (bug) or we
      // complete enough polls that the initial EAGAIN has definitely
      // been handled (fix). Any poll that sees the stream dead, or that
      // sees ioctl fail with EBADF, is an immediate regression signal —
      // we don't need to wait the full budget. We also race against the
      // "close" event to exit as soon as the buggy build tears down.
      const deadline = Date.now() + 1000;
      let raceWinner: "poll" | "close" = "poll";
      for (;;) {
        const winner = await Promise.race([
          closed.then(() => "close" as const),
          new Promise<"poll">(r => setImmediate(() => r("poll"))),
        ]);
        if (winner === "close") {
          raceWinner = "close";
          break;
        }
        // Probe: is the stream destroyed? Did the fd go bad under us?
        if (rs.destroyed) break;
        if (setWinsize(parent, 80, 24) !== 0) break;
        if (Date.now() >= deadline) break;
      }

      // After the probe loop, the fix should leave the stream alive and
      // the fd valid. The buggy build tears both down inside the loop.
      expect(raceWinner).toBe("poll");
      expect(rs.destroyed).toBe(false);

      // This is exactly what node-pty's `pty.resize(this._fd, cols, rows, ...)`
      // does. If Bun closed the fd behind node-pty's back, this returns -1
      // with errno == EBADF.
      expect(setWinsize(parent, 120, 40)).toBe(0);

      // Reads must actually resume after the initial EAGAIN — not just
      // "the stream stays alive". This is what #25822 observed: `onData`
      // never firing even though the fd was technically still open. Push
      // bytes through the slave side and poll the event loop until they
      // arrive on the master ReadStream.
      writeSync(child, "hello-29112\n");
      const chunksDeadline = Date.now() + 2000;
      while (chunks.length === 0 && Date.now() < chunksDeadline) {
        await new Promise<void>(r => setImmediate(r));
      }
      expect(chunks.length).toBeGreaterThan(0);
      expect(Buffer.concat(chunks).toString()).toContain("hello-29112");

      // No stream 'error' event should have surfaced from EAGAIN — the
      // fix retries the read inside the custom fs wrapper instead of
      // calling errorOrDestroy.
      expect(errors).toEqual([]);

      rs.destroy();
    } finally {
      libc.close(parent);
      libc.close(child);
    }
  });
});
