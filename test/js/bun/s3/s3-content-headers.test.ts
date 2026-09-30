import { S3Client, type S3File, type S3Options } from "bun";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";
import { serve, type S3Server } from "s3-server";

// `contentDisposition` and `contentEncoding` given to a client or to a file are the defaults of
// each upload of that file. A value in the options of the upload takes priority.

const content = {
  contentDisposition: 'attachment; filename="report.csv"',
  contentEncoding: "identity",
} as const satisfies S3Options;

/** The two headers of each request that the server got, and the ones that the signature covers. */
function requests(server: S3Server) {
  return server.requests.map(({ operation, headers }) => {
    const signed = /SignedHeaders=([^,]*)/.exec(headers.get("authorization") ?? "")?.[1].split(";") ?? [];
    return {
      operation,
      "content-disposition": headers.get("content-disposition"),
      "content-encoding": headers.get("content-encoding"),
      signed: ["content-disposition", "content-encoding"].filter(name => signed.includes(name)),
    };
  });
}

const sent = (operation: string, contentDisposition: string = content.contentDisposition) => ({
  operation,
  "content-disposition": contentDisposition,
  "content-encoding": content.contentEncoding,
  signed: ["content-disposition", "content-encoding"],
});

const notSent = (operation: string) => ({
  operation,
  "content-disposition": null,
  "content-encoding": null,
  signed: [],
});

const streamOf = (text: string) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

async function writeWithWriter(file: S3File, data: string | Uint8Array, options?: S3Options) {
  const writer = options === undefined ? file.writer() : file.writer(options);
  writer.write(data);
  await writer.end();
}

// Not concurrent: on a debug build, uploads that run at the same time each take as long as all of them.
describe("S3 contentDisposition and contentEncoding", () => {
  const uploads: [string, (file: S3File, localFile: string) => unknown][] = [
    ["write(string)", file => file.write("hello")],
    ["write(empty string)", file => file.write("")],
    ["write(Bun.file())", (file, localFile) => file.write(Bun.file(localFile))],
    ["write(Response of a stream)", file => file.write(new Response(streamOf("hello")))],
    ["write(string, {})", file => file.write("hello", {})],
    ["Bun.write(file, string)", file => Bun.write(file, "hello")],
    ["Bun.write(file, ReadableStream)", file => Bun.write(file, streamOf("hello"))],
    ["writer()", file => writeWithWriter(file, "hello")],
    ["writer({})", file => writeWithWriter(file, "hello", {})],
  ];

  test.each(uploads)("%s sends the values of client.file(key, options)", async (_, upload) => {
    using dir = tempDir("s3-content-headers", { "local.txt": "hello" });
    await using server = serve({ buckets: ["bucket"] });
    const file = new S3Client(server.clientOptions("bucket")).file("key", content);

    await upload(file, path.join(String(dir), "local.txt"));

    expect(requests(server)).toEqual([sent("PutObject")]);
  });

  // The last three rows give the options to the upload. They pass without the options of a file.
  const withOptions = (server: S3Server) => ({ ...server.clientOptions("bucket"), ...content });
  const plainClient = (server: S3Server) => new S3Client(server.clientOptions("bucket"));
  const entryPoints: [string, (server: S3Server) => unknown][] = [
    ["S3Client.file(key, options).write(data)", server => S3Client.file("key", withOptions(server)).write("hello")],
    [
      "new S3Client(options).file(key).write(data)",
      server => new S3Client(withOptions(server)).file("key").write("hello"),
    ],
    [
      "new S3Client(options).file(key).writer()",
      server => writeWithWriter(new S3Client(withOptions(server)).file("key"), "hello"),
    ],
    ["new S3Client(options).write(key, data)", server => new S3Client(withOptions(server)).write("key", "hello")],
    [
      "new S3Client({ contentEncoding }).write(key, data, { contentDisposition })",
      server =>
        new S3Client({ ...server.clientOptions("bucket"), contentEncoding: content.contentEncoding }).write(
          "key",
          "hello",
          { contentDisposition: content.contentDisposition },
        ),
    ],
    ["client.write(key, data, options)", server => plainClient(server).write("key", "hello", content)],
    ["S3Client.write(key, data, options)", server => S3Client.write("key", "hello", withOptions(server))],
    [
      "S3Client.write(file, data, options)",
      // The declared type of the first parameter is `string`. The function also takes an S3 file.
      server => (S3Client.write as any)(plainClient(server).file("key"), "hello", content),
    ],
  ];

  test.each(entryPoints)("%s sends both values", async (_, upload) => {
    await using server = serve({ buckets: ["bucket"] });

    await upload(server);

    expect(requests(server)).toEqual([sent("PutObject")]);
  });

  test("a value of the upload wins over the file, and a value of the file wins over the client", async () => {
    await using server = serve({ buckets: ["bucket"] });
    const client = new S3Client({ ...server.clientOptions("bucket"), ...content, contentDisposition: "inline" });
    const file = client.file("key", { contentDisposition: "attachment" });
    const ofUpload = { contentDisposition: 'attachment; filename="upload.csv"' };

    await file.write("hello");
    await file.write("hello", ofUpload);
    await writeWithWriter(file, "hello", ofUpload);
    // The options of an upload do not stay on the file.
    await writeWithWriter(file, "hello");
    await client.file("other-key").write("hello");

    expect(requests(server)).toEqual([
      sent("PutObject", "attachment"),
      sent("PutObject", ofUpload.contentDisposition),
      sent("PutObject", ofUpload.contentDisposition),
      sent("PutObject", "attachment"),
      sent("PutObject", "inline"),
    ]);
  });

  test("a multipart upload sends the values of file() with CreateMultipartUpload", async () => {
    await using server = serve({ buckets: ["bucket"] });
    const file = new S3Client(server.clientOptions("bucket")).file("key", content);

    await writeWithWriter(file, Buffer.alloc(5 * 1024 * 1024 + 1, "a"));

    expect(requests(server).sort((a, b) => a.operation.localeCompare(b.operation))).toEqual([
      notSent("CompleteMultipartUpload"),
      sent("CreateMultipartUpload"),
      notSent("UploadPart"),
      notSent("UploadPart"),
    ]);
  });

  test("only uploads use the values of file()", async () => {
    await using server = serve({ buckets: ["bucket"] });
    const client = new S3Client({ ...server.clientOptions("bucket"), ...content });
    const file = client.file("key", content);
    await file.write("hello");
    server.requests.length = 0;

    await file.stat();
    await file.text();
    await client.list();
    await file.delete();

    expect(requests(server)).toEqual([
      notSent("HeadObject"),
      notSent("GetObject"),
      notSent("ListObjectsV2"),
      notSent("DeleteObject"),
    ]);
    // A presigned URL has the value of the options of `presign()` only.
    const responseContentDisposition = (url: string) => new URL(url).searchParams.get("response-content-disposition");
    expect({
      "presign()": responseContentDisposition(file.presign()),
      "presign({ expiresIn })": responseContentDisposition(file.presign({ expiresIn: 60 })),
      "presign({ contentDisposition })": responseContentDisposition(file.presign({ contentDisposition: "inline" })),
    }).toEqual({
      "presign()": null,
      "presign({ expiresIn })": null,
      "presign({ contentDisposition })": "inline",
    });
  });
});
