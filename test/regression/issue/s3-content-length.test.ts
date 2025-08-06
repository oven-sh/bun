import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";

describe("S3 contentLength option in presign", () => {
  const s3Client = new S3Client({
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    bucket: "mybucketname",
    endpoint: "https://myaccountid.r2.cloudflarestorage.com",
  });

  it("should support contentLength option in presign method", () => {
    const url = s3Client.presign("test/abc", {
      expiresIn: 3600, // 1 hour
      method: "PUT",
      contentLength: 200, // THIS SHOULD NOW WORK
    });

    expect(url).toBeDefined();
    expect(typeof url).toBe("string");
    expect(url.includes("Content-Length=200")).toBe(true);
    expect(url.includes("X-Amz-Expires=3600")).toBe(true);
  });

  it("should support ContentLength option (AWS SDK style)", () => {
    const url = s3Client.presign("test/abc", {
      expiresIn: 3600,
      method: "PUT", 
      ContentLength: 200, // AWS SDK style
    });

    expect(url).toBeDefined();
    expect(typeof url).toBe("string");
    expect(url.includes("Content-Length=200")).toBe(true);
    expect(url.includes("X-Amz-Expires=3600")).toBe(true);
  });

  it("should work without contentLength (backward compatibility)", () => {
    const url = s3Client.presign("test/abc", {
      expiresIn: 3600,
      method: "PUT",
    });

    expect(url).toBeDefined();
    expect(typeof url).toBe("string");
    expect(url.includes("Content-Length=")).toBe(false);
    expect(url.includes("X-Amz-Expires=3600")).toBe(true);
  });
});