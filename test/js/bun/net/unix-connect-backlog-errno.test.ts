// When a unix stream socket's listen backlog is full, connect(2) on a
// non-blocking client returns EAGAIN. Bun.connect / net.createConnection
// should surface that as code "EAGAIN", matching Node.js. Previously Bun
// hard-coded ENOENT for any unix-connect failure.
//
// We can't use Bun.listen here (it accept()s eagerly, so the backlog never
// fills); we need a raw listen(fd, 1) that never accept()s. Do it via a
// child Bun process using the syscall ptr from dlopen.

import { expect, test } from "bun:test";
import { isLinux, tempDirWithFiles } from "harness";
import { rmSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

// Linux-only: the FFI sockaddr_un layout below is Linux's (no sun_len byte).
// The fix itself is platform-agnostic; this just keeps the repro simple.
test.skipIf(!isLinux)("unix connect to full backlog reports EAGAIN, not ENOENT", async () => {
  const dir = tempDirWithFiles("bun-uds", {});
  const sock = join(dir, "s.sock");

  // Child: create AF_UNIX socket, bind, listen(backlog=1), never accept.
  // Uses dlsym to reach libc directly so we control the backlog.
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "-e",
      `
      const { dlopen, ptr, CString, FFIType } = require("bun:ffi");
      const libc = dlopen(process.platform === "darwin" ? "libc.dylib" : "libc.so.6", {
        socket: { args: ["int","int","int"], returns: "int" },
        bind:   { args: ["int","ptr","int"], returns: "int" },
        listen: { args: ["int","int"], returns: "int" },
      });
      const AF_UNIX = 1, SOCK_STREAM = 1;
      const fd = libc.symbols.socket(AF_UNIX, SOCK_STREAM, 0);
      if (fd < 0) process.exit(1);
      const path = process.argv[1];
      const addr = new Uint8Array(2 + 108);
      new DataView(addr.buffer).setUint16(0, AF_UNIX, true);
      addr.set(new TextEncoder().encode(path), 2);
      if (libc.symbols.bind(fd, ptr(addr), 2 + path.length + 1) !== 0) process.exit(2);
      if (libc.symbols.listen(fd, 1) !== 0) process.exit(3);
      process.stdout.write("ready\\n");
      setInterval(() => {}, 1e6);
      `,
      sock,
    ],
    stdout: "pipe",
    stderr: "inherit",
  });

  try {
    // wait for child to be listening
    for await (const chunk of child.stdout) {
      if (new TextDecoder().decode(chunk).includes("ready")) break;
    }

    // Fill the backlog: connect repeatedly without the server accept()ing.
    // backlog=1 → kernel typically allows ~2-3 queued; the next one EAGAINs.
    let code: string | undefined;
    const held: net.Socket[] = [];
    for (let i = 0; i < 32 && !code; i++) {
      await new Promise<void>(resolve => {
        const c = net.createConnection({ path: sock });
        c.on("connect", () => {
          held.push(c);
          resolve();
        });
        c.on("error", (e: NodeJS.ErrnoException) => {
          code = e.code;
          resolve();
        });
      });
    }
    for (const c of held) c.destroy();

    expect(code).toBeDefined();
    expect(code).not.toBe("ENOENT");
    expect(code).toBe("EAGAIN");
  } finally {
    child.kill();
    await child.exited;
    rmSync(dir, { recursive: true, force: true });
  }
});
