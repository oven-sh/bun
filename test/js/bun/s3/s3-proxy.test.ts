import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// An S3 operation reads HTTP_PROXY out of the process env map and reads the
// caller's option objects, whose getters run arbitrary JS. A getter that assigns
// process.env.HTTP_PROXY replaces (and frees) the value in the map, so the proxy
// has to be read after the options. Each fixture runs two stub proxies and has
// the getter assign a different one on every call; the request must arrive at
// the one assigned last, and nowhere else.

const env = { ...bunEnv };
for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"]) delete env[key];
// Current when the operation starts; the getter replaces it before the request is sent.
env.HTTP_PROXY = "http://127.0.0.1:1/";

function fixture(operation: string) {
  return `
const requests = [];
const proxies = [0, 1].map(proxy =>
  Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      requests.push({ proxy, method: req.method, path: new URL(req.url).pathname });
      return req.method === "GET"
        ? new Response("<ListBucketResult/>", { headers: { "Content-Type": "application/xml" } })
        : new Response(null, { status: 204 });
    },
  }),
);

let assignments = 0;
let lastProxy = null;
function reassignProxy() {
  lastProxy = assignments++ % 2;
  process.env.HTTP_PROXY = "http://127.0.0.1:" + proxies[lastProxy].port + "/";
}

// The endpoint is never connected to directly: every request goes to whichever
// stub proxy HTTP_PROXY names at the time the request is sent.
const credentials = { secretAccessKey: "test", bucket: "my_bucket", endpoint: "http://s3.example.invalid/" };
const client = new Bun.S3Client({ ...credentials, accessKeyId: "test" });

function reentrantCredentials(base = {}) {
  return {
    ...base,
    get accessKeyId() {
      reassignProxy();
      return "test";
    },
  };
}

let error = null;
try {
  await (${operation});
} catch (e) {
  error = String(e);
}
for (const proxy of proxies) proxy.stop(true);
console.log(JSON.stringify({ lastProxy, error, requests }));
`;
}

describe("S3 requests use the HTTP_PROXY assigned while their options are being read", () => {
  test.concurrent.each([
    ["S3File#unlink", "DELETE", "/my_bucket/object", `client.file("object").unlink(reentrantCredentials())`],
    ["S3Client#unlink", "DELETE", "/my_bucket/object", `client.unlink("object", reentrantCredentials())`],
    [
      "S3Client.unlink",
      "DELETE",
      "/my_bucket/object",
      `Bun.S3Client.unlink("object", reentrantCredentials(credentials))`,
    ],
    ["S3Client#list with a credentials getter", "GET", "/my_bucket/", `client.list(undefined, reentrantCredentials())`],
    [
      "S3Client#list with a list options getter",
      "GET",
      "/my_bucket/",
      `client.list({ get prefix() { reassignProxy(); return "photos/"; } })`,
    ],
    ["S3Client.list", "GET", "/my_bucket/", `Bun.S3Client.list(undefined, reentrantCredentials(credentials))`],
  ])("%s", async (_name, method, path, operation) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture(operation)],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect(result.lastProxy).not.toBeNull();
    expect(result).toEqual({
      lastProxy: result.lastProxy,
      error: null,
      requests: [{ proxy: result.lastProxy, method, path }],
    });
    expect(exitCode).toBe(0);
  });
});
