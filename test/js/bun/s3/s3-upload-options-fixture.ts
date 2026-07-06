// Spawned by s3-upload-options.test.ts. Records the headers Bun actually sends
// for an upload, once per entry point that accepts an `S3Options` bag, and
// prints them as JSON.
import type { S3Options } from "bun";

const uploadOptions = {
  acl: "public-read",
  storageClass: "STANDARD_IA",
  type: "text/csv",
  contentDisposition: "attachment",
  contentEncoding: "gzip",
} as const;

let put: Headers | undefined;
let createMultipartUpload: Headers | undefined;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.method === "POST" && req.url.includes("uploads=")) {
      createMultipartUpload = req.headers;
      await req.arrayBuffer();
      return new Response(
        `<InitiateMultipartUploadResult><UploadId>an-upload-id</UploadId></InitiateMultipartUploadResult>`,
      );
    }
    if (req.method === "POST" && req.url.includes("uploadId=")) {
      await req.arrayBuffer();
      return new Response(`<CompleteMultipartUploadResult><ETag>"an-etag"</ETag></CompleteMultipartUploadResult>`);
    }
    if (req.method === "PUT" && !req.url.includes("partNumber=")) {
      put = req.headers;
    }
    await req.arrayBuffer();
    return new Response("", { headers: { ETag: `"an-etag"` } });
  },
});

const s3Options: S3Options = {
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "eu-west-3",
  bucket: "my_bucket",
  endpoint: server.url.href,
};

const sent: Record<string, Record<string, string | null>> = {};

/** `from` names the request whose headers carry the upload options. */
async function record(name: string, from: "put" | "createMultipartUpload", upload: () => Promise<unknown>) {
  put = undefined;
  createMultipartUpload = undefined;
  await upload();
  const headers = from === "put" ? put : createMultipartUpload;
  if (!headers) throw new Error(`${name}: no ${from} request was sent`);
  sent[name] = {
    acl: headers.get("x-amz-acl"),
    storageClass: headers.get("x-amz-storage-class"),
    type: headers.get("content-type"),
    contentDisposition: headers.get("content-disposition"),
    contentEncoding: headers.get("content-encoding"),
  };
}

const client = new Bun.S3Client(s3Options);
const clientWithOptions = new Bun.S3Client({ ...s3Options, ...uploadOptions });

await record("client.write(key, data, options)", "put", () => client.write("a_file", "Hello Bun!", uploadOptions));

await record("client.file(key, options).write(data)", "put", () =>
  client.file("a_file", uploadOptions).write("Hello Bun!"),
);

await record("new S3Client(options).write(key, data)", "put", () => clientWithOptions.write("a_file", "Hello Bun!"));

await record("new S3Client(options).file(key).write(data)", "put", () =>
  clientWithOptions.file("a_file").write("Hello Bun!"),
);

await record("client.file(key).writer(options)", "put", async () => {
  const writer = client.file("a_file").writer(uploadOptions);
  writer.write("Hello Bun!");
  await writer.end();
});

await record("client.file(key, options).writer()", "put", async () => {
  const writer = client.file("a_file", uploadOptions).writer();
  writer.write("Hello Bun!");
  await writer.end();
});

// Larger than `partSize`, so the upload goes through CreateMultipartUpload
// instead of a single PUT.
await record("client.file(key).writer(options) [multipart]", "createMultipartUpload", async () => {
  const writer = client.file("a_file").writer({ ...uploadOptions, partSize: 5 * 1024 * 1024 });
  writer.write(Buffer.alloc(6 * 1024 * 1024));
  await writer.end();
});

await record("per-call options override the handle's", "put", () =>
  clientWithOptions
    .file("a_file", { acl: "private", contentDisposition: "inline" })
    .write("Hello Bun!", { contentEncoding: "br" }),
);

console.log(JSON.stringify(sent));
server.stop(true);
