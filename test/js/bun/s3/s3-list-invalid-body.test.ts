import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The S3 client does not honor NO_PROXY, so an inherited proxy would hijack the
// request to the stub server. Run the fixture in a subprocess with proxy vars
// cleared so the assertion exercises the parser, not the proxy.
const envWithoutProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

const fixture = `
import { S3Client } from "bun";

const truncated =
  '<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
  "<KeyCount>3</KeyCount><IsTruncated>false</IsTruncated>" +
  "<Contents><Key>k1</Key></Contents>" +
  "<Contents><Key>k2</Key></Contents>" +
  "<Contents><Ke";

const bodies: Record<string, string> = {
  html: "<html><body><h1>502 Bad Gateway</h1></body></html>",
  empty: "",
  json: '{"contents":[{"key":"j"}]}',
  "wrong-root":
    '<?xml version="1.0"?><ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Buckets/></ListAllMyBucketsResult>',
  binary: Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x3c, 0x00]).toString("binary"),
  "error-document":
    '<?xml version="1.0"?><Error><Code>InternalError</Code><Message>We encountered an internal error. Please try again.</Message></Error>',
  truncated,
  ok: '<?xml version="1.0"?><ListBucketResult><Name>b</Name></ListBucketResult>',
};

using server = Bun.serve({
  port: 0,
  fetch(req) {
    const name = new URL(req.url).pathname.split("/")[1];
    return new Response(bodies[name]!, {
      headers: { "Content-Type": "application/xml" },
      status: 200,
    });
  },
});

const results: Record<string, unknown> = {};
for (const name of Object.keys(bodies)) {
  const client = new S3Client({
    accessKeyId: "AK",
    secretAccessKey: "SK",
    region: "us-east-1",
    endpoint: server.url.href,
    bucket: name,
  });
  try {
    results[name] = { resolved: await client.list() };
  } catch (e: any) {
    results[name] = { name: e.name, code: e.code };
  }
}

console.log(JSON.stringify(results));
`;

test("S3Client.list() rejects when a 200 response body is not a ListBucketResult", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: envWithoutProxy,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    html: { name: "S3Error", code: "UnknownError" },
    empty: { name: "S3Error", code: "UnknownError" },
    json: { name: "S3Error", code: "UnknownError" },
    "wrong-root": { name: "S3Error", code: "UnknownError" },
    binary: { name: "S3Error", code: "UnknownError" },
    "error-document": { name: "S3Error", code: "InternalError" },
    truncated: { name: "S3Error", code: "UnknownError" },
    ok: { resolved: { name: "b" } },
  });
  expect(exitCode).toBe(0);
});
