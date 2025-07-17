import { S3Client } from "bun";
import { expect, test } from "bun:test";

test("S3 presigned URL should have correct query parameter order", () => {
  const s3 = new S3Client({
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    endpoint: "https://s3.example.com",
    bucket: "test-bucket",
  });

  const url = s3.presign("test-file.txt", {
    method: "PUT",
    acl: "public-read",
    expiresIn: 300,
  });

  // Parse the URL to get query parameters
  const urlObj = new URL(url);
  const params = Array.from(urlObj.searchParams.keys());

  console.log("Query parameters order:", params);

  // Verify alphabetical order (after URL decoding)
  const expected = params.slice().sort();
  expect(params).toEqual(expected);

  // Verify that required AWS SigV4 parameters are present
  expect(params).toContain("X-Amz-Algorithm");
  expect(params).toContain("X-Amz-Credential");
  expect(params).toContain("X-Amz-Date");
  expect(params).toContain("X-Amz-Expires");
  expect(params).toContain("X-Amz-SignedHeaders");
  expect(params).toContain("X-Amz-Signature");
  expect(params).toContain("X-Amz-Acl");
});
