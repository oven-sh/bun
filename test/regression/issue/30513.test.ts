// Regression test for https://github.com/oven-sh/bun/issues/30513.
//
// The scoped-registry URL and the `_authToken` live at different paths on
// the same host — a common GitLab consumer pattern where packages are
// *published* per-project but *consumed* through the instance-wide
// endpoint. The tarball URL returned in metadata is under the token's
// path (`/api/v4/projects/568/...`) but the registry URL is not
// (`/api/v4/packages/npm/...`). bun ≤ 1.3.10 sent the token because it
// only compared hostnames; 1.3.11 started comparing host *and* path
// exactly and stopped sending the token, so the tarball fetch 404s.
//
// Fix: match the request URL against every `_authToken` nerf dart at
// request time (longest-prefix wins), matching npm's behaviour.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

type TarballHit = { url: string; authorization: string | null };

const TOKEN = "GLPAT-EXAMPLE-TOKEN-xyz";
const PKG_NAME = "@altpay/web-ui-kit";
const PKG_VERSION = "0.3.6";
// Matches GitLab: metadata lives at the instance-level path, but the
// tarball URL inside the metadata resolves to a project-level path.
const METADATA_PATH = "/api/v4/packages/npm";
const TARBALL_PATH = "/api/v4/projects/568/packages/npm";

// A minimal gzipped tarball containing just a `package.json`. Generated
// once at module load and reused across tests so each test is stable.
function makeTarball(): Buffer {
  // Build a `package/package.json` tar entry (512 bytes header + 512-byte
  // aligned body), then two 512-byte zero blocks as the end-of-archive
  // marker, then gzip the whole thing with Bun.gzipSync.
  const body = Buffer.from(JSON.stringify({ name: PKG_NAME, version: PKG_VERSION }));
  const bodyBlockSize = Math.ceil(body.length / 512) * 512;
  const bodyBlock = Buffer.alloc(bodyBlockSize);
  body.copy(bodyBlock);

  const header = Buffer.alloc(512);
  header.write("package/package.json", 0, "ascii"); // name
  header.write("0000644 ", 100, "ascii"); // mode
  header.write("0000000 ", 108, "ascii"); // uid
  header.write("0000000 ", 116, "ascii"); // gid
  header.write(body.length.toString(8).padStart(11, "0") + " ", 124, "ascii"); // size
  header.write("00000000000 ", 136, "ascii"); // mtime
  header.write("        ", 148, "ascii"); // placeholder for checksum while computing
  header.write("0", 156, "ascii"); // typeflag (regular file)
  header.write("ustar\x0000", 257, "binary"); // magic + version
  // Compute checksum over the header with spaces in the checksum slot.
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\x00 ", 148, "ascii");

  const trailer = Buffer.alloc(1024);
  const tar = Buffer.concat([header, bodyBlock, trailer]);
  return Buffer.from(Bun.gzipSync(tar));
}
const TARBALL = makeTarball();

const tarballHits: TarballHit[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = decodeURIComponent(url.pathname);

      // Metadata: instance-level endpoint. For this regression we only
      // care about auth on the tarball request, so the metadata endpoint
      // happily serves the response whether or not auth was sent.
      if (path === `${METADATA_PATH}/${PKG_NAME}`) {
        const manifest = {
          name: PKG_NAME,
          "dist-tags": { latest: PKG_VERSION },
          versions: {
            [PKG_VERSION]: {
              name: PKG_NAME,
              version: PKG_VERSION,
              dist: {
                tarball: `http://${url.host}${TARBALL_PATH}/${PKG_NAME}/-/${PKG_NAME}-${PKG_VERSION}.tgz`,
                shasum: Bun.SHA1.hash(TARBALL, "hex"),
              },
            },
          },
        };
        return Response.json(manifest);
      }

      // Tarball: project-level endpoint. We record what auth header the
      // client sent so the assertions below can verify that the token
      // keyed to this path actually travelled on the request.
      if (path === `${TARBALL_PATH}/${PKG_NAME}/-/${PKG_NAME}-${PKG_VERSION}.tgz`) {
        tarballHits.push({
          url: req.url,
          authorization: req.headers.get("authorization"),
        });
        // Mirror GitLab: 404 on unauthenticated package-registry
        // requests. With the fix, the token reaches us and we hand
        // back the tarball.
        if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) {
          return new Response("not found", { status: 404 });
        }
        return new Response(TARBALL, {
          headers: { "content-type": "application/octet-stream" },
        });
      }

      return new Response("unexpected path: " + path, { status: 500 });
    },
  });
});

afterAll(() => {
  server?.stop(true);
});

test("auth token applies to tarball URL when token path diverges from registry URL path", async () => {
  tarballHits.length = 0;
  const origin = `http://${server.hostname}:${server.port}`;
  using cacheDir = tempDir("issue-30513-cache", {});
  using dir = tempDir("issue-30513", {
    "package.json": JSON.stringify({
      name: "issue-30513-consumer",
      version: "0.0.0",
      dependencies: { [PKG_NAME]: PKG_VERSION },
    }),
    // The two `.npmrc` paths deliberately diverge:
    //  - scoped-registry path: /api/v4/packages/npm/
    //  - _authToken nerf-dart: /api/v4/projects/568/packages/npm/
    // Neither is a prefix of the other. The tarball URL from the
    // metadata response *is* under the auth nerf-dart; 1.3.11+ stopped
    // sending the token on that request. With the fix, the longest-
    // prefix match of the tarball URL picks up the token.
    ".npmrc": [
      `@altpay:registry=${origin}${METADATA_PATH}/`,
      `//${server.hostname}:${server.port}${TARBALL_PATH}/:_authToken=${TOKEN}`,
      `always-auth=true`,
    ].join("\n"),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: String(cacheDir) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // The stable signal for this regression is the recorded Authorization
  // header on the tarball request; the reporter-output assertions
  // (stdout progress, non-empty stderr) vary with install's reporter.
  expect({ exitCode, hasError: stderr.includes("error:"), tarballAuthHeaders: tarballHits.map(h => h.authorization) }).toEqual({
    exitCode: 0,
    hasError: false,
    tarballAuthHeaders: [`Bearer ${TOKEN}`],
  });
});

test("parent-path nerf-dart covers deeper scoped-registry URL (related: #28233)", async () => {
  // The token is scoped to the root of the host; the scoped registry
  // lives under `/api/v4/packages/npm/`. npm's longest-prefix rule
  // means the root token must authenticate requests to that scoped
  // registry. Covering this with the same code path that fixes #30513
  // confirms the request-time lookup handles both directions — parent
  // of (this case) and divergent (the primary test above) — uniformly.
  tarballHits.length = 0;
  const origin = `http://${server.hostname}:${server.port}`;
  using cacheDir = tempDir("issue-30513-parent-cache", {});
  using dir = tempDir("issue-30513-parent", {
    "package.json": JSON.stringify({
      name: "issue-30513-parent-consumer",
      version: "0.0.0",
      dependencies: { [PKG_NAME]: PKG_VERSION },
    }),
    ".npmrc": [
      `@altpay:registry=${origin}${METADATA_PATH}/`,
      // Token keyed to the bare host — parent of both paths used by
      // the mock server. With just the pre-1.3.11 host-only check this
      // worked; with exact-path matching it stopped working; with
      // request-time longest-prefix it works again.
      `//${server.hostname}:${server.port}/:_authToken=${TOKEN}`,
      `always-auth=true`,
    ].join("\n"),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: String(cacheDir) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect({ exitCode, hasError: stderr.includes("error:"), tarballAuthHeaders: tarballHits.map(h => h.authorization) }).toEqual({
    exitCode: 0,
    hasError: false,
    tarballAuthHeaders: [`Bearer ${TOKEN}`],
  });
});

test("longest nerf-dart wins when multiple entries could match the request URL", async () => {
  // Sanity: a broader root-path token must lose to a deeper project-
  // level token on the same host, so the "most specific wins" rule from
  // npm is observed at request time.
  tarballHits.length = 0;
  const origin = `http://${server.hostname}:${server.port}`;
  using cacheDir = tempDir("issue-30513-longest-cache", {});
  using dir = tempDir("issue-30513-longest", {
    "package.json": JSON.stringify({
      name: "issue-30513-longest-consumer",
      version: "0.0.0",
      dependencies: { [PKG_NAME]: PKG_VERSION },
    }),
    ".npmrc": [
      `@altpay:registry=${origin}${METADATA_PATH}/`,
      // Root-host token: wrong value, should be ignored for the tarball
      // because a more specific nerf-dart below matches the tarball URL.
      `//${server.hostname}:${server.port}/:_authToken=wrong-root-token`,
      // Project-level token: the correct one.
      `//${server.hostname}:${server.port}${TARBALL_PATH}/:_authToken=${TOKEN}`,
      `always-auth=true`,
    ].join("\n"),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: String(cacheDir) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect({ exitCode, hasError: stderr.includes("error:"), tarballAuthHeaders: tarballHits.map(h => h.authorization) }).toEqual({
    exitCode: 0,
    hasError: false,
    tarballAuthHeaders: [`Bearer ${TOKEN}`],
  });
});
