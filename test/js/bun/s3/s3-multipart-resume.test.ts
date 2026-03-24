import { S3Client, type S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

describe("s3 - Resumable multipart upload", () => {
  const s3Options: S3Options = {
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "eu-west-3",
    bucket: "my_bucket",
  };

  it("should skip CreateMultipartUpload when uploadId is provided", async () => {
    const uploadId = randomUUID();
    let createMultipartCalled = false;
    const partNumbers: number[] = [];
    let completionBody = "";

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "POST" && url.search.includes("?uploads=")) {
          createMultipartCalled = true;
          return new Response(
            `<InitiateMultipartUploadResult><UploadId>${randomUUID()}</UploadId></InitiateMultipartUploadResult>`,
            { status: 200, headers: { "Content-Type": "text/xml" } },
          );
        }

        if (req.method === "PUT" && url.search.includes("partNumber=")) {
          const match = url.search.match(/partNumber=(\d+)/);
          if (match) partNumbers.push(parseInt(match[1]));
          return new Response(undefined, {
            status: 200,
            headers: { ETag: `"etag-part-${match?.[1]}"` },
          });
        }

        if (req.method === "POST" && url.search.includes("uploadId=")) {
          completionBody = await req.text();
          return new Response(
            `<CompleteMultipartUploadResult>
              <Location>http://my_bucket.s3.amazonaws.com/test</Location>
              <Bucket>my_bucket</Bucket>
              <Key>test</Key>
              <ETag>"final-etag"</ETag>
            </CompleteMultipartUploadResult>`,
            { status: 200, headers: { "Content-Type": "text/xml" } },
          );
        }

        return new Response("", { status: 200 });
      },
    });

    const client = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
    });

    const writer = client.file("test_resume").writer({
      uploadId,
      partNumber: 3,
      partSize: 5 * 1024 * 1024,
      queueSize: 10,
    });

    // Write enough data to trigger a part upload (>= partSize)
    const chunk = Buffer.alloc(5 * 1024 * 1024);
    writer.write(chunk);
    await writer.end();

    // CreateMultipartUpload should NOT have been called
    expect(createMultipartCalled).toBe(false);
    // The part should start from partNumber 3
    expect(partNumbers).toContain(3);
    // The completion should include the uploadId
    expect(completionBody).toInclude("<PartNumber>3</PartNumber>");
  }, { timeout: 30_000 });

  it("should include previousParts in CompleteMultipartUpload XML", async () => {
    const uploadId = randomUUID();
    let completionBody = "";

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "PUT" && url.search.includes("partNumber=")) {
          return new Response(undefined, {
            status: 200,
            headers: { ETag: `"new-etag"` },
          });
        }

        if (req.method === "POST" && url.search.includes("uploadId=")) {
          completionBody = await req.text();
          return new Response(
            `<CompleteMultipartUploadResult>
              <Location>http://my_bucket.s3.amazonaws.com/test</Location>
              <Bucket>my_bucket</Bucket>
              <Key>test</Key>
              <ETag>"final-etag"</ETag>
            </CompleteMultipartUploadResult>`,
            { status: 200, headers: { "Content-Type": "text/xml" } },
          );
        }

        return new Response("", { status: 200 });
      },
    });

    const client = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
    });

    const writer = client.file("test_resume_parts").writer({
      uploadId,
      partNumber: 3,
      partSize: 5 * 1024 * 1024,
      queueSize: 10,
      previousParts: [
        { partNumber: 1, etag: '"etag-part-1"' },
        { partNumber: 2, etag: '"etag-part-2"' },
      ],
    });

    const chunk = Buffer.alloc(5 * 1024 * 1024);
    writer.write(chunk);
    await writer.end();

    // The completion XML should include both previous parts and the new part
    expect(completionBody).toInclude("<PartNumber>1</PartNumber>");
    expect(completionBody).toInclude('<ETag>"etag-part-1"</ETag>');
    expect(completionBody).toInclude("<PartNumber>2</PartNumber>");
    expect(completionBody).toInclude('<ETag>"etag-part-2"</ETag>');
    expect(completionBody).toInclude("<PartNumber>3</PartNumber>");
    // Parts should be sorted by number in the XML
    const part1Pos = completionBody.indexOf("<PartNumber>1</PartNumber>");
    const part2Pos = completionBody.indexOf("<PartNumber>2</PartNumber>");
    const part3Pos = completionBody.indexOf("<PartNumber>3</PartNumber>");
    expect(part1Pos).toBeLessThan(part2Pos);
    expect(part2Pos).toBeLessThan(part3Pos);
  }, { timeout: 30_000 });

  it("should complete with only previousParts and no new data", async () => {
    const uploadId = randomUUID();
    let completionBody = "";
    let completionCalled = false;

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "POST" && url.search.includes("uploadId=")) {
          completionCalled = true;
          completionBody = await req.text();
          return new Response(
            `<CompleteMultipartUploadResult>
              <Location>http://my_bucket.s3.amazonaws.com/test</Location>
              <Bucket>my_bucket</Bucket>
              <Key>test</Key>
              <ETag>"final-etag"</ETag>
            </CompleteMultipartUploadResult>`,
            { status: 200, headers: { "Content-Type": "text/xml" } },
          );
        }

        return new Response("", { status: 200 });
      },
    });

    const client = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
    });

    const writer = client.file("test_complete_only").writer({
      uploadId,
      partNumber: 4,
      partSize: 5 * 1024 * 1024,
      previousParts: [
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
        { partNumber: 3, etag: '"etag-3"' },
      ],
    });

    // End immediately without writing any new data
    await writer.end();

    expect(completionCalled).toBe(true);
    expect(completionBody).toInclude("<PartNumber>1</PartNumber>");
    expect(completionBody).toInclude("<PartNumber>2</PartNumber>");
    expect(completionBody).toInclude("<PartNumber>3</PartNumber>");
    expect(completionBody).toInclude('<ETag>"etag-1"</ETag>');
    expect(completionBody).toInclude('<ETag>"etag-2"</ETag>');
    expect(completionBody).toInclude('<ETag>"etag-3"</ETag>');
  }, { timeout: 30_000 });

  it("should throw when partNumber > 1 without uploadId", () => {
    const client = new S3Client({
      ...s3Options,
      endpoint: "http://localhost:1",
    });

    expect(() => {
      client.file("test").writer({ partNumber: 5 });
    }).toThrow("partNumber > 1 requires uploadId");
  });

  it("should throw when previousParts is provided without uploadId", () => {
    const client = new S3Client({
      ...s3Options,
      endpoint: "http://localhost:1",
    });

    expect(() => {
      client.file("test").writer({
        previousParts: [{ partNumber: 1, etag: '"etag"' }],
      });
    }).toThrow("previousParts requires uploadId");
  });

  it("should throw for invalid partNumber range", () => {
    const client = new S3Client({
      ...s3Options,
      endpoint: "http://localhost:1",
    });

    expect(() => {
      client.file("test").writer({ uploadId: "abc", partNumber: 0 });
    }).toThrow();

    expect(() => {
      client.file("test").writer({ uploadId: "abc", partNumber: 10001 });
    }).toThrow();
  });

  it("should throw for invalid previousParts entries", () => {
    const client = new S3Client({
      ...s3Options,
      endpoint: "http://localhost:1",
    });

    expect(() => {
      client.file("test").writer({
        uploadId: "abc",
        // @ts-expect-error missing etag
        previousParts: [{ partNumber: 1 }],
      });
    }).toThrow("etag");
  });

  it("should not use single PUT when resuming with small data", async () => {
    const uploadId = randomUUID();
    let putCalled = false;
    let completionCalled = false;
    const partNumbers: number[] = [];

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        // Detect single PUT (no query params for multipart)
        if (req.method === "PUT" && !url.search.includes("partNumber=")) {
          putCalled = true;
          return new Response("", { status: 200 });
        }

        if (req.method === "PUT" && url.search.includes("partNumber=")) {
          const match = url.search.match(/partNumber=(\d+)/);
          if (match) partNumbers.push(parseInt(match[1]));
          return new Response(undefined, {
            status: 200,
            headers: { ETag: `"etag-${match?.[1]}"` },
          });
        }

        if (req.method === "POST" && url.search.includes("uploadId=")) {
          completionCalled = true;
          return new Response(
            `<CompleteMultipartUploadResult>
              <Location>http://my_bucket.s3.amazonaws.com/test</Location>
              <Bucket>my_bucket</Bucket>
              <Key>test</Key>
              <ETag>"final-etag"</ETag>
            </CompleteMultipartUploadResult>`,
            { status: 200, headers: { "Content-Type": "text/xml" } },
          );
        }

        return new Response("", { status: 200 });
      },
    });

    const client = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
    });

    // Write a small chunk (< partSize) — normally this would trigger single PUT,
    // but with resume it should stay in multipart mode
    const writer = client.file("test_no_single_put").writer({
      uploadId,
      partNumber: 2,
      partSize: 5 * 1024 * 1024,
      previousParts: [{ partNumber: 1, etag: '"etag-1"' }],
    });

    writer.write(Buffer.alloc(1024)); // Small chunk
    await writer.end();

    // Should NOT have used single PUT
    expect(putCalled).toBe(false);
    // Should have completed the multipart upload
    expect(completionCalled).toBe(true);
  }, { timeout: 30_000 });

  it("should use correct uploadId in part upload and completion requests", async () => {
    const uploadId = "test-upload-id-12345";
    const capturedUploadIds: string[] = [];

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.search.includes("uploadId=")) {
          const match = url.search.match(/uploadId=([^&]+)/);
          if (match) capturedUploadIds.push(match[1]);
        }

        if (req.method === "PUT" && url.search.includes("partNumber=")) {
          return new Response(undefined, {
            status: 200,
            headers: { ETag: '"some-etag"' },
          });
        }

        if (req.method === "POST" && url.search.includes("uploadId=")) {
          return new Response(
            `<CompleteMultipartUploadResult>
              <Location>http://my_bucket.s3.amazonaws.com/test</Location>
              <Bucket>my_bucket</Bucket>
              <Key>test</Key>
              <ETag>"final-etag"</ETag>
            </CompleteMultipartUploadResult>`,
            { status: 200, headers: { "Content-Type": "text/xml" } },
          );
        }

        return new Response("", { status: 200 });
      },
    });

    const client = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
    });

    const writer = client.file("test_upload_id").writer({
      uploadId,
      partNumber: 1,
      partSize: 5 * 1024 * 1024,
      queueSize: 10,
    });

    writer.write(Buffer.alloc(5 * 1024 * 1024));
    await writer.end();

    // All requests with uploadId should use the same provided upload ID
    expect(capturedUploadIds.length).toBeGreaterThan(0);
    for (const id of capturedUploadIds) {
      expect(id).toBe(uploadId);
    }
  }, { timeout: 30_000 });
});
