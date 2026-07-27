import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// S3 stores the PUT request's Content-Type as object metadata and serves it
// back verbatim, so a wrong header means images / HTML / JSON download instead
// of rendering. This test drives uploads against a local recording origin and
// asserts the Content-Type header that reached it.
//
// The S3 client does not honor NO_PROXY, so an inherited proxy would hijack
// the request to the stub server. Run the fixture in a subprocess with proxy
// env stripped.
const envWithoutProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

const fixture = /* js */ `
import path from "node:path";

let last;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.method === "PUT") last = req.headers.get("content-type");
    await req.arrayBuffer();
    return new Response("", { status: 200, headers: { ETag: '"e"' } });
  },
});

const client = new Bun.S3Client({
  endpoint: server.url.href,
  bucket: "b",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
});

const png = Bun.file(path.join(import.meta.dir, "logo.png"));
const noext = Bun.file(path.join(import.meta.dir, "noext"));

async function put(fn) {
  last = undefined;
  await fn();
  return last ?? null;
}

const results = {
  bunfile_extless_key: await put(() => client.write("uploads/8f3a1c", png)),
  bun_write_bunfile: await put(() => Bun.write(client.file("assets/logo"), png)),
  blob_type_extless_key: await put(() => client.write("noext", new Blob(['{"a":1}'], { type: "application/json" }))),
  blob_type_overrides_key_ext: await put(() => client.write("page.txt", new Blob(["<p>hi</p>"], { type: "text/html" }))),
  response_header: await put(() => client.write("noext-resp", new Response("a,b", { headers: { "content-type": "text/csv" } }))),
  response_header_over_blob_type: await put(() => client.write("noext-resp", new Response(new Blob(["<p>"], { type: "text/html" }), { headers: { "content-type": "text/csv" } }))),
  response_null_body_header: await put(() => client.write("noext-resp", new Response(null, { headers: { "content-type": "text/csv" } }))),
  request_header: await put(() => client.write("noext-req", new Request("http://x/", { method: "POST", body: "a,b", headers: { "content-type": "text/csv" } }))),
  explicit_type_option: await put(() => client.write("uploads/8f3a1c", png, { type: "text/plain" })),
  key_ext_fallback_bytes: await put(() => client.write("photo.png", new Uint8Array([1, 2, 3]))),
  key_ext_fallback_noext_file: await put(() => client.write("data.json", noext)),
  key_ext_fallback_typeless_blob: await put(() => client.write("data.json", new Blob(["{}"]))),
};

process.stdout.write(JSON.stringify(results));
server.stop(true);
`;

test("s3 upload Content-Type is taken from the body (Blob.type / Bun.file / Response header)", async () => {
  using dir = tempDir("s3-upload-content-type", {
    "fixture.ts": fixture,
    "logo.png": Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    "noext": "hello",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(String(dir), "fixture.ts")],
    env: envWithoutProxy,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const results = JSON.parse(stdout) as Record<string, string | null>;

  // Without the fix these send application/octet-stream (or text/plain for
  // page.txt), dropping the body's own type.
  expect(results.bunfile_extless_key).toBe("image/png");
  expect(results.bun_write_bunfile).toBe("image/png");
  expect(results.blob_type_extless_key).toStartWith("application/json");
  expect(results.blob_type_overrides_key_ext).toStartWith("text/html");
  expect(results.response_header).toBe("text/csv");
  expect(results.response_header_over_blob_type).toBe("text/csv");
  expect(results.response_null_body_header).toBe("text/csv");
  expect(results.request_header).toBe("text/csv");

  // Controls: these must keep working exactly as before.
  expect(results.explicit_type_option).toStartWith("text/plain");
  expect(results.key_ext_fallback_bytes).toBe("image/png");
  expect(results.key_ext_fallback_noext_file).toStartWith("application/json");
  expect(results.key_ext_fallback_typeless_blob).toStartWith("application/json");

  expect(exitCode).toBe(0);
});
