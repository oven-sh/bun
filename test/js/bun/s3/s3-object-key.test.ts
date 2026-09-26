import { S3Client } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// S3 object keys are opaque byte strings, so `dir`, `dir/` and `/dir` name
// three different objects. Bun must sign and send the key it was given.
const credentials = {
  accessKeyId: "key",
  secretAccessKey: "secret",
  region: "us-east-1",
  endpoint: "http://127.0.0.1:9999",
};

function signedPath(client: S3Client, key: string): string {
  return new URL(client.presign(key)).pathname;
}

test("presign keeps the separators an object key was given", () => {
  const client = new S3Client({ ...credentials, bucket: "bucket" });

  expect({
    plain: signedPath(client, "dir"),
    trailing: signedPath(client, "dir/"),
    leading: signedPath(client, "/dir"),
    both: signedPath(client, "/dir/"),
    repeated: signedPath(client, "//dir//"),
    nested: signedPath(client, "a/b/"),
  }).toEqual({
    plain: "/bucket/dir",
    trailing: "/bucket/dir/",
    leading: "/bucket//dir",
    both: "/bucket//dir/",
    repeated: "/bucket///dir//",
    nested: "/bucket/a/b/",
  });
});

test("presign keeps the separators of a virtual hosted-style object key", () => {
  const client = new S3Client({ ...credentials, bucket: "bucket", virtualHostedStyle: true });

  expect({
    trailing: signedPath(client, "dir/"),
    leading: signedPath(client, "/dir"),
  }).toEqual({
    trailing: "/dir/",
    leading: "//dir",
  });
});

test("an S3 file presigns the same key it reports as its name", () => {
  const client = new S3Client({ ...credentials, bucket: "bucket" });
  const folderMarker = client.file("a/b/");

  expect(folderMarker.name).toBe("a/b/");
  expect(new URL(folderMarker.presign()).pathname).toBe("/bucket/a/b/");
});

const fixture = /* ts */ `
const requests: string[] = [];
await using server = Bun.serve({
  port: 0,
  fetch(req) {
    requests.push(req.method + " " + new URL(req.url).pathname);
    return new Response("", { headers: { ETag: '"etag"' } });
  },
});

const credentials = {
  accessKeyId: "key",
  secretAccessKey: "secret",
  region: "us-east-1",
  endpoint: "http://127.0.0.1:" + server.port,
};

const client = new Bun.S3Client({ ...credentials, bucket: "bucket" });
await client.write("dir/", "value");
await client.write("dir", "value");
await client.file("/lead").text();
await client.file("a/").exists();
await client.delete("x/y/");

// With no bucket configured the first path segment is the bucket; the rest of
// the path is still the object key verbatim.
const fromPath = new Bun.S3Client(credentials);
await fromPath.write("s3://other/dir/", "value");
await fromPath.write("other/nested/dir/", "value");

console.log(JSON.stringify(requests));
`;

test("the object key reaches the wire untrimmed", async () => {
  using dir = tempDir("s3-object-key", { "key-fixture.ts": fixture });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "key-fixture.ts"],
    // Bun.S3Client ignores NO_PROXY, so an inherited proxy would hijack the
    // requests aimed at the stub server. The bucket must come from the client.
    env: {
      ...bunEnv,
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
      S3_BUCKET: undefined,
      AWS_BUCKET: undefined,
      S3_ENDPOINT: undefined,
      AWS_ENDPOINT: undefined,
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // stderr only joins the assertion when the child failed: a successful debug
  // or ASAN build still writes benign warnings there.
  const requests = exitCode === 0 ? JSON.parse(stdout.trim() || "null") : { exitCode, stdout, stderr };

  expect(requests).toEqual([
    "PUT /bucket/dir/",
    "PUT /bucket/dir",
    "GET /bucket//lead",
    "HEAD /bucket/a/",
    "DELETE /bucket/x/y/",
    "PUT /other/dir/",
    "PUT /other/nested/dir/",
  ]);
});
