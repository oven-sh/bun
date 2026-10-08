import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// A Response whose body is an S3-backed Blob comes from `fetch()` of a blob:
// URL for an S3File, from a clone of that, or from `new Response([s3file])`.
// (`new Response(s3file)` has no body: it is a redirect to a presigned URL.)
// GET sends an empty body for it (#43930). HEAD states that length in the
// frame that returned the Response, and asks S3 nothing.
describe.concurrent("HEAD for a Response with an S3 file body", () => {
  // The requests run in a subprocess: a server that crashes on one shows up
  // as an exit code instead of taking down the test runner.
  async function runFixture(mode: "gc" | "matrix") {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "serve-s3-blob-body-head-fixture.ts"), mode],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stderr, lines: stdout.split("\n").filter(Boolean), exitCode };
  }

  test("does not wait for S3, so a garbage collection cannot take the Response from under it", async () => {
    const { stderr, lines, exitCode } = await runFixture("gc");
    expect(stderr).toBe("");
    expect(lines.map(line => JSON.parse(line))).toEqual([{ status: 200, contentLength: "0", s3Requests: [] }]);
    expect(exitCode).toBe(0);
  });

  test("states the length GET sends and asks S3 nothing, however the Response reaches the server", async () => {
    const { stderr, lines, exitCode } = await runFixture("matrix");
    expect(stderr).toBe("");

    const producers = ["fetch(blob:)", "clone()", "new Response([s3file])"];
    const entries = [
      "returned",
      "fulfilled promise",
      "pending promise",
      "error()",
      "error() fulfilled promise",
      "routes GET",
    ];
    const head = { status: 200, contentLength: "0", transferEncoding: null, s3Requests: [], bodyUsed: false };
    expect(lines.map(line => JSON.parse(line))).toEqual(
      producers.flatMap(producer => entries.map(entry => ({ producer, entry, ...head }))),
    );
    expect(exitCode).toBe(0);
  });
});
