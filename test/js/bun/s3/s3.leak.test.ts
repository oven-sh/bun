import type { S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, getSecret, tempDirWithFiles } from "harness";
import path from "path";
const s3Options: S3Options = {
  accessKeyId: getSecret("S3_R2_ACCESS_KEY"),
  secretAccessKey: getSecret("S3_R2_SECRET_KEY"),
  endpoint: getSecret("S3_R2_ENDPOINT"),
};

const S3Bucket = getSecret("S3_R2_BUCKET");

describe.skipIf(!s3Options.accessKeyId)("s3", () => {
  describe("leak tests", () => {
    it(
      "s3().stream() should not leak",
      async () => {
        const dir = tempDirWithFiles("s3-stream-leak-fixture", {
          "s3-stream-leak-fixture.js": await Bun.file(path.join(import.meta.dir, "s3-stream-leak-fixture.js")).text(),
          "out.bin": "here",
        });

        const dest = path.join(dir, "out.bin");

        const { exitCode, stderr } = Bun.spawnSync(
          [bunExe(), "--smol", path.join(dir, "s3-stream-leak-fixture.js"), dest],
          {
            env: {
              ...bunEnv,
              BUN_JSC_gcMaxHeapSize: "503316",
              AWS_ACCESS_KEY_ID: s3Options.accessKeyId,
              AWS_SECRET_ACCESS_KEY: s3Options.secretAccessKey,
              AWS_ENDPOINT: s3Options.endpoint,
              AWS_BUCKET: S3Bucket,
            },
            stderr: "inherit",
            stdout: "inherit",
            stdin: "ignore",
          },
        );
        expect(exitCode).toBe(0);
      },
      30 * 1000,
    );
    it(
      "s3().text() should not leak",
      async () => {
        const dir = tempDirWithFiles("s3-text-leak-fixture", {
          "s3-text-leak-fixture.js": await Bun.file(path.join(import.meta.dir, "s3-text-leak-fixture.js")).text(),
          "out.bin": "here",
        });

        const dest = path.join(dir, "out.bin");

        const { exitCode, stderr } = Bun.spawnSync(
          [bunExe(), "--smol", path.join(dir, "s3-text-leak-fixture.js"), dest],
          {
            env: {
              ...bunEnv,
              BUN_JSC_gcMaxHeapSize: "503316",
              AWS_ACCESS_KEY_ID: s3Options.accessKeyId,
              AWS_SECRET_ACCESS_KEY: s3Options.secretAccessKey,
              AWS_ENDPOINT: s3Options.endpoint,
              AWS_BUCKET: S3Bucket,
            },
            stderr: "pipe",
            stdout: "inherit",
            stdin: "ignore",
          },
        );
        expect(exitCode).toBe(0);
        expect(stderr.toString()).toBe("");
      },
      30 * 1000,
    );
    it(
      "s3().writer().write() should not leak",
      async () => {
        const dir = tempDirWithFiles("s3-writer-leak-fixture", {
          "s3-writer-leak-fixture.js": await Bun.file(path.join(import.meta.dir, "s3-writer-leak-fixture.js")).text(),
          "out.bin": "here",
        });

        const dest = path.join(dir, "out.bin");

        const { exitCode, stderr } = Bun.spawnSync(
          [bunExe(), "--smol", path.join(dir, "s3-writer-leak-fixture.js"), dest],
          {
            env: {
              ...bunEnv,
              BUN_JSC_gcMaxHeapSize: "503316",
              AWS_ACCESS_KEY_ID: s3Options.accessKeyId,
              AWS_SECRET_ACCESS_KEY: s3Options.secretAccessKey,
              AWS_ENDPOINT: s3Options.endpoint,
              AWS_BUCKET: S3Bucket,
            },
            stderr: "pipe",
            stdout: "inherit",
            stdin: "ignore",
          },
        );
        expect(exitCode).toBe(0);
        expect(stderr.toString()).toBe("");
      },
      30 * 1000,
    );
    it(
      "s3().write() should not leak",
      async () => {
        const dir = tempDirWithFiles("s3-write-leak-fixture", {
          "s3-write-leak-fixture.js": await Bun.file(path.join(import.meta.dir, "s3-write-leak-fixture.js")).text(),
          "out.bin": "here",
        });

        const dest = path.join(dir, "out.bin");

        const { exitCode, stderr } = Bun.spawnSync(
          [bunExe(), "--smol", path.join(dir, "s3-write-leak-fixture.js"), dest],
          {
            env: {
              ...bunEnv,
              BUN_JSC_gcMaxHeapSize: "503316",
              AWS_ACCESS_KEY_ID: s3Options.accessKeyId,
              AWS_SECRET_ACCESS_KEY: s3Options.secretAccessKey,
              AWS_ENDPOINT: s3Options.endpoint,
              AWS_BUCKET: S3Bucket,
            },
            stderr: "pipe",
            stdout: "inherit",
            stdin: "ignore",
          },
        );
        expect(exitCode).toBe(0);
        expect(stderr.toString()).toBe("");
      },
      30 * 1000,
    );

    it(
      "Bun.write should not leak",
      async () => {
        const dir = tempDirWithFiles("bun-write-leak-fixture", {
          "bun-write-leak-fixture.js": await Bun.file(path.join(import.meta.dir, "bun-write-leak-fixture.js")).text(),
          "out.bin": "here",
        });

        const dest = path.join(dir, "out.bin");

        const { exitCode, stderr } = Bun.spawnSync(
          [bunExe(), "--smol", path.join(dir, "bun-write-leak-fixture.js"), dest],
          {
            env: {
              ...bunEnv,
              BUN_JSC_gcMaxHeapSize: "503316",
              AWS_ACCESS_KEY_ID: s3Options.accessKeyId,
              AWS_SECRET_ACCESS_KEY: s3Options.secretAccessKey,
              AWS_ENDPOINT: s3Options.endpoint,
              AWS_BUCKET: S3Bucket,
            },
            stderr: "pipe",
            stdout: "inherit",
            stdin: "ignore",
          },
        );
        expect(exitCode).toBe(0);
        expect(stderr.toString()).toBe("");
      },
      30 * 1000,
    );
  });
});
