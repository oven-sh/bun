import { S3Client } from "bun";
import { expect, test, describe } from "bun:test";

// GitHub Issue #24422: S3 presign does not percent-encode X-Amz-Credential (colon :)
// https://github.com/oven-sh/bun/issues/24422
//
// When accessKeyId contains special characters like colons (e.g., "TENANT_ID:KEY_ID"), the colon
// should be percent-encoded as %3A in the X-Amz-Credential query parameter.
// Without proper encoding, SigV4 validation fails with "Request signature does not match".

describe("S3 presign X-Amz-Credential encoding", () => {
  test("should percent-encode colon in accessKeyId within X-Amz-Credential", () => {
    // Access key in the format TENANT_ID:KEY_ID
    const accessKeyWithColon = "8439f167:f5cf173e";

    const s3 = new S3Client({
      accessKeyId: accessKeyWithColon,
      secretAccessKey: "test-secret-key",
      endpoint: "https://s3-provider.example.com",
      bucket: "test-bucket",
      region: "eu-central-1",
    });

    const url = s3.presign("test-file.txt", {
      expiresIn: 3600,
    });

    // Parse the URL and get the X-Amz-Credential parameter
    const urlObj = new URL(url);
    const credential = urlObj.searchParams.get("X-Amz-Credential");

    expect(credential).not.toBeNull();

    // The raw URL should contain %3A (encoded colon) instead of raw colon
    // AWS CLI produces: X-Amz-Credential=8439f167%3Af5cf173e/20251105/eu-central-1/s3/aws4_request
    // Bun currently produces: X-Amz-Credential=8439f167:f5cf173e/20251105/eu-central-1/s3/aws4_request
    expect(url).toContain("X-Amz-Credential=8439f167%3Af5cf173e");
    expect(url).not.toContain("X-Amz-Credential=8439f167:f5cf173e");

    // The decoded credential should still contain the original accessKeyId
    expect(credential).toContain("8439f167:f5cf173e");
  });

  test("should percent-encode multiple special characters in accessKeyId", () => {
    // Test with multiple special characters that need encoding
    const accessKeyWithSpecialChars = "tenant:key=value+test";

    const s3 = new S3Client({
      accessKeyId: accessKeyWithSpecialChars,
      secretAccessKey: "test-secret-key",
      endpoint: "https://s3.example.com",
      bucket: "test-bucket",
    });

    const url = s3.presign("test-file.txt", {
      expiresIn: 3600,
    });

    const urlObj = new URL(url);
    const credential = urlObj.searchParams.get("X-Amz-Credential");

    expect(credential).not.toBeNull();

    // Colons should be encoded as %3A
    expect(url).not.toMatch(/X-Amz-Credential=[^&]*:[^&]*/);

    // After decoding, the credential should have the original accessKeyId
    expect(credential).toContain("tenant:key=value+test");
  });

  test("should work correctly with standard accessKeyId without special characters", () => {
    // Standard AWS-style access key (no special characters)
    const standardAccessKey = "AKIAIOSFODNN7EXAMPLE";

    const s3 = new S3Client({
      accessKeyId: standardAccessKey,
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      endpoint: "https://s3.amazonaws.com",
      bucket: "test-bucket",
      region: "us-east-1",
    });

    const url = s3.presign("test-file.txt", {
      expiresIn: 3600,
    });

    const urlObj = new URL(url);
    const credential = urlObj.searchParams.get("X-Amz-Credential");

    expect(credential).not.toBeNull();
    expect(credential).toContain(standardAccessKey);
    expect(url).toContain(`X-Amz-Credential=${standardAccessKey}`);
  });

  test("should percent-encode accessKeyId in X-Amz-Credential for S3File.presign()", () => {
    const { s3 } = require("bun");

    const accessKeyWithColon = "tenant_id:access_key_id";

    const s3file = s3.file("test-file.txt", {
      accessKeyId: accessKeyWithColon,
      secretAccessKey: "test-secret-key",
      endpoint: "https://s3.example.com",
      bucket: "test-bucket",
    });

    const url = s3file.presign({ expiresIn: 3600 });

    // Verify the colon is percent-encoded
    expect(url).toContain("X-Amz-Credential=tenant_id%3Aaccess_key_id");
    expect(url).not.toContain("X-Amz-Credential=tenant_id:access_key_id");
  });

  test("should percent-encode accessKeyId in static S3Client.presign()", () => {
    const accessKeyWithColon = "my_tenant:my_key";

    const url = S3Client.presign("test-file.txt", {
      accessKeyId: accessKeyWithColon,
      secretAccessKey: "test-secret-key",
      endpoint: "https://s3.example.com",
      bucket: "test-bucket",
      expiresIn: 3600,
    });

    // Verify the colon is percent-encoded
    expect(url).toContain("X-Amz-Credential=my_tenant%3Amy_key");
    expect(url).not.toContain("X-Amz-Credential=my_tenant:my_key");
  });
});
