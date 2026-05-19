// Regression test for https://github.com/oven-sh/bun/issues/29112 (and #27285,
// #25822 which share the same root cause).
//
// node-pty sets O_NONBLOCK on the PTY master fd and then wraps it in
// `new tty.ReadStream(fd)`. Bun's `tty.ReadStream` was backed by
// `fs.ReadStream`, whose threadpool `fs.read` returns EAGAIN on a non-blocking
// fd when no data is buffered. That EAGAIN bubbled up to `errorOrDestroy`,
// destroyed the stream, and closed the fd — after which node-pty's cached
// `_fd` pointed at a closed descriptor and `pty.resize(fd)` (`ioctl(fd,
// TIOCSWINSZ, …)`) threw `ioctl(2) failed, EBADF`.
//
// This test is scoped to Linux on purpose:
//   - On Windows there is no openpty / libc.so.6 to dlopen. `describe.skipIf`
//     still executes the suite body at collection time, so any Windows guard
//     must live at module scope — hence the early top-level test() below.
//   - On macOS the pty line discipline + threadpool-read timing are different
//     enough that the probe loop is flaky on aarch64 runners. Linux is where
//     the original bug was filed and where the failure mode is easy to pin
//     down; the fix itself (in src/js/node/tty.ts) runs unchanged on every
//     POSIX target.

import { test } from "bun:test";
import { isLinux } from "harness";

if (!isLinux) {
  test.skip("issue #29112 — tty.ReadStream on non-blocking PTY fd (Linux only)", () => {});
} else {
  // Everything below is Linux-only. Imports that would crash on Windows
  // (libc.so.6/libutil.so.1 dlopen) live inside this branch so they are never
  // executed on other platforms.
  const { dlopen, FFIType, ptr } = require("bun:ffi");
  const { describe, expect } = require("bun:test");
  const { writeSync } = require("node:fs");
  const tty = require("node:tty");

  describe("issue #29112 — tty.ReadStream on non-blocking PTY fd", () => {
    // On glibc Linux, openpty historically lived in libutil (it moved into
    // libc only in glibc 2.34), so load it from libutil.so.1 to support older
    // distros too. On musl Linux (e.g. Alpine) there's no separate libutil —
    // openpty is in musl libc — and the SONAME is `libc.musl-<arch>.so.1`
    // rather than `libc.so.6`. Try the glibc paths first and fall back.
    function tryOpen<T extends Record<string, any>>(candidates: string[], symbols: T) {
      let lastErr: unknown;
      for (const lib of candidates) {
        try {
          return (dlopen(lib, symbols) as any).symbols;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    }

    const muslArch =
      process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : (process.arch as string);
    const libc = tryOpen(["libc.so.6", `libc.musl-${muslArch}.so.1`], {
      close: { args: ["int"], returns: "int" },
      fcntl: { args: ["int", "int", "int"], returns: "int" },
      ioctl: { args: ["int", FFIType.u64, "ptr"], returns: "int" },
    });
    const libutil = tryOpen(["libutil.so.1", `libc.musl-${muslArch}.so.1`], {
      openpty: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "int" },
    });

    const F_SETFL = 4;
    const O_NONBLOCK = 0o4000;
    const TIOCSWINSZ = 0x5414n;

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
      let rs: ReturnType<typeof tty.ReadStream> | undefined;
      try {
        // node-pty's native addon sets O_NONBLOCK on the master fd. This is
        // what makes fs.read return EAGAIN when no data is buffered.
        setNonblock(parent);

        // Before the fix, the first `_read` on this fd would go to the
        // threadpool, get EAGAIN, bubble up to `errorOrDestroy`, destroy
        // the stream, and close the fd — exactly what node-pty's JS
        // wrapper tries to recover from in its 'error' handler but can't,
        // because the fd is already gone.
        rs = new tty.ReadStream(parent);

        const closed = new Promise<void>(resolve => rs!.once("close", () => resolve()));
        const errors: Error[] = [];
        const chunks: Buffer[] = [];
        rs.on("error", err => errors.push(err));
        rs.on("data", chunk => chunks.push(Buffer.from(chunk)));

        // The bug path runs entirely off-main: _read schedules a threadpool
        // fs.read, the worker calls pread(), pread returns EAGAIN, the
        // worker posts the callback back to the main thread, the callback
        // invokes errorOrDestroy → destroy → close, and close goes back to
        // the threadpool to actually close(fd). A handful of `setImmediate`
        // turns isn't enough to guarantee that whole chain has run.
        // Actively probe both outcomes: either the stream ends (bug) or we
        // complete enough polls that the initial EAGAIN has definitely
        // been handled (fix). Any poll that sees the stream dead, or that
        // sees ioctl fail with EBADF, is an immediate regression signal.
        // We also race against the "close" event to exit as soon as the
        // buggy build tears down.
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
      } finally {
        // Destroy the stream before closing the fds so the custom `fs`
        // wrapper's retry loop sees `stream.destroyed` and stops — otherwise
        // a pending `setTimeout(retry)` could fire against an already-closed
        // fd and produce noisy EBADF output that obscures the real failure.
        rs?.destroy();
        libc.close(parent);
        libc.close(child);
      }
    });
  });
}
