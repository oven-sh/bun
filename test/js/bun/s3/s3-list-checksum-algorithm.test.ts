import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/19142
// S3Client.list() exposed contents[i].checksumAlgorithme (trailing 'e') instead
// of checksumAlgorithm, contradicting the declared type in bun-types/s3.d.ts.
//
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
import { S3Client } from "bun";

using server = Bun.serve({
  port: 0,
  fetch: () =>
    new Response(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
        "<Contents>" +
        "<Key>file.txt</Key>" +
        "<ChecksumAlgorithm>SHA256</ChecksumAlgorithm>" +
        "<ChecksumType>FULL_OBJECT</ChecksumType>" +
        "</Contents>" +
        "</ListBucketResult>",
      { headers: { "Content-Type": "application/xml" }, status: 200 },
    ),
});

const client = new S3Client({
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "eu-west-3",
  bucket: "my_bucket",
  endpoint: server.url.href,
});

const res = await client.list();
console.log(JSON.stringify(res.contents?.[0]));
`;

test("S3Client.list() exposes contents[].checksumAlgorithm (not checksumAlgorithme)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: envWithoutProxy,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const entry = JSON.parse(stdout.trim());
  expect(entry).toEqual({
    key: "file.txt",
    checksumAlgorithm: "SHA256",
    checksumType: "FULL_OBJECT",
  });
  expect(entry).not.toHaveProperty("checksumAlgorithme");
  expect(exitCode).toBe(0);
});
