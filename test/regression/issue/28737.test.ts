import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("S3 list objects should use 'checksumAlgorithm' not 'checksumAlgorithme'", () => {
  // Spawn a subprocess without proxy env vars so S3Client can reach the local mock server.
  const env = { ...bunEnv };
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.http_proxy;
  delete env.https_proxy;

  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(
            \`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Name>my_bucket</Name>
    <Contents>
        <Key>test-file.txt</Key>
        <ChecksumAlgorithm>SHA256</ChecksumAlgorithm>
        <ChecksumType>FULL_OBJECT</ChecksumType>
        <ETag>&amp;quot;abc123&amp;quot;</ETag>
        <Size>1024</Size>
        <StorageClass>STANDARD</StorageClass>
    </Contents>
</ListBucketResult>\`,
            { headers: { "Content-Type": "application/xml" }, status: 200 },
          );
        },
      });
      server.unref();

      const client = new Bun.S3Client({
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "eu-west-3",
        bucket: "my_bucket",
        endpoint: server.url.href,
      });

      const res = await client.list();
      const item = res.contents[0];
      const result = {
        checksumAlgorithm: item.checksumAlgorithm,
        checksumType: item.checksumType,
        hasOldTypo: "checksumAlgorithme" in item,
      };
      console.log(JSON.stringify(result));
      server.stop(true);
      `,
    ],
    env,
  });

  const out = stdout.toString().trim();
  const err = stderr.toString();
  expect(err).not.toContain("error:");
  expect(out).not.toBe("");
  const result = JSON.parse(out);
  expect(result).toEqual({
    checksumAlgorithm: "SHA256",
    checksumType: "FULL_OBJECT",
    hasOldTypo: false,
  });
  expect(exitCode).toBe(0);
});
