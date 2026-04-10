import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

test.skipIf(isWindows)("tty.ReadStream extends net.Socket with a native TTY _handle", async () => {
  // Under a PTY so process.stdin is a tty.ReadStream.
  await using proc = Bun.spawn({
    cmd: [
      "script",
      "-q",
      "/dev/null",
      bunExe(),
      "-e",
      `
        const net = require("net");
        const tty = require("tty");
        const { Duplex, Readable } = require("stream");
        const s = process.stdin;
        const out = {
          isReadStream: s instanceof tty.ReadStream,
          isSocket: s instanceof net.Socket,
          isDuplex: s instanceof Duplex,
          isReadable: s instanceof Readable,
          protoChain: Object.getPrototypeOf(tty.ReadStream.prototype) === net.Socket.prototype,
          handle: s._handle?.constructor.name,
          hwm: s.readableHighWaterMark,
          handleMethods: ["readStart", "readStop", "setRawMode", "getWindowSize", "ref", "unref", "close"].every(
            m => typeof s._handle?.[m] === "function"
          ),
        };
        process.stdout.write(JSON.stringify(out));
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const json = stdout.slice(stdout.indexOf("{"));
  expect(JSON.parse(json)).toEqual({
    isReadStream: true,
    isSocket: true,
    isDuplex: true,
    isReadable: true,
    protoChain: true,
    handle: "TTY",
    hwm: 0,
    handleMethods: true,
  });
  expect(exitCode).toBe(0);
});
