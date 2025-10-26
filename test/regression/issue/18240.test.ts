import { describe, expect, it } from "bun:test";
import { S3Client } from "bun";

describe("S3 contentLength support in presign method (#18240)", () => {
  it("should include Content-Length in presigned URL with contentLength option", () => {
    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucket: "test-bucket",
      region: "us-east-1",
    });

    const url = client.presign("test/abc.txt", {
      expiresIn: 3600,
      method: "PUT",
      contentLength: 200,
    });

    const urlObj = new URL(url);
    expect(urlObj.searchParams.get("Content-Length")).toBe("200");
  });

  it("should include Content-Length in presigned URL with ContentLength option (AWS SDK style)", () => {
    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucket: "test-bucket",
      region: "us-east-1",
    });

    const url = client.presign("test/abc.txt", {
      expiresIn: 3600,
      method: "PUT",
      ContentLength: 200,
    });

    const urlObj = new URL(url);
    expect(urlObj.searchParams.get("Content-Length")).toBe("200");
  });

  it("should work with Bun.s3() API", () => {
    const s3 = Bun.s3({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucket: "test-bucket",
      region: "us-east-1",
    });

    const file = s3.file("test/abc.txt");
    const url = file.presign({
      expiresIn: 3600,
      method: "PUT",
      contentLength: 200,
    });

    const urlObj = new URL(url);
    expect(urlObj.searchParams.get("Content-Length")).toBe("200");
  });

  it("should validate contentLength is positive", () => {
    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucket: "test-bucket",
      region: "us-east-1",
    });

    expect(() =>
      client.presign("test/abc.txt", {
        expiresIn: 3600,
        method: "PUT",
        contentLength: -1,
      }),
    ).toThrow();

    expect(() =>
      client.presign("test/abc.txt", {
        expiresIn: 3600,
        method: "PUT",
        contentLength: 0,
      }),
    ).toThrow();
  });

  it("should not include Content-Length when not specified", () => {
    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucket: "test-bucket",
      region: "us-east-1",
    });

    const url = client.presign("test/abc.txt", {
      expiresIn: 3600,
      method: "PUT",
    });

    const urlObj = new URL(url);
    expect(urlObj.searchParams.get("Content-Length")).toBeNull();
  });

  it("should work with different content lengths", () => {
    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucket: "test-bucket",
      region: "us-east-1",
    });

    const testCases = [1, 100, 10000, 1000000, 1073741824]; // 1 byte to 1GB

    for (const size of testCases) {
      const url = client.presign("test/abc.txt", {
        expiresIn: 3600,
        method: "PUT",
        contentLength: size,
      });

      const urlObj = new URL(url);
      expect(urlObj.searchParams.get("Content-Length")).toBe(String(size));
    }
  });
});
