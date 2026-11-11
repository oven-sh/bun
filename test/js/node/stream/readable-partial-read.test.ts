// A reader takes a header with read(8) and leaves the rest to a 'readable' listener that it adds afterwards. Node
// announces what is left again with the next chunk, as long as no more than highWaterMark bytes are left. What
// libuv reads for Node is at most 64 KiB a time and arrives from the event loop, so no stream that it feeds stalls
// there. readable-partial-read-fixture.js holds the readers and the writers of these tests, and runs on Node as it is.
//
// The default highWaterMark on Windows is 16 KiB, under which Node stalls too.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir, tls } from "harness";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { PAYLOAD, readInPart as readCase } from "./readable-partial-read-fixture.js";

const fixture = join(import.meta.dir, "readable-partial-read-fixture.js");

// What one read of a libuv stream holds at most.
const atMost64KiB = (bytes: number) => (bytes <= 64 * 1024 ? "at most 64 KiB" : bytes);

/** What `reader` had of `source` while its writer held the other end open, and how the stream ended after that. */
async function readInPart(source: string, reader: string, size?: number) {
  using dir = tempDir("partial-read", { "cert.pem": tls.cert, "key.pem": tls.key });
  const result = await readCase(String(dir), source, reader, size);
  result.whileOpen.largestPush = atMost64KiB(result.whileOpen.largestPush);
  return result;
}

/**
 * The stream delivered all `size` bytes while its writer still held the other end open, then ended.
 * `lastBytes`: what the writer sent to close, which is one byte for the body of an HTTP message.
 */
function deliveredAll(reader: string, { size = PAYLOAD, lastBytes = 0 } = {}) {
  // An async iterator takes whole chunks: what reads for it has no size to keep to.
  const largestPush = reader === "iterateThenListen" ? expect.anything() : "at most 64 KiB";
  const whileOpen = { received: size, headerCalls: 1, largestPush, stackedPushes: 0, ended: false };
  return { whileOpen, received: size + lastBytes, ended: true };
}

describe.skipIf(isWindows)("a stream that was read in part announces the rest", () => {
  test.each([
    ["child-stdout", "swap"],
    ["child-stdout", "once"],
    ["child-stdout", "unshift"],
    ["child-stdout", "awaitSwap"],
    ["child-stdout", "iterateThenListen"],
    ["child-stderr", "swap"],
    // macOS gives the socketpair of an extra descriptor about 8 KiB, which is too little for the payload to wait in.
    ...(isMacOS ? [] : [["child-stdio3", "swap"]]),
    ["fromweb-spawn", "swap"],
    ["tcp-accepted", "swap"],
    ["tcp-accepted", "awaitSwap"],
    ["tcp-accepted", "iterateThenListen"],
    ["tcp-connected", "swap"],
    ["unix-accepted", "swap"],
    ["tls-accepted", "swap"],
    ["tls-connected", "swap"],
    ["tls-over-socket", "swap"],
    ["http-upgrade", "swap"],
  ])("%s, reader %s", async (source, reader) => {
    expect(await readInPart(source, reader)).toEqual(deliveredAll(reader));
  });

  // The programs of the report. The child has more to write than the kernel holds: it is still writing when the
  // reader starts, and goes on when the reader reads.
  test.each([["swap"], ["iterateThenListen"]])("child-stdout of 2 MB, reader %s", async reader => {
    const size = 2_000_000;
    expect(await readInPart("child-stdout", reader, size)).toEqual(deliveredAll(reader, { size }));
  });

  // The writer of an HTTP body ends it with one more byte.
  test.each([
    ["http-request", "swap"],
    ["https-request", "swap"],
    ["http-response", "swap"],
  ])("%s, reader %s", async (source, reader) => {
    expect(await readInPart(source, reader)).toEqual(deliveredAll(reader, { lastBytes: 1 }));
  });

  // No writer holds an end open: the stream ends at the end of the file, or the process exits where it stalled.
  test("process.stdin from a file, reader swap", async () => {
    const size = 200_000;
    using dir = tempDir("partial-read", { "stdin": Buffer.alloc(size, "a") });
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, String(dir), "stdin:swap"],
      env: bunEnv,
      stdin: Bun.file(join(String(dir), "stdin")),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout)["stdin:swap"];
    result.largestPush = atMost64KiB(result.largestPush);
    expect(result).toEqual({
      received: size,
      headerCalls: 1,
      largestPush: "at most 64 KiB",
      stackedPushes: 0,
      ended: true,
    });
    expect(exitCode).toBe(0);
  });
});

// A child's stdio is read when the stream asks for bytes. The first read of a stream that holds nothing answers at
// once, so a read() with no listener finds what the child wrote, as it does in Node, which reads from the start.
describe.skipIf(isWindows)("a child's stdout that nothing listens to", () => {
  test("read(8) returns 8 of the bytes that the child wrote", async () => {
    const child = spawn("sh", ["-c", "printf 0123456789abcdef; printf . >&2; cat > /dev/null"]);
    // The child writes to stderr when its stdout has the bytes. One more turn of the loop, for a runtime that reads ahead.
    await once(child.stderr, "data");
    await new Promise(resolve => setImmediate(resolve));
    const read = [String(child.stdout.read(8)), String(child.stdout.read(8)), child.stdout.read(8)];
    child.stdin.end();
    expect(read).toEqual(["01234567", "89abcdef", null]);
  });

  test("read() in 'exit' returns the child's output", async () => {
    const child = spawn("sh", ["-c", "printf 'hello from the child'"], { stdio: ["ignore", "pipe", "ignore"] });
    const { promise, resolve } = Promise.withResolvers<string>();
    child.on("exit", () => resolve(String(child.stdout.read())));
    expect(await promise).toBe("hello from the child");
  });
});
