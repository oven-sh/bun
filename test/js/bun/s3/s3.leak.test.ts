import type { S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import child_process from "child_process";
import { bunEnv, bunExe, dockerExe, getSecret, isDockerEnabled, tempDirWithFiles } from "harness";
import path from "path";
import * as dockerCompose from "../../../docker/index.ts";

const s3Options: S3Options = {
  accessKeyId: getSecret("S3_R2_ACCESS_KEY"),
  secretAccessKey: getSecret("S3_R2_SECRET_KEY"),
  endpoint: getSecret("S3_R2_ENDPOINT"),
};

const S3Bucket = getSecret("S3_R2_BUCKET");

let minioOptions: S3Options | undefined;

if (isDockerEnabled()) {
  const minioInfo = await dockerCompose.ensure("minio");
  const dockerCLI = dockerExe() as string;
  const containerName = child_process
    .execFileSync(
      dockerCLI,
      ["ps", "--filter", "ancestor=minio/minio:latest", "--filter", "status=running", "--format", "{{.Names}}"],
      { encoding: "utf-8" },
    )
    .split("\n")[0]
    .trim();

  if (containerName) {
    child_process.spawnSync(dockerCLI, ["exec", containerName, "mc", "mb", "--ignore-existing", "data/buntest"], {
      stdio: "ignore",
    });
  }

  minioOptions = {
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    endpoint: `http://${minioInfo.host}:${minioInfo.ports[9000]}`,
  };
}

describe.skipIf(!minioOptions)("s3 local leak tests", () => {
  it(
    "s3().arrayBuffer() should not retain downloaded buffers",
    async () => {
      const dir = tempDirWithFiles("s3-arraybuffer-leak-fixture", {
        "s3-arraybuffer-leak-fixture.js": await Bun.file(
          path.join(import.meta.dir, "s3-arraybuffer-leak-fixture.js"),
        ).text(),
      });

      const { exitCode, stderr } = Bun.spawnSync(
        [bunExe(), "--smol", path.join(dir, "s3-arraybuffer-leak-fixture.js")],
        {
          env: {
            ...bunEnv,
            BUN_JSC_gcMaxHeapSize: "503316",
            AWS_ACCESS_KEY_ID: minioOptions!.accessKeyId as string,
            AWS_SECRET_ACCESS_KEY: minioOptions!.secretAccessKey as string,
            AWS_ENDPOINT: minioOptions!.endpoint as string,
            AWS_BUCKET: "buntest",
            PAYLOAD_MIB: "1",
            WARMUP_ITERATIONS: "8",
            ITERATIONS: "80",
            MAX_ALLOWED_RSS_INCREMENT_MB: "64",
          },
          stderr: "pipe",
          stdout: "inherit",
          stdin: "ignore",
        },
      );

      expect(stderr.toString()).toBe("");
      expect(exitCode).toBe(0);
    },
    30 * 1000,
  );
});

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
