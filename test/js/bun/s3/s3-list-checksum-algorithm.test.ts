import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/19142
// S3Client.list() exposed contents[i].checksumAlgorithme (trailing 'e') instead
// of checksumAlgorithm, contradicting the declared type in bun-types/s3.d.ts.
// The correct spelling is now the enumerable property; the old spelling is kept
// as a non-enumerable alias so existing code that read it does not break.
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
const entry = res.contents?.[0];
console.log(
  JSON.stringify({
    keys: Object.keys(entry).sort(),
    checksumAlgorithm: entry.checksumAlgorithm,
    checksumAlgorithme: entry.checksumAlgorithme,
    aliasDescriptor: Object.getOwnPropertyDescriptor(entry, "checksumAlgorithme"),
  }),
);
`;

test("S3Client.list() exposes contents[].checksumAlgorithm with a non-enumerable checksumAlgorithme alias", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: envWithoutProxy,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    keys: ["checksumAlgorithm", "checksumType", "key"],
    checksumAlgorithm: "SHA256",
    checksumAlgorithme: "SHA256",
    aliasDescriptor: {
      value: "SHA256",
      writable: true,
      enumerable: false,
      configurable: true,
    },
  });
  expect(exitCode).toBe(0);
});
