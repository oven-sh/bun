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
      previousParts: [
        { partNumber: 1, etag: '"prev-1"' },
        { partNumber: 2, etag: '"prev-2"' },
      ],
    });

    // With resume, state is already multipart_completed so even small data
    // goes through the multipart path (no need for >= partSize)
    writer.write(Buffer.alloc(1024));
    await writer.end();

    // CreateMultipartUpload should NOT have been called
    expect(createMultipartCalled).toBe(false);
    // The part should start from partNumber 3
    expect(partNumbers).toContain(3);
    // The completion should include the uploadId
    expect(completionBody).toInclude("<PartNumber>3</PartNumber>");
  });

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

    // Small buffer — resume state bypasses partSize threshold
    writer.write(Buffer.alloc(1024));
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
  });

  it("should complete with only previousParts and no new data", async () => {
    const uploadId = randomUUID();
    let completionBody = "";
    let completionCalled = false;
    let uploadedPartCount = 0;

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "PUT" && url.search.includes("partNumber=")) {
          uploadedPartCount++;
          return new Response(undefined, {
            status: 200,
            headers: { ETag: '"unexpected-etag"' },
          });
        }

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
    expect(uploadedPartCount).toBe(0);
    expect(completionBody).not.toInclude("<PartNumber>4</PartNumber>");
    expect(completionBody).toInclude("<PartNumber>1</PartNumber>");
    expect(completionBody).toInclude("<PartNumber>2</PartNumber>");
    expect(completionBody).toInclude("<PartNumber>3</PartNumber>");
    expect(completionBody).toInclude('<ETag>"etag-1"</ETag>');
    expect(completionBody).toInclude('<ETag>"etag-2"</ETag>');
    expect(completionBody).toInclude('<ETag>"etag-3"</ETag>');
  });

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
        partNumber: 2,
        previousParts: [{ partNumber: 1, etag: '"etag"' }],
      });
    }).toThrow("previousParts requires uploadId");
  });

  it("should throw when previousParts entry has partNumber >= starting partNumber", () => {
    const client = new S3Client({
      ...s3Options,
      endpoint: "http://localhost:1",
    });

    expect(() => {
      client.file("test").writer({
        uploadId: "abc",
        partNumber: 3,
        previousParts: [
          { partNumber: 1, etag: '"e1"' },
          { partNumber: 3, etag: '"e3"' },
        ],
      });
    }).toThrow("previousParts entry must have a partNumber less than partNumber");
  });

  it("should throw for invalid partNumber range", () => {
    const client = new S3Client({
      ...s3Options,
      endpoint: "http://localhost:1",
    });

    expect(() => {
      client.file("test").writer({ uploadId: "abc", partNumber: 0 });
    }).toThrow("partNumber");

    expect(() => {
      client.file("test").writer({ uploadId: "abc", partNumber: 10002 });
    }).toThrow("partNumber");
  });

  it("should throw for invalid previousParts entries", () => {
    const client = new S3Client({
      ...s3Options,
      endpoint: "http://localhost:1",
    });

    expect(() => {
      client.file("test").writer({
        uploadId: "abc",
        partNumber: 2,
        // @ts-expect-error missing etag
        previousParts: [{ partNumber: 1 }],
      });
    }).toThrow("etag");
  });

  it("should throw when partNumber > 1 without previousParts", () => {
    const client = new S3Client({
      ...s3Options,
      endpoint: "http://localhost:1",
    });

    expect(() => {
      client.file("test").writer({ uploadId: "abc", partNumber: 2 });
    }).toThrow("previousParts");
  });

  it("should not use single PUT when resuming with small data", async () => {
    const uploadId = randomUUID();
    let putCalled = false;
    let completionCalled = false;

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
          return new Response(undefined, {
            status: 200,
            headers: { ETag: '"etag-new"' },
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
  });

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

    // Small buffer — resume state bypasses partSize threshold
    writer.write(Buffer.alloc(1024));
    await writer.end();

    // All requests with uploadId should use the same provided upload ID
    expect(capturedUploadIds.length).toBeGreaterThan(0);
    for (const id of capturedUploadIds) {
      expect(id).toBe(uploadId);
    }
  });

  it("should propagate server rejection of resumed upload", async () => {
    const uploadId = randomUUID();

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        // Reject all multipart requests with 404
        if (url.search.includes("uploadId=") || url.search.includes("partNumber=")) {
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?>
            <Error>
              <Code>NoSuchUpload</Code>
              <Message>The specified upload does not exist.</Message>
            </Error>`,
            { status: 404, headers: { "Content-Type": "text/xml" } },
          );
        }

        return new Response("", { status: 200 });
      },
    });

    const client = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
    });

    const writer = client.file("test_rejected").writer({
      uploadId,
      partNumber: 2,
      partSize: 5 * 1024 * 1024,
      previousParts: [{ partNumber: 1, etag: '"etag-1"' }],
    });

    writer.write(Buffer.alloc(1024));
    try {
      await writer.end();
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(Error);
      expect(e.message || e.code || String(e)).not.toBe("");
    }
  });
});
