import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { exists, rm } from "fs/promises";
import {
  VerdaccioRegistry,
  bunExe,
  bunEnv as env,
  isLinux,
  isWindows,
  normalizeBunSnapshot,
  pack,
  runBunInstall,
  tempDir,
} from "harness";
import { delimiter, join } from "path";

const registry = new VerdaccioRegistry();

/** The bunfig every test that publishes to verdaccio uses: the registry url and one shared token. */
let verdaccioBunfig: string;

beforeAll(async () => {
  await registry.start();
  verdaccioBunfig = await registry.authBunfig("publish-tests");
});

afterAll(() => {
  registry.stop();
});

export async function publish(
  env: any,
  cwd: string,
  ...args: string[]
): Promise<{ out: string; err: string; exitCode: number }> {
  await using proc = spawn({
    cmd: [bunExe(), "publish", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env,
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, exitCode };
}

/**
 * A directory with `package.json` and the auth bunfig for the verdaccio registry. A previous run may have left
 * the package in the registry storage, so that copy is removed first.
 */
async function verdaccioPackage(pkg: { name: string; version: string } & Record<string, unknown>, files = {}) {
  await rm(join(registry.packagesPath, pkg.name), { recursive: true, force: true });
  return tempDir(`publish-${pkg.name.replace(/[@/]/g, "")}`, {
    "package.json": JSON.stringify(pkg),
    "bunfig.toml": verdaccioBunfig,
    ...files,
  });
}

/**
 * `bun publish` prints the tarball checksums and its gzip size, which depend on the platform's tar headers, and
 * the registry port. Replace them so the rest of the output can be compared with an inline snapshot.
 */
function normalizePublishOutput(out: string, port?: number) {
  return normalizeBunSnapshot(port === undefined ? out : out.replaceAll(`localhost:${port}`, "localhost:<port>"))
    .replace(/^Shasum: [0-9a-f]{40}$/m, "Shasum: <sha1>")
    .replace(/^Integrity: sha512-\S+$/m, "Integrity: <sha512>")
    .replace(/^Packed size: \S+$/m, "Packed size: <size>")
    .replace(/^\|-+\|$/gm, "|<border>|");
}

/** The files the summary lists as packed, in the order they went into the tarball. */
function packedFiles(out: string) {
  return out
    .split("\n")
    .filter(line => line.startsWith("packed "))
    .map(line => line.split(" ").slice(2).join(" "));
}

type RegistryRequest = {
  method: string;
  pathname: string;
  authorization: string | null;
  /** the `npm-auth-type` header */
  authType: string | null;
  /** the `npm-otp` header */
  otp: string | null;
  userAgent: string | null;
  /** the JSON body of a PUT, `null` for every other request */
  manifest: any;
};

type MockRegistry = {
  port: number;
  requests: RegistryRequest[];
  [Symbol.dispose](): void;
};

/** A registry that records what `bun publish` sends. `respond` picks the response, the default accepts everything. */
function mockRegistry(
  respond?: (req: Request, recorded: RegistryRequest, mock: MockRegistry) => Response | Promise<Response>,
): MockRegistry {
  const requests: RegistryRequest[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const recorded: RegistryRequest = {
        method: req.method,
        pathname: new URL(req.url).pathname,
        authorization: req.headers.get("authorization"),
        authType: req.headers.get("npm-auth-type"),
        otp: req.headers.get("npm-otp"),
        userAgent: req.headers.get("user-agent"),
        manifest: req.method === "PUT" ? await req.json() : null,
      };
      requests.push(recorded);
      return respond ? respond(req, recorded, mock) : new Response("OK", { status: 200 });
    },
  });
  const mock: MockRegistry = { port: server.port, requests, [Symbol.dispose]: () => server.stop(true) };
  return mock;
}

/** The token the mock registry tests configure. `bun publish` sends it as `authorization: Bearer <token>`. */
const registryToken = "registry-token";

function mockBunfig(mock: MockRegistry) {
  return Bun.TOML.stringify({
    install: { cache: false, registry: { url: `http://localhost:${mock.port}`, token: registryToken } },
  });
}

const userAgent = expect.stringMatching(
  new RegExp(
    `^Bun/${Bun.version.replaceAll(".", "\\.")} ${process.platform} ${process.arch} workspaces/false( ci/\\S+)?$`,
  ),
);

/** A request as `mockRegistry` records it, with the headers `bun publish` sends when no OTP is involved. */
function request(method: string, pathname: string, fields: Partial<RegistryRequest> = {}) {
  return {
    method,
    pathname,
    authorization: `Bearer ${registryToken}`,
    authType: "web",
    otp: null,
    userAgent,
    manifest: method === "PUT" ? expect.any(Object) : null,
    ...fields,
  };
}

/** The tarball inside a PUT body: its entries and the checksums that `dist` and the printed summary must match. */
async function attachedTarball(manifest: any) {
  const [[filename, attachment]] = Object.entries<any>(manifest._attachments);
  const bytes = Buffer.from(attachment.data, "base64");
  return {
    filename,
    length: bytes.length,
    files: [...(await new Bun.Archive(bytes).files()).keys()].sort(),
    shasum: new Bun.CryptoHasher("sha1").update(bytes).digest("hex"),
    integrity: `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`,
  };
}

/** The summary prints the full sha1 and the sha512 with its middle cut out. */
function printedChecksums({ shasum, integrity }: { shasum: string; integrity: string }) {
  const base64 = integrity.slice("sha512-".length);
  return `\nShasum: ${shasum}\nIntegrity: sha512-${base64.slice(0, 13)}[...]${base64.slice(-15)}\n`;
}

/**
 * Asserts that `manifest`, the body of a PUT, is exactly what `bun publish` builds for `pkg` (the package.json
 * that was published) when the registry listens on `port`. Returns the decoded tarball.
 */
async function expectPublishedManifest(
  manifest: any,
  pkg: { name: string; version: string } & Record<string, unknown>,
  port: number,
  opts: { access?: string | null; tag?: string; versionFields?: Record<string, unknown> } = {},
) {
  const tarball = await attachedTarball(manifest);
  const { name, version } = pkg;
  const tarballName = `${name}-${version}.tgz`;
  expect(manifest).toEqual({
    _id: name,
    name,
    "dist-tags": { [opts.tag ?? "latest"]: version },
    versions: {
      [version]: {
        ...pkg,
        ...opts.versionFields,
        _id: `${name}@${version}`,
        _integrity: tarball.integrity,
        _nodeVersion: process.versions.node,
        _npmVersion: "10.8.3",
        integrity: tarball.integrity,
        shasum: tarball.shasum,
        dist: {
          integrity: tarball.integrity,
          shasum: tarball.shasum,
          tarball: `http://localhost:${port}/${name}/-/${tarballName}`,
        },
      },
    },
    access: opts.access ?? null,
    _attachments: {
      [tarballName]: { content_type: "application/octet-stream", data: expect.any(String), length: tarball.length },
    },
  });
  return tarball;
}

describe.concurrent("otp", () => {
  /**
   * The registry for the OTP tests. The first PUT is answered with a 401 that asks for a one-time password, the
   * done url hands out `otp`, and a PUT that carries `otp` in `npm-otp` is accepted.
   */
  function otpRegistry(opts: {
    otp: string;
    /** send `www-authenticate: OTP`. Without it, the body has to mention "one-time password" */
    setAuthHeader?: boolean;
    /** reject the PUT that carries the OTP */
    otpFail?: boolean;
    /** add an `npm-notice` header to the 401 */
    npmNotice?: boolean;
    /** add `x-local-cache`, which tells bun to ignore `npm-notice` */
    xLocalCache?: boolean;
  }) {
    const { otp, setAuthHeader = true, otpFail = false, npmNotice = false, xLocalCache = false } = opts;
    return mockRegistry((req, recorded, mock) => {
      if (req.method === "PUT") {
        if (recorded.otp === otp) {
          if (otpFail) {
            return Response.json(
              { error: "You must provide a one-time pass. Upgrade your client to npm@latest in order to use 2FA." },
              { status: 401 },
            );
          }
          return new Response("OK", { status: 200 });
        }
        const headers = new Headers();
        if (setAuthHeader) headers.set("www-authenticate", "OTP");
        if (npmNotice) headers.set("npm-notice", `visit http://localhost:${mock.port}/auth to login`);
        if (xLocalCache) headers.set("x-local-cache", "true");
        return Response.json(
          {
            // this isn't accurate, but we just want to check that finding this string works
            mock: setAuthHeader ? "" : "one-time password",
            authUrl: `http://localhost:${mock.port}/auth`,
            doneUrl: `http://localhost:${mock.port}/done`,
          },
          { status: 401, headers },
        );
      }
      if (recorded.pathname === "/done") {
        return Response.json({ token: otp });
      }
      // `/auth` is shown to the user. `bun publish` must never request it.
      return new Response(`unexpected request: ${req.method} ${recorded.pathname}`, { status: 500 });
    });
  }

  test.each([
    ["", { setAuthHeader: true }],
    [" (without auth header)", { setAuthHeader: false }],
  ])("mock web login%s", async (_, { setAuthHeader }) => {
    const otp = "otp-1";
    using mock = otpRegistry({ otp, setAuthHeader });
    const pkg = { name: "otp-pkg-1", version: "2.2.2", dependencies: { "otp-pkg-1": "2.2.2" } };
    using dir = tempDir("publish-otp", { "package.json": JSON.stringify(pkg), "bunfig.toml": mockBunfig(mock) });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).toBe("");
    expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 97B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 97B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

      Authenticate your account at (press ENTER to open in browser):
      |<border>|
      | http://localhost:<port>/auth |
      |<border>|

       + otp-pkg-1@2.2.2"
    `);
    expect(mock.requests).toEqual([
      request("PUT", "/otp-pkg-1"),
      request("GET", "/done"),
      request("PUT", "/otp-pkg-1", { authType: "legacy", otp }),
    ]);
    const tarball = await expectPublishedManifest(mock.requests[2].manifest, pkg, mock.port);
    expect(mock.requests[0].manifest).toEqual(mock.requests[2].manifest);
    expect(tarball.files).toEqual(["package/package.json"]);
    expect(out).toContain(printedChecksums(tarball));
    expect(exitCode).toBe(0);
  });

  test("otp failure", async () => {
    const otp = "otp-2";
    using mock = otpRegistry({ otp, otpFail: true });
    using dir = tempDir("publish-otp-failure", {
      "package.json": JSON.stringify({ name: "otp-pkg-2", version: "1.1.1", dependencies: { "otp-pkg-2": "1.1.1" } }),
      "bunfig.toml": mockBunfig(mock),
    });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 97B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 97B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

      Authenticate your account at (press ENTER to open in browser):
      |<border>|
      | http://localhost:<port>/auth |
      |<border>|"
    `);
    expect(err).toBe(`\n401 Unauthorized: http://localhost:${mock.port}/otp-pkg-2\n\n - Received invalid OTP\n`);
    expect(mock.requests).toEqual([
      request("PUT", "/otp-pkg-2"),
      request("GET", "/done"),
      request("PUT", "/otp-pkg-2", { authType: "legacy", otp }),
    ]);
    expect(exitCode).toBe(1);
  });

  test("non-http auth url is shown without launching a browser and login completes via done url polling", async () => {
    const otp = "otp-5";
    using mock = mockRegistry((req, recorded, mock) => {
      if (req.method === "PUT") {
        if (recorded.otp === otp) {
          return new Response("OK", { status: 200 });
        }
        return Response.json(
          { authUrl: "customapp://login", doneUrl: `http://localhost:${mock.port}/done` },
          { status: 401, headers: { "www-authenticate": "OTP" } },
        );
      }
      if (recorded.pathname === "/done") {
        return Response.json({ token: otp });
      }
      return new Response("unexpected url", { status: 500 });
    });
    using dir = tempDir("publish-otp-custom-app", {
      "package.json": JSON.stringify({ name: "otp-pkg-5", version: "5.5.5", dependencies: { "otp-pkg-5": "5.5.5" } }),
      "bunfig.toml": mockBunfig(mock),
    });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).toBe("");
    expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 97B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 97B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

      Authenticate your account at:
      |<border>|
      | customapp://login |
      |<border>|

       + otp-pkg-5@5.5.5"
    `);
    expect(mock.requests).toEqual([
      request("PUT", "/otp-pkg-5"),
      request("GET", "/done"),
      request("PUT", "/otp-pkg-5", { authType: "legacy", otp }),
    ]);
    expect(exitCode).toBe(0);
  });

  test("done url on a different origin is not polled and login falls back to the OTP prompt", async () => {
    const otp = "424242";
    using foreign = mockRegistry(() => Response.json({ token: otp }));
    using mock = mockRegistry((req, recorded) => {
      if (req.method === "PUT") {
        if (recorded.otp === otp) {
          return new Response("OK", { status: 200 });
        }
        return Response.json(
          { authUrl: "customapp://login", doneUrl: `http://127.0.0.1:${foreign.port}/done` },
          { status: 401, headers: { "www-authenticate": "OTP" } },
        );
      }
      if (recorded.pathname === "/done") {
        return Response.json({ token: otp });
      }
      return new Response("unexpected url", { status: 500 });
    });
    using dir = tempDir("publish-otp-foreign-done", {
      "package.json": JSON.stringify({ name: "otp-pkg-6", version: "6.6.6" }),
      "bunfig.toml": mockBunfig(mock),
    });

    await using proc = spawn({
      cmd: [bunExe(), "publish"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: Buffer.from(otp + "\n"),
      env,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).toBe("");
    // the prompt has no line break, the typed OTP is not echoed, and the publish line starts with its own "\n"
    expect(normalizePublishOutput(out, mock.port).split("\n")).toEqual([
      "bun publish <version> (<revision>)",
      "",
      "packed 47B package.json",
      "",
      "Total files: 1",
      "Shasum: <sha1>",
      "Integrity: <sha512>",
      "Unpacked size: 47B",
      "Packed size: <size>",
      "Tag: latest",
      "Access: default",
      "Registry: http://localhost:<port>/",
      "",
      "This operation requires a one-time password.",
      "Enter OTP: ",
      " + otp-pkg-6@6.6.6",
    ]);
    expect(foreign.requests).toEqual([]);
    expect(mock.requests).toEqual([
      request("PUT", "/otp-pkg-6"),
      request("PUT", "/otp-pkg-6", { authType: "legacy", otp }),
    ]);
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isLinux)(
    "web login opens the auth url with the opener found on PATH, not one in the package directory",
    async () => {
      const otp = "515151";

      using dir = tempDir("publish-web-login-opener", {
        "package.json": JSON.stringify({ name: "otp-pkg-7", version: "7.7.7" }),
      });
      const packageDir = String(dir);
      const openedMarker = join(packageDir, "opened.txt");
      const openerScript = (label: string) =>
        `#!/bin/sh\nprintf '%s %s' '${label}' "$1" > '${join(packageDir, label + ".tmp")}' && mv '${join(packageDir, label + ".tmp")}' '${openedMarker}'\n`;
      mkdirSync(join(packageDir, "opener-bin"));
      writeFileSync(join(packageDir, "xdg-open"), openerScript("package-dir"), { mode: 0o755 });
      writeFileSync(join(packageDir, "opener-bin", "xdg-open"), openerScript("path"), { mode: 0o755 });
      chmodSync(join(packageDir, "xdg-open"), 0o755);
      chmodSync(join(packageDir, "opener-bin", "xdg-open"), 0o755);

      let donePolls = 0;
      using mock = mockRegistry((req, recorded, mock) => {
        if (req.method === "PUT") {
          if (recorded.otp === otp) {
            return new Response("OK", { status: 200 });
          }
          return Response.json(
            { authUrl: `http://localhost:${mock.port}/auth`, doneUrl: `http://localhost:${mock.port}/done` },
            { status: 401, headers: { "www-authenticate": "OTP" } },
          );
        }
        if (recorded.pathname === "/done") {
          donePolls++;
          if (!existsSync(openedMarker) && donePolls < 40) {
            return new Response("{}", { status: 202 });
          }
          return Response.json({ token: otp });
        }
        return new Response("unexpected url", { status: 500 });
      });

      await write(join(packageDir, "bunfig.toml"), mockBunfig(mock));

      await using proc = spawn({
        cmd: [bunExe(), "publish"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: Buffer.from("\n"),
        env: {
          ...env,
          PATH: [join(packageDir, "opener-bin"), env.PATH ?? ""].join(delimiter),
        },
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(err).toBe("");
      // the opener scripts embed the temp dir path, so their packed sizes differ between machines
      expect(packedFiles(out)).toEqual(["package.json", "opener-bin/xdg-open", "xdg-open"]);
      const authUrl = `http://localhost:${mock.port}/auth`;
      const border = `|${Buffer.alloc(authUrl.length + 2, "-")}|`;
      expect(out).toEndWith(
        `\nAuthenticate your account at (press ENTER to open in browser):\n${border}\n| ${authUrl} |\n${border}\n\n + otp-pkg-7@7.7.7\n`,
      );
      expect(readFileSync(openedMarker, "utf8")).toBe(`path http://localhost:${mock.port}/auth`);
      expect(mock.requests.filter(r => r.method === "PUT")).toEqual([
        request("PUT", "/otp-pkg-7"),
        request("PUT", "/otp-pkg-7", { authType: "legacy", otp }),
      ]);
      expect(donePolls).toBeGreaterThan(0);
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  // Situation: user has 2FA enabled account with faceid sign-in.
  // They run `bun publish` with --auth-type=legacy, prompting them
  // to enter their OTP. Because they have faceid sign-in, they don't
  // have a code to enter, so npm sends a message in the npm-notice
  // header with a url for logging in.
  test.each([
    ["", false],
    [" (ignored)", true],
  ])("npm-notice with login url%s", async (_, shouldIgnoreNotice) => {
    const otp = "otp-3";
    using mock = otpRegistry({ otp, npmNotice: true, xLocalCache: shouldIgnoreNotice });
    using dir = tempDir("publish-otp-notice", {
      "package.json": JSON.stringify({ name: "otp-pkg-3", version: "3.3.3", dependencies: { "otp-pkg-3": "3.3.3" } }),
      "bunfig.toml": mockBunfig(mock),
    });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).toBe(shouldIgnoreNotice ? "" : `\nnote: visit http://localhost:${mock.port}/auth to login\n`);
    expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 97B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 97B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

      Authenticate your account at (press ENTER to open in browser):
      |<border>|
      | http://localhost:<port>/auth |
      |<border>|

       + otp-pkg-3@3.3.3"
    `);
    expect(mock.requests).toEqual([
      request("PUT", "/otp-pkg-3"),
      request("GET", "/done"),
      request("PUT", "/otp-pkg-3", { authType: "legacy", otp }),
    ]);
    expect(exitCode).toBe(0);
  });

  test.each([
    { ci: "expo-application-services", envs: { EAS_BUILD: "hi" } },
    { ci: "codemagic", envs: { CM_BUILD_ID: "hi" } },
    { ci: "vercel", envs: { NOW_BUILDER: "hi" } },
  ])("CI user agent name: $ci", async ({ ci, envs }) => {
    const otp = "otp-4";
    using mock = otpRegistry({ otp });
    using dir = tempDir("publish-otp-ci", {
      "package.json": JSON.stringify({ name: "otp-pkg-4", version: "4.4.4", dependencies: { "otp-pkg-4": "4.4.4" } }),
      "bunfig.toml": mockBunfig(mock),
    });

    const { out, err, exitCode } = await publish(
      { ...env, ...envs, BUILDKITE: undefined, GITHUB_ACTIONS: undefined },
      String(dir),
    );
    expect(err).toBe("");
    expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 97B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 97B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

      Authenticate your account at (press ENTER to open in browser):
      |<border>|
      | http://localhost:<port>/auth |
      |<border>|

       + otp-pkg-4@4.4.4"
    `);
    const ciUserAgent = `Bun/${Bun.version} ${process.platform} ${process.arch} workspaces/false ci/${ci}`;
    expect(mock.requests).toEqual([
      request("PUT", "/otp-pkg-4", { userAgent: ciUserAgent }),
      request("GET", "/done", { userAgent: ciUserAgent }),
      request("PUT", "/otp-pkg-4", { authType: "legacy", otp, userAgent: ciUserAgent }),
    ]);
    expect(exitCode).toBe(0);
  });
});

test.concurrent("can publish a package then install it", async () => {
  const pkg = { name: "publish-pkg-1", version: "1.1.1", dependencies: { "publish-pkg-1": "1.1.1" } };
  using dir = await verdaccioPackage(pkg);

  const { out, err, exitCode } = await publish(env, String(dir));
  expect(err).toBe("");
  expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
    "bun publish <version> (<revision>)

    packed 105B package.json

    Total files: 1
    Shasum: <sha1>
    Integrity: <sha512>
    Unpacked size: 105B
    Packed size: <size>
    Tag: latest
    Access: default
    Registry: http://localhost:<port>/

     + publish-pkg-1@1.1.1"
  `);
  expect(exitCode).toBe(0);

  await runBunInstall(env, String(dir));
  expect(await file(join(dir, "node_modules", "publish-pkg-1", "package.json")).json()).toEqual(pkg);
});

test.concurrent.each([
  ["relative", "publish-pkg-2", () => "./publish-pkg-2-2.2.2.tgz"],
  ["absolute", "publish-pkg-2-abs", (dir: string) => join(dir, "publish-pkg-2-abs-2.2.2.tgz")],
])("can publish from a tarball (%s path)", async (_, name, tarballPath) => {
  const pkg = { name, version: "2.2.2", dependencies: { [name]: "2.2.2" } };
  using dir = await verdaccioPackage(pkg);

  await pack(String(dir), env);

  const { out, err, exitCode } = await publish(env, String(dir), tarballPath(String(dir)));
  expect(err).toBe("");
  expect(packedFiles(out)).toEqual(["package.json"]);
  expect(out).toContain(
    `\nTag: latest\nAccess: default\nRegistry: http://localhost:${registry.port}/\n\n + ${name}@2.2.2\n`,
  );
  expect(exitCode).toBe(0);

  await runBunInstall(env, String(dir));
  expect(await file(join(dir, "node_modules", name, "package.json")).json()).toEqual(pkg);
});

test.concurrent("can publish scoped packages", async () => {
  const pkg = { name: "@scoped/pkg-1", version: "1.1.1", dependencies: { "@scoped/pkg-1": "1.1.1" } };
  using dir = await verdaccioPackage(pkg);

  const { out, err, exitCode } = await publish(env, String(dir));
  expect(err).toBe("");
  expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
    "bun publish <version> (<revision>)

    packed 105B package.json

    Total files: 1
    Shasum: <sha1>
    Integrity: <sha512>
    Unpacked size: 105B
    Packed size: <size>
    Tag: latest
    Access: default
    Registry: http://localhost:<port>/

     + @scoped/pkg-1@1.1.1"
  `);
  expect(exitCode).toBe(0);

  await runBunInstall(env, String(dir));
  expect(await file(join(dir, "node_modules", "@scoped", "pkg-1", "package.json")).json()).toEqual(pkg);
});

test.concurrent.each([
  {
    label: `"bin": "bin1.js"`,
    name: "publish-pkg-bin1",
    fields: { bin: "bin1.js" },
    links: {
      "bin1": false,
      "bin2": false,
      "bin3.js": false,
      "bin4.js": false,
      "moredir/bin4.js": false,
      "publish-pkg-bin1": true,
    },
  },
  {
    label: `"bin": { "bin1": "bin1.js", "bin2": "bin2.js" }`,
    name: "publish-pkg-bin2",
    fields: { bin: { bin1: "bin1.js", bin2: "bin2.js" } },
    links: {
      "bin1": true,
      "bin2": true,
      "bin3.js": false,
      "bin4.js": false,
      "moredir/bin4.js": false,
      "publish-pkg-bin2": false,
    },
  },
  {
    label: `"directories": { "bin": "bins" }`,
    name: "publish-pkg-bin3",
    fields: { directories: { bin: "bins" } },
    links: {
      "bin1": false,
      "bin2": false,
      "bin3.js": true,
      "bin4.js": true,
      "moredir/bin4.js": !isWindows,
      "publish-pkg-bin3": false,
    },
  },
])("can publish and install binaries with $label", async ({ name, fields, links }) => {
  const pkg = { name, version: "1.1.1", ...fields };
  using publishDir = await verdaccioPackage(pkg, {
    "bin1.js": `#!/usr/bin/env bun\nconsole.log("bin1!")`,
    "bin2.js": `#!/usr/bin/env bun\nconsole.log("bin2!")`,
    "bins/bin3.js": `#!/usr/bin/env bun\nconsole.log("bin3!")`,
    "bins/moredir/bin4.js": `#!/usr/bin/env bun\nconsole.log("bin4!")`,
  });
  using dir = tempDir("publish-bins-consumer", {
    "package.json": JSON.stringify({ name: "foo", dependencies: { [name]: "1.1.1" } }),
    "bunfig.toml": verdaccioBunfig,
  });

  const { out, err, exitCode } = await publish(env, String(publishDir));
  expect(err).toBe("");
  expect(packedFiles(out)).toEqual(["package.json", "bin1.js", "bin2.js", "bins/bin3.js", "bins/moredir/bin4.js"]);
  expect(out).toContain(`\n + ${name}@1.1.1\n`);
  expect(exitCode).toBe(0);

  await runBunInstall(env, String(dir));

  // Windows gets `.bunx` shims instead of symlinks.
  const linked = (link: string) => exists(join(dir, "node_modules", ".bin", isWindows ? `${link}.bunx` : link));
  expect({
    "bin1": await linked("bin1"),
    "bin2": await linked("bin2"),
    "bin3.js": await linked("bin3.js"),
    "bin4.js": await linked("bin4.js"),
    "moredir/bin4.js": await exists(join(dir, "node_modules", ".bin", isWindows ? "moredir" : "moredir/bin4.js")),
    [name]: await linked(name),
  }).toEqual(links);
});

test.concurrent("dependencies are installed", async () => {
  using publishDir = await verdaccioPackage({
    name: "publish-pkg-deps",
    version: "1.1.1",
    dependencies: { "no-deps": "1.0.0" },
    peerDependencies: { "a-dep": "1.0.1" },
    optionalDependencies: { "basic-1": "1.0.0" },
  });
  using dir = tempDir("publish-deps-consumer", {
    "package.json": JSON.stringify({ name: "foo", dependencies: { "publish-pkg-deps": "1.1.1" } }),
    "bunfig.toml": verdaccioBunfig,
  });

  const { out, err, exitCode } = await publish(env, String(publishDir));
  expect(err).toBe("");
  expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
    "bun publish <version> (<revision>)

    packed 208B package.json

    Total files: 1
    Shasum: <sha1>
    Integrity: <sha512>
    Unpacked size: 208B
    Packed size: <size>
    Tag: latest
    Access: default
    Registry: http://localhost:<port>/

     + publish-pkg-deps@1.1.1"
  `);
  expect(exitCode).toBe(0);

  await runBunInstall(env, String(dir));

  expect(
    await Promise.all([
      file(join(dir, "node_modules", "no-deps", "package.json")).json(),
      file(join(dir, "node_modules", "a-dep", "package.json")).json(),
      file(join(dir, "node_modules", "basic-1", "package.json")).json(),
    ]),
  ).toMatchObject([
    { name: "no-deps", version: "1.0.0" },
    { name: "a-dep", version: "1.0.1" },
    { name: "basic-1", version: "1.0.0" },
  ]);
});

test.concurrent("can publish workspace package", async () => {
  const pkg = { name: "publish-pkg-3", version: "3.3.3", dependencies: { "publish-pkg-3": "3.3.3" } };
  await rm(join(registry.packagesPath, pkg.name), { recursive: true, force: true });
  using dir = tempDir("publish-workspace", {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    "bunfig.toml": verdaccioBunfig,
    "packages/publish-pkg-3/package.json": JSON.stringify(pkg),
  });

  const { out, err, exitCode } = await publish(env, join(dir, "packages", "publish-pkg-3"));
  expect(err).toBe("");
  expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
    "bun publish <version> (<revision>)

    packed 105B package.json

    Total files: 1
    Shasum: <sha1>
    Integrity: <sha512>
    Unpacked size: 105B
    Packed size: <size>
    Tag: latest
    Access: default
    Registry: http://localhost:<port>/

     + publish-pkg-3@3.3.3"
  `);
  expect(exitCode).toBe(0);

  await write(join(dir, "package.json"), JSON.stringify({ name: "root", dependencies: { "publish-pkg-3": "3.3.3" } }));
  await runBunInstall(env, String(dir));
  expect(await file(join(dir, "node_modules", "publish-pkg-3", "package.json")).json()).toEqual(pkg);
});

describe.concurrent("--dry-run", () => {
  test("does not publish", async () => {
    using dir = await verdaccioPackage({ name: "dry-run-1", version: "1.1.1", dependencies: { "dry-run-1": "1.1.1" } });

    const { out, err, exitCode } = await publish(env, String(dir), "--dry-run");
    expect(err).toBe("");
    expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 75B package.json

      Total files: 1
      Unpacked size: 75B
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

       + dry-run-1@1.1.1 (dry-run)"
    `);
    expect(exitCode).toBe(0);

    expect(await exists(join(registry.packagesPath, "dry-run-1"))).toBeFalse();
  });

  test("does not publish from tarball path", async () => {
    using dir = await verdaccioPackage({ name: "dry-run-2", version: "2.2.2", dependencies: { "dry-run-2": "2.2.2" } });

    await pack(String(dir), env);

    const { out, err, exitCode } = await publish(env, String(dir), "./dry-run-2-2.2.2.tgz", "--dry-run");
    expect(err).toBe("");
    expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 97B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 97B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

       + dry-run-2@2.2.2 (dry-run)"
    `);
    expect(exitCode).toBe(0);

    expect(await exists(join(registry.packagesPath, "dry-run-2"))).toBeFalse();
  });

  test("registry summary line does not print userinfo from the registry url", async () => {
    using dir = tempDir("publish-dry-run-userinfo", {
      "package.json": JSON.stringify({ name: "dry-run-3", version: "3.3.3" }),
    });

    const { out, err, exitCode } = await publish(
      { ...env, npm_config_registry: "http://someuser:hunter2@127.0.0.1:1/" },
      String(dir),
      "--dry-run",
    );
    expect(err).toBe("");
    expect(normalizePublishOutput(out)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 38B package.json

      Total files: 1
      Unpacked size: 38B
      Tag: latest
      Access: default
      Registry: http://127.0.0.1:1/

       + dry-run-3@3.3.3 (dry-run)"
    `);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("credentials in the registry url", () => {
  const basicAuth = `Basic ${Buffer.from("pubuser:hunter2").toString("base64")}`;

  test("--registry with user:pass@ publishes with Basic auth", async () => {
    using mock = mockRegistry();
    const pkg = { name: "userinfo-flag-pkg", version: "1.0.0" };
    using dir = tempDir("publish-userinfo-flag", { "package.json": JSON.stringify(pkg) });

    const { out, err, exitCode } = await publish(
      env,
      String(dir),
      "--registry",
      `http://pubuser:hunter2@localhost:${mock.port}/`,
    );
    expect(err).toBe("");
    expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 55B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 55B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

       + userinfo-flag-pkg@1.0.0"
    `);
    expect(mock.requests).toEqual([request("PUT", "/userinfo-flag-pkg", { authorization: basicAuth })]);
    const tarball = await expectPublishedManifest(mock.requests[0].manifest, pkg, mock.port);
    expect(tarball.files).toEqual(["package/package.json"]);
    expect(out).toContain(printedChecksums(tarball));
    expect(exitCode).toBe(0);
  });

  test("--registry with :token@ publishes with a Bearer token", async () => {
    using mock = mockRegistry();
    using dir = tempDir("publish-userinfo-token", {
      "package.json": JSON.stringify({ name: "userinfo-token-pkg", version: "1.0.0" }),
    });

    const { out, err, exitCode } = await publish(
      env,
      String(dir),
      "--registry",
      `http://:publish-token@localhost:${mock.port}/`,
    );
    expect(err).toBe("");
    expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 56B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 56B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

       + userinfo-token-pkg@1.0.0"
    `);
    expect(mock.requests).toEqual([request("PUT", "/userinfo-token-pkg", { authorization: "Bearer publish-token" })]);
    expect(exitCode).toBe(0);
  });

  test.each(["npm_config_registry", "NPM_CONFIG_REGISTRY", "BUN_CONFIG_REGISTRY"])(
    "%s with user:pass@ publishes with Basic auth",
    async key => {
      using mock = mockRegistry();
      using dir = tempDir("publish-userinfo-env", {
        "package.json": JSON.stringify({ name: "userinfo-env-pkg", version: "1.0.0" }),
      });

      const { out, err, exitCode } = await publish(
        { ...env, [key]: `http://pubuser:hunter2@localhost:${mock.port}/` },
        String(dir),
      );
      expect(err).toBe("");
      expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
        "bun publish <version> (<revision>)

        packed 54B package.json

        Total files: 1
        Shasum: <sha1>
        Integrity: <sha512>
        Unpacked size: 54B
        Packed size: <size>
        Tag: latest
        Access: default
        Registry: http://localhost:<port>/

         + userinfo-env-pkg@1.0.0"
      `);
      expect(mock.requests).toEqual([request("PUT", "/userinfo-env-pkg", { authorization: basicAuth })]);
      expect(exitCode).toBe(0);
    },
  );

  test("no credentials at all fails before sending a request", async () => {
    using mock = mockRegistry();
    using dir = tempDir("publish-no-credentials", {
      "package.json": JSON.stringify({ name: "no-credentials-pkg", version: "1.0.0" }),
    });

    const { out, err, exitCode } = await publish(env, String(dir), "--registry", `http://localhost:${mock.port}/`);
    expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 56B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 56B
      Packed size: <size>"
    `);
    expect(err).toBe("error: missing authentication (run `bunx npm login`)\n");
    expect(mock.requests).toEqual([]);
    expect(exitCode).toBe(1);
  });

  test("no credentials at all fails before sending a request (tarball path)", async () => {
    using mock = mockRegistry();
    using dir = tempDir("publish-no-credentials-tarball", {
      "package.json": JSON.stringify({ name: "no-credentials-tarball-pkg", version: "1.0.0" }),
    });
    await pack(String(dir), env);

    const { out, err, exitCode } = await publish(
      env,
      String(dir),
      "./no-credentials-tarball-pkg-1.0.0.tgz",
      "--registry",
      `http://localhost:${mock.port}/`,
    );
    expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 64B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 64B
      Packed size: <size>"
    `);
    expect(err).toBe("error: missing authentication (run `bunx npm login`)\n");
    expect(mock.requests).toEqual([]);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("lifecycle scripts", () => {
  // Each script appends its name, so `order.txt` records the order the scripts ran in.
  const scripts = Object.fromEntries(
    ["prepublishOnly", "prepack", "prepare", "postpack", "publish", "postpublish"].map(name => [
      name,
      `echo ${name} >> order.txt`,
    ]),
  );

  test.each([
    ["", "publish-pkg-4", []],
    [" (--dry-run)", "publish-pkg-4-dry", ["--dry-run"]],
  ])("should run in order%s", async (_, name, args) => {
    using dir = await verdaccioPackage({ name, version: "4.4.4", scripts, dependencies: { [name]: "4.4.4" } });

    const { out, err, exitCode } = await publish(env, String(dir), ...args);
    expect(err).toBe(
      [
        "$ echo prepublishOnly >> order.txt",
        "$ echo prepack >> order.txt",
        "$ echo prepare >> order.txt",
        "$ echo postpack >> order.txt",
        "$ echo publish >> order.txt",
        "$ echo postpublish >> order.txt",
        "",
      ].join("\n"),
    );
    expect(out).toContain(`\n + ${name}@4.4.4${args.length ? " (dry-run)" : ""}\n`);
    expect(exitCode).toBe(0);

    expect(await file(join(dir, "order.txt")).text()).toBe(
      "prepublishOnly\nprepack\nprepare\npostpack\npublish\npostpublish\n",
    );
  });

  test("--ignore-scripts", async () => {
    using dir = await verdaccioPackage({
      name: "publish-pkg-5",
      version: "4.4.4",
      scripts,
      dependencies: { "publish-pkg-5": "4.4.4" },
    });

    const { out, err, exitCode } = await publish(env, String(dir), "--ignore-scripts");
    expect(err).toBe("");
    expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 412B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 412B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

       + publish-pkg-5@4.4.4"
    `);
    expect(exitCode).toBe(0);

    expect(await exists(join(dir, "order.txt"))).toBeFalse();
  });
});

test.concurrent("prepublishOnly modifying version publishes correct version (#17195)", async () => {
  using dir = await verdaccioPackage(
    {
      name: "publish-version-update",
      version: "1.0.0",
      scripts: { prepublishOnly: `${bunExe()} update-version.js` },
      dependencies: { "publish-version-update": "9.9.9" },
    },
    {
      "update-version.js": `const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    pkg.version = "9.9.9";
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2));`,
    },
  );

  const { out, err, exitCode } = await publish(env, String(dir));
  expect(err).toBe(`$ ${bunExe()} update-version.js\n`);
  // the package.json size depends on the path in the prepublishOnly script, so no snapshot here
  expect(packedFiles(out)).toEqual(["package.json", "update-version.js"]);
  expect(out).toContain(`\n + publish-version-update@9.9.9\n`);
  expect(exitCode).toBe(0);

  // Should be able to install the package at the UPDATED version (9.9.9), not the original (1.0.0)
  await runBunInstall(env, String(dir));
  const installedPkg = await file(join(dir, "node_modules", "publish-version-update", "package.json")).json();
  expect(installedPkg.version).toBe("9.9.9");
});

test.concurrent("attempting to publish a private package should fail", async () => {
  using dir = await verdaccioPackage({
    name: "publish-pkg-6",
    version: "6.6.6",
    private: true,
    dependencies: { "publish-pkg-6": "6.6.6" },
  });

  // should fail
  let { out, err, exitCode } = await publish(env, String(dir));
  expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`"bun publish <version> (<revision>)"`);
  expect(err).toBe("error: attempted to publish a private package\n");
  expect(exitCode).toBe(1);
  expect(await exists(join(registry.packagesPath, "publish-pkg-6"))).toBeFalse();

  // try tarball
  await pack(String(dir), env);
  ({ out, err, exitCode } = await publish(env, String(dir), "./publish-pkg-6-6.6.6.tgz"));
  expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
    "bun publish <version> (<revision>)

    packed 124B package.json"
  `);
  expect(err).toBe("error: attempted to publish a private package\n");
  expect(exitCode).toBe(1);
  expect(await exists(join(registry.packagesPath, "publish-pkg-6"))).toBeFalse();
  expect(await exists(join(dir, "publish-pkg-6-6.6.6.tgz"))).toBeTrue();
});

describe.concurrent("access", () => {
  test("--access", async () => {
    using dir = await verdaccioPackage({ name: "publish-pkg-7", version: "7.7.7" });

    // should fail
    let { out, err, exitCode } = await publish(env, String(dir), "--access", "restricted");
    expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`"bun publish <version> (<revision>)"`);
    expect(err).toBe("error: unable to restrict access to unscoped package\n");
    expect(exitCode).toBe(1);
    expect(await exists(join(registry.packagesPath, "publish-pkg-7"))).toBeFalse();

    ({ out, err, exitCode } = await publish(env, String(dir), "--access", "public"));
    expect(err).toBe("");
    expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 51B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 51B
      Packed size: <size>
      Tag: latest
      Access: public
      Registry: http://localhost:<port>/

       + publish-pkg-7@7.7.7"
    `);
    expect(exitCode).toBe(0);

    expect(await exists(join(registry.packagesPath, "publish-pkg-7"))).toBeTrue();
  });

  test.each(["restricted", "public"])("access %s", async access => {
    const name = `@secret/publish-pkg-8-${access}`;
    const pkg = { name, version: "8.8.8", dependencies: { [name]: "8.8.8" }, publishConfig: { access } };
    using dir = await verdaccioPackage(pkg);

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).toBe("");
    expect(out).toContain(
      `\nTag: latest\nAccess: ${access}\nRegistry: http://localhost:${registry.port}/\n\n + ${name}@8.8.8\n`,
    );
    expect(exitCode).toBe(0);

    await runBunInstall(env, String(dir));
    expect(await file(join(dir, "node_modules", name, "package.json")).json()).toEqual(pkg);
  });
});

describe.concurrent("tag", () => {
  test("can publish with a tag", async () => {
    const pkg = { name: "publish-pkg-9", version: "9.9.9", dependencies: { "publish-pkg-9": "simpletag" } };
    using dir = await verdaccioPackage(pkg);

    const { out, err, exitCode } = await publish(env, String(dir), "--tag", "simpletag");
    expect(err).toBe("");
    expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 109B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 109B
      Packed size: <size>
      Tag: simpletag
      Access: default
      Registry: http://localhost:<port>/

       + publish-pkg-9@9.9.9"
    `);
    expect(exitCode).toBe(0);

    await runBunInstall(env, String(dir));
    expect(await file(join(dir, "node_modules", "publish-pkg-9", "package.json")).json()).toEqual(pkg);
  });
});

test.concurrent("$npm_command is accurate during publish", async () => {
  using dir = await verdaccioPackage({
    name: "publish-pkg-10",
    version: "1.0.0",
    scripts: { publish: "echo $npm_command" },
  });

  const { out, err, exitCode } = await publish(env, String(dir), "--tag", "simpletag");
  expect(err).toBe(`$ echo $npm_command\n`);
  expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
    "bun publish <version> (<revision>)

    packed 107B package.json

    Total files: 1
    Shasum: <sha1>
    Integrity: <sha512>
    Unpacked size: 107B
    Packed size: <size>
    Tag: simpletag
    Access: default
    Registry: http://localhost:<port>/

     + publish-pkg-10@1.0.0
    publish"
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("$npm_lifecycle_event is accurate during publish", async () => {
  await rm(join(registry.packagesPath, "publish-pkg-11"), { recursive: true, force: true });
  using dir = tempDir("publish-lifecycle-event", {
    "package.json": `{
      "name": "publish-pkg-11",
      "version": "1.0.0",
      "scripts": {
        "prepublish": "echo 1 $npm_lifecycle_event",
        "publish": "echo 2 $npm_lifecycle_event",
        "postpublish": "echo 3 $npm_lifecycle_event",
      },
    }
    `,
    "bunfig.toml": verdaccioBunfig,
  });

  const { out, err, exitCode } = await publish(env, String(dir), "--tag", "simpletag");
  expect(err).toBe(`$ echo 2 $npm_lifecycle_event\n$ echo 3 $npm_lifecycle_event\n`);
  expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
    "bun publish <version> (<revision>)

    packed 256B package.json

    Total files: 1
    Shasum: <sha1>
    Integrity: <sha512>
    Unpacked size: 256B
    Packed size: <size>
    Tag: simpletag
    Access: default
    Registry: http://localhost:<port>/

     + publish-pkg-11@1.0.0
    2 publish
    3 postpublish"
  `);
  expect(exitCode).toBe(0);
});

describe.concurrent("readme", () => {
  // Regression for https://github.com/oven-sh/bun/issues/30255 — `bun publish`
  // packed the README into the tarball but never populated the version-level
  // `readme` / `readmeFilename` fields, so the registry stored an empty readme.

  test("workspace publish sends README contents as readme / readmeFilename", async () => {
    using mock = mockRegistry();
    const pkg = { name: "readme-pkg-1", version: "1.0.0" };
    const readmeContents = "# readme-pkg-1\n\nA readme.";
    using dir = tempDir("publish-readme", {
      "package.json": JSON.stringify(pkg),
      "README.md": readmeContents,
      "bunfig.toml": mockBunfig(mock),
    });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).toBe("");
    expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 50B package.json
      packed 25B README.md

      Total files: 2
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 75B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

       + readme-pkg-1@1.0.0"
    `);
    expect(mock.requests).toEqual([request("PUT", "/readme-pkg-1")]);
    const tarball = await expectPublishedManifest(mock.requests[0].manifest, pkg, mock.port, {
      versionFields: { readme: readmeContents, readmeFilename: "README.md" },
    });
    expect(tarball.files).toEqual(["package/README.md", "package/package.json"]);
    expect(exitCode).toBe(0);
  });

  test("tarball publish sends README contents from inside the archive", async () => {
    using mock = mockRegistry();
    const pkg = { name: "readme-pkg-2", version: "2.0.0" };
    const readmeContents = "# readme-pkg-2\n\nFrom inside the tarball.";
    using dir = tempDir("publish-readme-tarball", {
      "package.json": JSON.stringify(pkg),
      "README.md": readmeContents,
    });

    await pack(String(dir), env);
    await write(join(dir, "bunfig.toml"), mockBunfig(mock));

    const { out, err, exitCode } = await publish(env, String(dir), "./readme-pkg-2-2.0.0.tgz");
    expect(err).toBe("");
    expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 50B package.json
      packed 40B README.md

      Total files: 2
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 90B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

       + readme-pkg-2@2.0.0"
    `);
    expect(mock.requests).toEqual([request("PUT", "/readme-pkg-2")]);
    const tarball = await expectPublishedManifest(mock.requests[0].manifest, pkg, mock.port, {
      versionFields: { readme: readmeContents, readmeFilename: "README.md" },
    });
    expect(tarball.files).toEqual(["package/README.md", "package/package.json"]);
    expect(exitCode).toBe(0);
  });
});

test.concurrent("dist.tarball in the published manifest does not include userinfo from the registry url", async () => {
  using mock = mockRegistry();
  const pkg = { name: "tarball-url-pkg", version: "1.0.0" };
  using dir = tempDir("publish-tarball-url", { "package.json": JSON.stringify(pkg) });

  const { out, err, exitCode } = await publish(
    env,
    String(dir),
    "--registry",
    `http://pubuser:hunter2@localhost:${mock.port}/`,
  );
  expect(err).toBe("");
  expect(normalizePublishOutput(out, mock.port)).toMatchInlineSnapshot(`
    "bun publish <version> (<revision>)

    packed 53B package.json

    Total files: 1
    Shasum: <sha1>
    Integrity: <sha512>
    Unpacked size: 53B
    Packed size: <size>
    Tag: latest
    Access: default
    Registry: http://localhost:<port>/

     + tarball-url-pkg@1.0.0"
  `);
  expect(mock.requests).toEqual([
    request("PUT", "/tarball-url-pkg", {
      authorization: `Basic ${Buffer.from("pubuser:hunter2").toString("base64")}`,
    }),
  ]);
  // `expectPublishedManifest` checks `dist.tarball` against the registry url without the userinfo
  await expectPublishedManifest(mock.requests[0].manifest, pkg, mock.port);
  expect(JSON.stringify(mock.requests[0].manifest)).not.toContain("hunter2");
  expect(exitCode).toBe(0);
});

describe.concurrent("--tolerate-republish", () => {
  test("republishing normally fails", async () => {
    using dir = await verdaccioPackage({ name: "republish-test-1", version: "1.0.0" });

    // First publish should succeed
    let { out, err, exitCode } = await publish(env, String(dir));
    expect(err).toBe("");
    expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 54B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 54B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/

       + republish-test-1@1.0.0"
    `);
    expect(exitCode).toBe(0);

    // Second publish should fail
    ({ out, err, exitCode } = await publish(env, String(dir)));
    expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 54B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 54B
      Packed size: <size>
      Tag: latest
      Access: default
      Registry: http://localhost:<port>/"
    `);
    expect(err).toBe(
      `\n409 Conflict: http://localhost:${registry.port}/republish-test-1\n\n - this package is already present\n`,
    );
    expect(exitCode).toBe(1);
  });

  test("republishing with --tolerate-republish skips when version exists", async () => {
    using dir = await verdaccioPackage({ name: "republish-test-2", version: "1.0.0" });

    // First publish should succeed
    let { out, err, exitCode } = await publish(env, String(dir));
    expect(err).toBe("");
    expect(out).toContain(" + republish-test-2@1.0.0\n");
    expect(exitCode).toBe(0);

    // Second publish with --tolerate-republish should skip
    ({ out, err, exitCode } = await publish(env, String(dir), "--tolerate-republish"));
    expect(err).toBe("warn: Registry already knows about version 1.0.0; skipping.\n");
    expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 54B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 54B
      Packed size: <size>

       + republish-test-2@1.0.0"
    `);
    expect(exitCode).toBe(0);
  });

  test("republishing tarball with --tolerate-republish skips when version exists", async () => {
    using dir = await verdaccioPackage({ name: "republish-test-3", version: "1.0.0" });

    // Create tarball
    await pack(String(dir), env);

    // First publish should succeed
    let { out, err, exitCode } = await publish(env, String(dir), "./republish-test-3-1.0.0.tgz");
    expect(err).toBe("");
    expect(out).toContain(" + republish-test-3@1.0.0\n");
    expect(exitCode).toBe(0);

    // Second publish with --tolerate-republish should skip
    ({ out, err, exitCode } = await publish(env, String(dir), "./republish-test-3-1.0.0.tgz", "--tolerate-republish"));
    expect(err).toBe("warn: Registry already knows about version 1.0.0; skipping.\n");
    expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
      "bun publish <version> (<revision>)

      packed 54B package.json

      Total files: 1
      Shasum: <sha1>
      Integrity: <sha512>
      Unpacked size: 54B
      Packed size: <size>

       + republish-test-3@1.0.0"
    `);
    expect(exitCode).toBe(0);
  });
});
