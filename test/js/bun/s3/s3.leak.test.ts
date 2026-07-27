import type { S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, getSecret } from "harness";
import path from "path";

const s3Options: S3Options = {
  accessKeyId: getSecret("S3_R2_ACCESS_KEY"),
  secretAccessKey: getSecret("S3_R2_SECRET_KEY"),
  endpoint: getSecret("S3_R2_ENDPOINT"),
};

const S3Bucket = getSecret("S3_R2_BUCKET");

describe.skipIf(!s3Options.accessKeyId)("s3", () => {
  describe("leak tests", () => {
    it.concurrent.each([
      ["s3().stream()", "s3-stream-leak-fixture.js"],
      ["s3().text()", "s3-text-leak-fixture.js"],
      ["s3().writer().write()", "s3-writer-leak-fixture.js"],
      ["s3().write()", "s3-write-leak-fixture.js"],
      ["Bun.write", "bun-write-leak-fixture.js"],
    ])(
      "%s should not leak",
      async (_, fixture) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--smol", path.join(import.meta.dir, fixture)],
          env: {
            ...bunEnv,
            BUN_JSC_gcMaxHeapSize: "503316",
            AWS_ACCESS_KEY_ID: s3Options.accessKeyId,
            AWS_SECRET_ACCESS_KEY: s3Options.secretAccessKey,
            AWS_ENDPOINT: s3Options.endpoint,
            AWS_BUCKET: S3Bucket,
          },
          stderr: "pipe",
          stdout: "pipe",
          stdin: "ignore",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout).toBe("");
        expect(exitCode).toBe(0);
      },
      30 * 1000,
    );
  });
});
