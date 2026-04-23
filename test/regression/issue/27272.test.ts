import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";
import { getSecret } from "harness";

const s3Options = {
  accessKeyId: getSecret("S3_R2_ACCESS_KEY"),
  secretAccessKey: getSecret("S3_R2_SECRET_KEY"),
  endpoint: getSecret("S3_R2_ENDPOINT"),
  bucket: getSecret("S3_R2_BUCKET"),
};

describe.skipIf(!s3Options.accessKeyId)("issue#27272 - S3 .slice().stream() ignores slice range", () => {
  const client = new S3Client(s3Options);

  it("slice(0, N).stream() should only return N bytes", async () => {
    const filename = `test-issue-27272-${crypto.randomUUID()}`;
    const s3file = client.file(filename);
    try {
      await s3file.write("Hello Bun! This is a longer string for testing.");

      const sliced = s3file.slice(0, 5);
      const stream = sliced.stream();
      const reader = stream.getReader();
      let bytes = 0;
      const chunks: Array<Buffer> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value?.length ?? 0;
        if (value) chunks.push(value as Buffer);
      }

      expect(bytes).toBe(5);
      expect(Buffer.concat(chunks).toString()).toBe("Hello");
    } finally {
      await s3file.unlink();
    }
  });

  it("slice(0, N).text() and slice(0, N).stream() should return the same data", async () => {
    const filename = `test-issue-27272-consistency-${crypto.randomUUID()}`;
    const s3file = client.file(filename);
    try {
      await s3file.write("Hello Bun! This is a longer string for testing.");

      const textResult = await s3file.slice(0, 10).text();

      const stream = s3file.slice(0, 10).stream();
      const reader = stream.getReader();
      const chunks: Array<Buffer> = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value as Buffer);
      }
      const streamResult = Buffer.concat(chunks).toString();

      expect(streamResult).toBe(textResult);
      expect(streamResult).toBe("Hello Bun!");
    } finally {
      await s3file.unlink();
    }
  });
});
