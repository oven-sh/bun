import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("new tls.TLSSocket(socket, { isServer: true }) does not call a replaced Symbol.for", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const tls = require("node:tls"), { Duplex } = require("node:stream");
      const original = Symbol.for, keys = [];
      Symbol.for = function (key) { keys.push(key); return original.call(Symbol, key); };
      new tls.TLSSocket(new Duplex({ read() {}, write(chunk, encoding, done) { done(); } }), { isServer: true });
      Symbol.for = original;
      console.log(keys.filter(key => key.startsWith("::bun")).join() || "none");
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "none\n", stderr: "", exitCode: 0 });
});
