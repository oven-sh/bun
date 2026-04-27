import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

test("Blob.arrayBuffer copy-on-write is not shared", async () => {
  // 8 MB is the threshold for copy-on-write without --smol.
  const bytes = new Uint8Array((1024 * 1024 * 8 * 1.5) | 0);
  bytes.fill(42);
  bytes[bytes.length - 100] = 43;
  const blob = new Blob([bytes]);
  bytes.fill(8);

  const buf = new Uint8Array(await blob.arrayBuffer());
  expect(buf.length).toBe(blob.size);
  expect(buf[0]).toBe(42);
  expect(buf[buf.length - 1]).toBe(42);

  buf[0] = 0;

  const buf2 = new Uint8Array(await blob.arrayBuffer());
  expect(buf2[0]).toBe(42);
  buf2[0] = 1;
  expect(buf2[buf.length - 1]).toBe(42);

  const buf3 = new Uint8Array(await blob.slice(0, 1).arrayBuffer());
  expect(buf3[0]).toBe(42);
  buf3[0] = 2;
  expect(buf3.length).toBe(1);

  const buf4 = new Uint8Array(await blob.slice(blob.size - 100).arrayBuffer());
  expect(buf4[0]).toBe(43);
  buf4[0] = 3;
  expect(buf4.length).toBe(100);

  expect(buf[0]).toBe(0);
  expect(buf2[0]).toBe(1);
  expect(buf3[0]).toBe(2);
  expect(buf4[0]).toBe(3);
});

test.skipIf(!isLinux)("Blob finalizer does not SIGBUS when memfd is truncated", async () => {
  // Large blobs on Linux are backed by a memfd + shared mmap. If user code
  // truncates that memfd via the fd, the mapping has pages with no backing
  // store. Freeing the store must not write to those pages.
  const src = /* js */ `
    const { fstatSync, ftruncateSync } = require("node:fs");
    function create() {
      // Over the 8 MB memfd threshold.
      new Blob(new Uint8Array(16 * 1024 * 1024));
    }
    create();
    let fd = -1;
    for (let i = 0; i < 64; i++) {
      try {
        if (fstatSync(i).size === 16 * 1024 * 1024) { fd = i; break; }
      } catch {}
    }
    if (fd === -1) {
      console.log("SKIP");
      process.exit(0);
    }
    ftruncateSync(fd, 0);
    Bun.gc(true);
    console.log("OK");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Sanitizer");
  expect(stdout.trim()).toMatch(/^(OK|SKIP)$/);
  expect(exitCode).toBe(0);
});
