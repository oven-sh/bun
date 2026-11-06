const answers: Record<string, string> = {
  list: `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>box</Name><KeyCount>1</KeyCount><IsTruncated>false</IsTruncated><Contents><Key>a.txt</Key><Size>3</Size><ETag>"tag"</ETag><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents></ListBucketResult>`,
  missing: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>There is no such key.</Message></Error>`,
};
const server = Bun.serve({
  port: 0,
  fetch(request: Request) {
    const isList = new URL(request.url).searchParams.has("list-type");
    return new Response(isList ? answers.list : answers.missing, {
      status: isList ? 200 : 404,
      headers: { "content-type": "application/xml" },
    });
  },
});
const client = new Bun.S3Client({
  endpoint: `http://localhost:${server.port}`,
  accessKeyId: "id",
  secretAccessKey: "secret",
  bucket: "box",
});
const listed = await client.list();
console.log(listed.name, listed.keyCount, listed.contents?.[0]?.key, listed.contents?.[0]?.size);
console.log(
  await client
    .file("nothing.txt")
    .text()
    .catch((error: any) => `${error.code}: ${error.message}`),
);
await server.stop(true);
