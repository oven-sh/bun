import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import child_process from "node:child_process";
import http from "node:http";
import { Readable } from "node:stream";
import tls from "node:tls";
import zlib from "node:zlib";

// Codes whose messages come from the fixed-template table behind $ERR_*.
function capture(fn: () => unknown): string {
  try {
    fn();
  } catch (e: any) {
    return `${e.code} | ${e.name} | ${e.message}`;
  }
  return "no throw";
}

test("table-driven ERR_* codes keep their exact messages", () => {
  expect(capture(() => zlib.createBrotliCompress({ params: { 99999: 1 } }))).toBe(
    "ERR_BROTLI_INVALID_PARAM | RangeError | 99999 is not a valid Brotli parameter",
  );
  expect(capture(() => zlib.zstdCompressSync("x", { params: { 99999: 1 } }))).toBe(
    "ERR_ZSTD_INVALID_PARAM | RangeError | 99999 is not a valid zstd parameter",
  );
  expect(capture(() => http.validateHeaderName("bad header"))).toBe(
    'ERR_INVALID_HTTP_TOKEN | TypeError | Header name must be a valid HTTP token ["bad header"]',
  );
  expect(capture(() => tls.createSecureContext({ minVersion: "TLSv9" as any }))).toBe(
    "ERR_TLS_INVALID_PROTOCOL_VERSION | TypeError | TLSv9 is not a valid minimum TLS protocol version",
  );
  expect(capture(() => child_process.fork("x", { stdio: ["pipe", "pipe", "pipe"] }))).toBe(
    "ERR_CHILD_PROCESS_IPC_REQUIRED | Error | Forked processes must have an IPC channel, missing value 'ipc' in options.stdio",
  );
  expect(capture(() => Readable.prototype._read.call(new Readable()))).toBe(
    "ERR_METHOD_NOT_IMPLEMENTED | Error | The _read() method is not implemented",
  );
});

// An error message renders a value through the inspector, and the inspector
// reads native accessors. An accessor whose own message renders the same
// receiver lands back in the message builder, which reads every accessor
// again. `vm.Script.prototype` has four such accessors, so the work multiplied
// by four at every level and the process never finished: 100% CPU, flat RSS.
// `determineSpecificType` reaches the same inspector when `constructor` is
// falsy, so an object that inherits such accessors hangs the same way.
//
// The child gets a kill switch so a regression fails these assertions instead
// of hanging the test runner.
test("a value rendered into an error message does not re-enter the inspector", async () => {
  const script = `
    const vm = require("node:vm");
    const { MIMEType } = require("node:util");

    console.log(Bun.inspect(vm.Script.prototype).includes("cachedDataRejected"));

    const mime = Object.create(MIMEType.prototype);
    Object.defineProperty(mime, "constructor", { value: null });
    console.log(Bun.inspect(mime).includes("subtype"));

    let code = "no throw";
    try {
      mime.type;
    } catch (e) {
      code = e.code;
    }
    console.log(code);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
    killSignal: "SIGKILL",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("true\ntrue\nERR_INVALID_THIS\n");
  expect(exitCode).toBe(0);
});
