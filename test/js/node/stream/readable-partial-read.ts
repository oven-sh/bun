// Runs readable-partial-read-fixture.js for the tests of each kind of stream.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import { join } from "node:path";

const fixture = join(import.meta.dir, "readable-partial-read-fixture.js");

/** What the writer of the fixture sends: the mark of a byte stream, a header of 8 bytes, and one byte. */
export const PAYLOAD = 64 * 1024 + 8 + 1;

type Source =
  | "child-stdout"
  | "child-stderr"
  | "child-stdio3"
  | "fromweb-spawn"
  | "tcp"
  | "unix"
  | "tls"
  | "http-request"
  | "http-response"
  | "stdin";
type Reader = "swap" | "once" | "unshift" | "awaitSwap" | "iterateThenListen";
type Case = `${Source}:${Reader}`;

// What one read of a libuv stream holds at most.
const atMost64KiB = (bytes: number) => (bytes <= 64 * 1024 ? "at most 64 KiB" : bytes);

/** What the fixture printed for each case, and how it exited. `stdinSize`: its stdin is a file of that many bytes. */
export async function readInPart(cases: Case[], stdinSize?: number) {
  using dir = tempDir("readable-partial-read", {
    "cert.pem": tls.cert,
    "key.pem": tls.key,
    "stdin": Buffer.alloc(stdinSize ?? 0, "a"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture, String(dir), ...cases],
    env: bunEnv,
    stdin: stdinSize === undefined ? "ignore" : Bun.file(join(String(dir), "stdin")),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const results: Record<string, any> = {};
  for (const line of stdout.split("\n").filter(Boolean)) {
    for (const [name, result] of Object.entries<any>(JSON.parse(line))) {
      const counts = result.whileOpen ?? result;
      counts.largestPush = atMost64KiB(counts.largestPush);
      results[name] = result;
    }
  }
  return { results, stderr, exitCode };
}

const counts = { received: PAYLOAD, headerCalls: 1, largestPush: "at most 64 KiB", stackedPushes: 0 };

/** The stream delivered all of the payload while its writer still held the other end open, then ended. */
export const deliveredAll = { whileOpen: { ...counts, ended: false }, received: PAYLOAD, ended: true };

/** The same for an HTTP body, which its writer ends with one more byte. */
export const deliveredAllOfBody = { ...deliveredAll, received: PAYLOAD + 1 };

/** The same for a reader that takes whole chunks for a while: what reads for it has no size to keep to. */
export const deliveredAllInAnyChunks = {
  ...deliveredAll,
  whileOpen: { ...deliveredAll.whileOpen, largestPush: expect.anything() },
};

/** The same for a stream of `size` bytes that ends by itself. */
export const deliveredToTheEnd = (size: number) => ({ ...counts, received: size, ended: true });

/** What `readInPart(cases)` resolves to when every case has the outcome `outcome`. */
export const allCases = (cases: Case[], outcome: object) => ({
  results: Object.fromEntries(
    cases.map(name => [name, name.endsWith(":iterateThenListen") ? deliveredAllInAnyChunks : outcome]),
  ),
  stderr: "",
  exitCode: 0,
});
