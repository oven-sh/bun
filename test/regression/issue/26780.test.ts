// Regression test for https://github.com/oven-sh/bun/issues/26780
// S3-to-file writes should respect createPath option (default: true)

import { describe, expect, it } from "bun:test";
import child_process from "child_process";
import { isDockerEnabled, tempDir } from "harness";
import path from "path";
import * as dockerCompose from "../../docker/index.ts";

function getMinioContainerName(): string {
  // Get container name without shell pipe for portability
  const output = child_process.execSync(
    `docker ps --filter "ancestor=minio/minio:latest" --filter "status=running" --format "{{.Names}}"`,
    {
      encoding: "utf-8",
    },
  );
  const names = output.split("\n").filter(name => name.trim() !== "");
  return names[0]?.trim() ?? "";
}

describe.skipIf(!isDockerEnabled())("issue #26780 - S3-to-file createPath", () => {
  it("should create parent directories when writing S3 file to local path", async () => {
    // Start MinIO using docker-compose
    const minioInfo = await dockerCompose.ensure("minio");

    // Get container name for docker exec
    const containerName = getMinioContainerName();

    if (!containerName) {
      throw new Error("MinIO container not found");
    }

    // Create a bucket using mc inside the container
    child_process.spawnSync("docker", [`exec`, containerName, `mc`, `mb`, `data/createpath-test`], {
      stdio: "ignore",
    });

    const credentials = {
      endpoint: `http://${minioInfo.host}:${minioInfo.ports[9000]}`,
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      bucket: "createpath-test",
    };

    // Create S3 client and upload a test file
    const s3Client = new Bun.S3Client(credentials);
    const testContent = "Hello from S3 createPath test!";
    const s3File = s3Client.file("test-file.txt");
    await s3File.write(testContent);

    // Verify S3 file was created
    expect(await s3File.exists()).toBe(true);

    // Create a temp directory and nested path that doesn't exist
    using dir = tempDir("s3-createpath-test", {});
    const nestedPath = path.join(String(dir), "nested", "deep", "path", "output.txt");

    // This should work - createPath defaults to true
    await Bun.write(nestedPath, s3File);

    // Verify the file was written
    expect(await Bun.file(nestedPath).exists()).toBe(true);
    expect(await Bun.file(nestedPath).text()).toBe(testContent);

    // Clean up S3
    await s3File.unlink();
  });

  it("should fail when createPath is false and parent directory doesn't exist", async () => {
    // Start MinIO using docker-compose
    const minioInfo = await dockerCompose.ensure("minio");

    // Get container name for docker exec
    const containerName = getMinioContainerName();

    if (!containerName) {
      throw new Error("MinIO container not found");
    }

    // Create a bucket using mc inside the container
    child_process.spawnSync("docker", [`exec`, containerName, `mc`, `mb`, `data/createpath-test2`], {
      stdio: "ignore",
    });

    const credentials = {
      endpoint: `http://${minioInfo.host}:${minioInfo.ports[9000]}`,
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      bucket: "createpath-test2",
    };

    // Create S3 client and upload a test file
    const s3Client = new Bun.S3Client(credentials);
    const testContent = "Hello from S3 createPath false test!";
    const s3File = s3Client.file("test-file2.txt");
    await s3File.write(testContent);

    // Verify S3 file was created
    expect(await s3File.exists()).toBe(true);

    // Create a temp directory and nested path that doesn't exist
    using dir = tempDir("s3-createpath-false-test", {});
    const nestedPath = path.join(String(dir), "nested2", "deep2", "path2", "output.txt");

    // This should fail - createPath is false and directory doesn't exist
    try {
      await Bun.write(nestedPath, s3File, { createPath: false });
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe("ENOENT");
    }

    // Clean up S3
    await s3File.unlink();
  });
});
