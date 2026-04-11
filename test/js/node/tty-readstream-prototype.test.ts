import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// `script` gives us a real PTY so process.stdin takes the tty.ReadStream path.
// Alpine musl images don't ship util-linux `script`, and there's no /dev/tty
// equivalent on Windows — skip on both.
const scriptPath = Bun.which("script");

test.skipIf(isWindows || !scriptPath)("tty.ReadStream extends net.Socket with a native TTY _handle", async () => {
  const probe = `
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
    process.stdout.write("\\n<<<JSON" + JSON.stringify(out) + "JSON>>>\\n");
    process.exit(0);
  `;
  const inner = `${bunExe()} -e ${JSON.stringify(probe)}`;
  // BSD script (macOS): script -q /dev/null <cmd> <args...>
  // util-linux script:  script -q -c "<command>" /dev/null
  const cmd =
    process.platform === "darwin"
      ? [scriptPath!, "-q", "/dev/null", "sh", "-c", inner]
      : [scriptPath!, "-q", "-c", inner, "/dev/null"];

  await using proc = Bun.spawn({ cmd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const m = stdout.match(/<<<JSON(.*?)JSON>>>/s);
  expect(m?.[1], `no JSON in stdout; stdout=${JSON.stringify(stdout)}`).toBeString();
  expect(JSON.parse(m![1])).toEqual({
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
