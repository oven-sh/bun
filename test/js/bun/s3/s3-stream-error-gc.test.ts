import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

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
