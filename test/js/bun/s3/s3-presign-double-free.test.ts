import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("S3Client static methods should not crash with string path arguments", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      async function main() {
        const calls = [
          () => Bun.S3Client.presign(Date()),
          () => Bun.S3Client.presign(Date(), Date()),
          () => Bun.S3Client.unlink(Date()),
          () => Bun.S3Client.size(Date()),
          () => Bun.S3Client.exists(Date()),
          () => Bun.S3Client.stat(Date()),
          () => Bun.S3Client.write(Date(), "data"),
        ];
        for (const call of calls) {
          try { await call(); } catch(e) {}
        }
        Bun.gc(true);
        console.log("OK");
      }
      main();
    `,
    ],
    env: {
      ...bunEnv,
      // Strip any ambient S3/AWS credentials so presign fails synchronously
      // and exercises the errdefer cleanup path.
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
      AWS_SESSION_TOKEN: undefined,
      AWS_REGION: undefined,
      AWS_BUCKET: undefined,
      AWS_ENDPOINT: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
      S3_SESSION_TOKEN: undefined,
      S3_REGION: undefined,
      S3_BUCKET: undefined,
      S3_ENDPOINT: undefined,
    },
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});
