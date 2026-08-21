import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// CompleteMultipartUpload echoes the ETag response header of every UploadPart
// back to the endpoint inside an XML body. An ETag may legally contain `&`, `<`
// and `>` (RFC 9110 etagc), which XML character data cannot hold as is.
const partEtags: Record<number, string> = {
  1: '"a&b<c>d"',
  2: '"0123456789abcdef0123456789abcdef"',
  3: 'W/"weak&tag"',
};

// The S3 client does not honor NO_PROXY, so an inherited proxy would hijack
// the request to the stub server. Run in a subprocess with proxy env cleared.
const envWithoutProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

const fixture = `
const partEtags = ${JSON.stringify(partEtags)};
let completeBody = null;

using server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.searchParams.has("uploads")) {
      return new Response(
        "<InitiateMultipartUploadResult><Bucket>bucket</Bucket><Key>obj</Key><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
        { headers: { "Content-Type": "application/xml" } },
      );
    }
    if (req.method === "PUT" && url.searchParams.has("partNumber")) {
      await req.arrayBuffer();
      return new Response(null, { headers: { ETag: partEtags[url.searchParams.get("partNumber")] } });
    }
    if (req.method === "POST" && url.searchParams.get("uploadId") === "upload-1") {
      completeBody = await req.text();
      return new Response(
        '<CompleteMultipartUploadResult><Bucket>bucket</Bucket><Key>obj</Key><ETag>"final"</ETag></CompleteMultipartUploadResult>',
        { headers: { "Content-Type": "application/xml" } },
      );
    }
    return new Response("unexpected " + req.method + " " + url.search, { status: 500 });
  },
});

const client = new Bun.S3Client({
  accessKeyId: "test",
  secretAccessKey: "test",
  bucket: "bucket",
  endpoint: server.url.href,
});

// 5 MiB is the smallest part size the writer accepts. Two full parts plus a
// short tail give three UploadPart requests and one CompleteMultipartUpload.
const partSize = 5 * 1024 * 1024;
const writer = client.file("obj").writer({ partSize, queueSize: 1 });
writer.write(Buffer.alloc(partSize, "a"));
writer.write(Buffer.alloc(partSize, "b"));
writer.write(Buffer.alloc(16, "c"));
await writer.end();

console.log(JSON.stringify(completeBody));
`;

test("CompleteMultipartUpload escapes the part ETags it writes into the XML body", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: envWithoutProxy,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const body: string = JSON.parse(stdout);
  // `&`, `<` and `>` become entity references. A quote is valid character
  // data, so the usual quoted ETag is written byte for byte as the endpoint
  // sent it.
  expect(body).toBe(
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
      '<Part><PartNumber>1</PartNumber><ETag>"a&amp;b&lt;c&gt;d"</ETag></Part>' +
      '<Part><PartNumber>2</PartNumber><ETag>"0123456789abcdef0123456789abcdef"</ETag></Part>' +
      '<Part><PartNumber>3</PartNumber><ETag>W/"weak&amp;tag"</ETag></Part>' +
      "</CompleteMultipartUpload>",
  );
  // The endpoint parses the body as XML and gets its own ETags back.
  expect(Bun.XML.parse(body)).toEqual({
    CompleteMultipartUpload: {
      "@xmlns": "http://s3.amazonaws.com/doc/2006-03-01/",
      Part: [
        { PartNumber: "1", ETag: partEtags[1] },
        { PartNumber: "2", ETag: partEtags[2] },
        { PartNumber: "3", ETag: partEtags[3] },
      ],
    },
  });
  expect(exitCode).toBe(0);
});
