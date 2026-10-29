const objects = new Map<string, string>();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const key = new URL(request.url).pathname;
    const signed = (request.headers.get("authorization") ?? "").startsWith(
      "AWS4-HMAC-SHA256 Credential=an-access-key/",
    );
    if (!signed) return new Response("not signed", { status: 403 });
    if (request.method === "PUT") {
      objects.set(key, await request.text());
      return new Response(null, { status: 200, headers: { etag: '"1"' } });
    }
    const body = objects.get(key);
    if (body === undefined)
      return new Response("<Error><Code>NoSuchKey</Code><Message>no such key</Message></Error>", { status: 404 });
    return new Response(request.method === "HEAD" ? null : body, {
      headers: { "content-length": String(body.length), etag: '"1"' },
    });
  },
});

const client = new Bun.S3Client({
  endpoint: `http://127.0.0.1:${server.port}`,
  bucket: "a-bucket",
  region: "us-east-1",
  accessKeyId: "an-access-key",
  secretAccessKey: "a-secret",
});
console.log(await client.write("folder/file.txt", "kept in the bucket"));
console.log(await client.file("folder/file.txt").text());
console.log(await client.exists("folder/file.txt"), await client.exists("folder/nothing.txt"));
const presigned = new URL(client.presign("folder/file.txt", { expiresIn: 60 }));
console.log(
  presigned.pathname,
  presigned.searchParams.get("X-Amz-Algorithm"),
  presigned.searchParams.get("X-Amz-Signature")?.length,
);
console.log(
  await Bun.file(`s3://a-bucket/folder/file.txt`, {
    endpoint: `http://127.0.0.1:${server.port}`,
    accessKeyId: "an-access-key",
    secretAccessKey: "a-secret",
  } as never).text(),
);
server.stop(true);
