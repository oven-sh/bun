import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

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
