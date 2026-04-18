// When a unix stream socket's listen backlog is full, connect(2) on a
// non-blocking client returns EAGAIN. Bun.connect / net.createConnection
// should surface that as code "EAGAIN", matching Node.js. Previously Bun
// hard-coded ENOENT for any unix-connect failure.
//
// We can't use Bun.listen here (it accept()s eagerly, so the backlog never
// fills); we need a raw listen(fd, 1) that never accept()s. Do it via a
// child Bun process using the syscall ptr from dlopen.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, libcPathForDlopen, tempDir } from "harness";
import net from "node:net";
import { join } from "node:path";

// Linux-only: the FFI sockaddr_un layout below is Linux's (no sun_len byte).
// The fix itself is platform-agnostic; this just keeps the repro simple.
test.skipIf(!isLinux)("unix connect to full backlog reports EAGAIN, not ENOENT", async () => {
  using dir = tempDir("bun-uds", {});
  const sock = join(String(dir), "s.sock");

  // Child: create AF_UNIX socket, bind, listen(backlog=1), never accept.
  // Uses dlsym to reach libc directly so we control the backlog.
  await using child = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { dlopen, ptr } = require("bun:ffi");
      const libc = dlopen(${JSON.stringify(libcPathForDlopen())}, {
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
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the child to be listening. If the child exits before writing
  // the sentinel, fail fast with its diagnostic output instead of a
  // misleading connect error below.
  let ready = false;
  let stdout = "";
  for await (const chunk of child.stdout) {
    stdout += new TextDecoder().decode(chunk);
    if (stdout.includes("ready")) {
      ready = true;
      break;
    }
  }
  if (!ready) {
    const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
    throw new Error(`helper exited (${exitCode}) before listening:\n${stderr}`);
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
});

test.skipIf(!isLinux)("unix connect to regular file (no listener) reports ECONNREFUSED, not ENOENT", async () => {
  using dir = tempDir("bun-uds-refused", { "s.sock": "" });
  const sock = join(String(dir), "s.sock");

  const { promise, resolve } = Promise.withResolvers<string | undefined>();
  const c = net.createConnection({ path: sock });
  c.on("connect", () => {
    c.destroy();
    resolve(undefined);
  });
  c.on("error", (e: NodeJS.ErrnoException) => resolve(e.code));
  const code = await promise;

  expect(code).toBe("ECONNREFUSED");
});

// Regression guard for the TCP async path: before the SO_ERROR fix in
// us_internal_socket_after_open, the poll loop delivered a boolean `1` to
// handleConnectError, which the new errno mapping would have surfaced as
// EPERM. Connecting to a port with no listener on loopback must yield
// ECONNREFUSED on POSIX.
test.skipIf(!isPosix)("tcp connect to closed port reports ECONNREFUSED, not EPERM", async () => {
  // Find a port with no listener by briefly binding and then closing.
  const probe = net.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      probe.close(() => resolve((addr as net.AddressInfo).port));
    });
  });

  const { promise, resolve } = Promise.withResolvers<string | undefined>();
  const c = net.createConnection({ host: "127.0.0.1", port });
  c.on("connect", () => {
    c.destroy();
    resolve(undefined);
  });
  c.on("error", (e: NodeJS.ErrnoException) => resolve(e.code));
  const code = await promise;

  expect(code).not.toBe("EPERM");
  expect(code).toBe("ECONNREFUSED");
});
