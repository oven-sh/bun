import { S3Client } from "bun";
import { expect, test } from "bun:test";

test("S3 presigned URL performance test with stack allocator", () => {
  const s3 = new S3Client({
    accessKeyId: "test-key-123456789012345678901234567890",
    secretAccessKey: "test-secret-123456789012345678901234567890123456789012345678901234567890",
    endpoint: "https://s3.example.com",
    bucket: "test-bucket-with-long-name-to-test-allocation",
  });

  // Test with various parameter combinations to stress the allocator
  const testCases = [
    {
      name: "simple",
      params: {},
    },
    {
      name: "with-acl",
      params: { acl: "public-read" },
    },
    {
      name: "with-multiple-params",
      params: {
        method: "PUT",
        acl: "public-read-write",
        expiresIn: 3600,
        storageClass: "STANDARD_IA",
      },
    },
  ];

  for (const testCase of testCases) {
    const url = s3.presign(`test-file-${testCase.name}.txt`, testCase.params);

    // Verify URL is generated correctly
    expect(url).toContain("test-file-");
    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(url).toContain("X-Amz-Credential=");
    expect(url).toContain("X-Amz-Date=");
    expect(url).toContain("X-Amz-Signature=");

    // Parse URL to verify parameter order
    const urlObj = new URL(url);
    const params = Array.from(urlObj.searchParams.keys());
    const sortedParams = params.slice().sort();
    expect(params).toEqual(sortedParams);
  }

  // Performance test - should not throw or crash
  for (let i = 0; i < 100; i++) {
    const url = s3.presign(`perf-test-${i}.txt`, {
      method: "PUT",
      acl: "private",
      expiresIn: 300,
    });
    expect(url).toContain("perf-test-");
  }

  expect(true).toBe(true);
});
