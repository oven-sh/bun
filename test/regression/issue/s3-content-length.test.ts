import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";

describe("S3 contentLength option in presign (Issue #18240)", () => {
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
      contentLength: 200,
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
      ContentLength: 200,
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

  it("should validate contentLength is positive", () => {
    expect(() => {
      s3Client.presign("test/abc", {
        expiresIn: 3600,
        method: "PUT",
        contentLength: -1, // Invalid negative value
      });
    }).toThrow();
  });

  it("should validate ContentLength is positive", () => {
    expect(() => {
      s3Client.presign("test/abc", {
        expiresIn: 3600,
        method: "PUT",
        ContentLength: -100, // Invalid negative value
      });
    }).toThrow();
  });

  it("should match the exact use case from issue #18240", () => {
    // This is the exact code snippet from the GitHub issue
    const url = s3Client.presign("test/abc", {
      expiresIn: 3600, // 1 hour
      method: "PUT",
      ContentLength: 200,
    });

    expect(url).toBeDefined();
    expect(typeof url).toBe("string");
    expect(url.includes("Content-Length=200")).toBe(true);

    // Verify other required AWS S3 signature components are present
    expect(url.includes("X-Amz-Expires=3600")).toBe(true);
    expect(url.includes("X-Amz-Algorithm=AWS4-HMAC-SHA256")).toBe(true);
    expect(url.includes("X-Amz-Credential")).toBe(true);
    expect(url.includes("X-Amz-Date")).toBe(true);
    expect(url.includes("X-Amz-SignedHeaders")).toBe(true);
    expect(url.includes("X-Amz-Signature")).toBe(true);
  });
});
