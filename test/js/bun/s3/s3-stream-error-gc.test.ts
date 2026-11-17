import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";

test.concurrent("collecting file blobs with Buffer paths does not crash during GC sweep", async () => {
  // The S3/file blob store keeps the pinned path buffer until the wrapper is
  // finalized inside the GC sweep; releasing the pin must not reach
  // JSCell::classInfo() there (validateIsNotSweeping assert in debug builds).
  const fixture = `
    const enc = new TextEncoder();
    for (let i = 0; i < 50; i++) {
      new Bun.S3Client({}).file(Buffer.from("key-" + i));
      new Bun.S3Client({}).file(new DataView(enc.encode("dv-key-" + i).buffer));
      new Bun.S3Client({}).file(enc.encode("uint8-key-" + i));
      Bun.file(Buffer.from("/tmp/buffer-path-" + i));
      Bun.file(enc.encode("/tmp/uint8-path-" + i));
      Bun.file(enc.encode("/tmp/enc-path-" + i).buffer);
      Bun.gc(true);
    }
    console.log("ok");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({
    stdout: normalizeBunSnapshot(stdout),
    stderr: normalizeBunSnapshot(stderr),
    exitCode,
  }).toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "stderr": "",
      "stdout": "ok",
    }
  `);
});

test("S3 stream error parked before consumption survives GC", async () => {
  const fixture = `
    const stream = Bun.S3Client.file("some-key").stream();
    Bun.gc(true);
    const decoys = [];
    for (let i = 0; i < 100; i++) decoys.push(new TypeError("decoy " + i));
    let err = null;
    try {
      await stream.text();
    } catch (e) {
      err = e;
    }
    if (err === null) throw new Error("expected rejection");
    if (String(err.message).includes("decoy")) throw new Error("rejected with a recycled object: " + err);
    console.log(err.code);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: {
      ...bunEnv,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
      S3_REGION: undefined,
      S3_ENDPOINT: undefined,
      S3_BUCKET: undefined,
      S3_SESSION_TOKEN: undefined,
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
      AWS_REGION: undefined,
      AWS_ENDPOINT: undefined,
      AWS_BUCKET: undefined,
      AWS_SESSION_TOKEN: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({
    stdout: normalizeBunSnapshot(stdout),
    stderr: normalizeBunSnapshot(stderr),
    exitCode,
  }).toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "stderr": "",
      "stdout": "ERR_S3_MISSING_CREDENTIALS",
    }
  `);
});

// An S3 stream whose download failed before anything read it holds the failure. It used to read
// as a complete, empty object: a late reader saw a clean end, a copy stored an empty object, an
// upload went out as a complete POST with no body, and Bun.serve answered an empty 200.
async function runStoredErrorFixture(mode: "stored" | "download") {
  using dir = tempDir("s3-stream-stored-error", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "s3-stream-stored-error-fixture.ts"), mode],
    env: {
      ...bunEnv,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
      S3_REGION: undefined,
      S3_ENDPOINT: undefined,
      S3_BUCKET: undefined,
      S3_SESSION_TOKEN: undefined,
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
      AWS_REGION: undefined,
      AWS_ENDPOINT: undefined,
      AWS_BUCKET: undefined,
      AWS_SESSION_TOKEN: undefined,
      // An inherited proxy would hijack the requests to the stub servers.
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("S3 stream that failed before anything read it rejects every consumer and sink", async () => {
  const { stdout, stderr, exitCode } = await runStoredErrorFixture("stored");
  const rejected = "rejected ERR_S3_MISSING_CREDENTIALS";

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    "for await": rejected,
    "getReader().read()": rejected,
    "pipeTo()": rejected,
    "tee()": rejected,
    "new Response(stream).bytes()": rejected,
    "new Response(stream).blob()": rejected,
    "Bun.write(path, new Response(stream))": rejected,
    "client.write(key, new Response(stream))": rejected,
    "Bun.write(s3file, new Response(stream))": rejected,
    "requests the bucket got": [],
    "fetch(url, { method: 'POST', body: stream })": rejected,
    "complete requests the receiver got": 0,
    "Bun.serve: return new Response(stream)": "500 error() got ERR_S3_MISSING_CREDENTIALS",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("S3 stream read only after its download failed on the wire rejects with the failure", async () => {
  const { stdout, stderr, exitCode } = await runStoredErrorFixture("download");

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    cut: "rejected ConnectionClosed",
    missing: "rejected NoSuchKey",
    denied: "rejected AccessDenied",
  });
  expect(exitCode).toBe(0);
});
