// https://github.com/oven-sh/bun/issues/5305
//
// When stdin is a TTY and a readline interface is reading from it, a raw
// fs.readSync(0, ...) must fail with EAGAIN (matching Node/libuv) instead of
// blocking on the original file description and stealing bytes from readline.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

const fixture = /* js */ `
  const fs = require("fs");
  const readline = require("readline");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: "",
  });
  rl.on("line", l => {
    process.stdout.write("LINE:" + l + "\\n");
    process.exit(0);
  });

  // No input has been written yet. With fd 0 left blocking this call parks
  // forever; with it reopened nonblocking (libuv behaviour) it throws EAGAIN.
  const buf = Buffer.alloc(64);
  let result;
  try {
    const n = fs.readSync(0, buf, 0, 1);
    result = "OK:" + n + ":" + buf.toString("utf8", 0, n);
  } catch (e) {
    result = "THREW:" + (e && e.code);
  }
  process.stdout.write("READSYNC_" + result + "\\n");
`;

test.skipIf(isWindows)(
  "fs.readSync(0) does not steal bytes from readline on a TTY",
  async () => {
    let received = "";
    const waiters: { token: string; resolve: () => void }[] = [];
    const waitFor = (token: string) => {
      if (received.includes(token)) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      waiters.push({ token, resolve });
      return promise;
    };

    await using terminal = new Bun.Terminal({
      data(_term, chunk: Uint8Array) {
        received += Buffer.from(chunk).toString("utf8");
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (received.includes(waiters[i].token)) {
            waiters.splice(i, 1)[0].resolve();
          }
        }
      },
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-install", "-e", fixture],
      env: { ...bunEnv, NO_COLOR: "1" },
      terminal,
    });

    // Don't write anything until the child has gotten past readSync. Without
    // the fix readSync blocks and this await never resolves, so the test fails
    // on timeout rather than a racy assertion.
    await waitFor("READSYNC_");

    terminal.write("abcdef\r");
    await waitFor("LINE:");
    await proc.exited;

    const stripped = Bun.stripANSI(received).replaceAll("\r", "");
    const readsync = stripped.match(/READSYNC_[A-Z]+:[^\n]*/)?.[0];
    const line = stripped.match(/LINE:[^\n]*/)?.[0];

    expect({ readsync, line, exitCode: proc.exitCode }).toEqual({
      readsync: "READSYNC_THREW:EAGAIN",
      line: "LINE:abcdef",
      exitCode: 0,
    });
  },
  15000,
);
