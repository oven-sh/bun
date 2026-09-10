import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import child_process from "node:child_process";
import http from "node:http";
import { totalmem } from "node:os";
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

// A message that embeds a value the user controls can pass WTF::String::MaxLength
// (2^31-1 characters). The message builder used to abort the process there. It must throw
// the catchable error Node gets from V8 ("Invalid string length") instead, which JSC
// spells "Out of memory". The two children commit ~2.2GB and ~4.4GB (the 2^31 character
// value, plus its rendering in the second), so skip on machines without the headroom.
const enoughMemory = totalmem() >= 12 * 1024 * 1024 * 1024;

async function printThrown(body: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        try {
          ${body}
          console.log("no throw");
        } catch (e) {
          console.log(e.name + ": " + e.message);
        }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const outOfMemory = { stdout: "RangeError: Out of memory\n", stderr: "", exitCode: 0 };

describe.skipIf(!enoughMemory)("a message past WTF::String::MaxLength throws instead of aborting", () => {
  // determineSpecificType renders an object as "an instance of <constructor.name>".
  test("ERR_INVALID_ARG_TYPE with a 2^31-1 character constructor name", async () => {
    const result = await printThrown(`
      const name = "a".repeat(2147483647);
      Buffer.byteLength({ constructor: { name } });
    `);
    expect(result).toEqual(outOfMemory);
  });

  // ReadableStream.from appends " must be iterable" after the rendered value. The symbol
  // renders as "Symbol(aaa...)", 8 characters more than its description.
  test("ERR_ARG_NOT_ITERABLE with a symbol whose rendering fills a string", async () => {
    const result = await printThrown(`
      const description = "a".repeat(2147483630);
      ReadableStream.from(Symbol(description));
    `);
    expect(result).toEqual(outOfMemory);
  });
});
