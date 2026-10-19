import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { exists, rm, symlink } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  isLinux,
  isWindows,
  normalizeBunSnapshot,
  pack,
  runBunInstall,
  substDrive,
  tempDir,
  tls,
  unprivilegedSpawnOptions,
  writeBinCommand,
} from "harness";
import { delimiter, join } from "path";
import { TestRegistry } from "registry";

const registry = new TestRegistry();

/** The bunfig of the tests that publish to `registry`: its url and one shared token. */
let registryBunfig: string;

beforeAll(async () => {
  await registry.start();
  registryBunfig = await registry.authBunfig("publish-tests");
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
 * A directory with `package.json` and the auth bunfig for `registry`. A checkout that ran these tests against
 * verdaccio may still have the package in the fixture directory, so the registry is told to forget it first.
 */
async function registryPackage(pkg: { name: string; version: string } & Record<string, unknown>, files = {}) {
  registry.packages.delete(pkg.name);
  return tempDir(`publish-${pkg.name.replace(/[@/]/g, "")}`, {
    "package.json": JSON.stringify(pkg),
    "bunfig.toml": registryBunfig,
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
  /** Serve over https with the harness certificate, which the test passes as `--ca`. */
  secure = false,
): MockRegistry {
  const requests: RegistryRequest[] = [];
  const server = Bun.serve({
    port: 0,
    ...(secure ? { tls } : {}),
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

/** name, the characters, how they are printed */
const unprintable = [
  ["ESC [ 2 K", "\x1b[2K", "\\x1b[2K"],
  ["CR", "\r", "\\r"],
  ["BEL", "\x07", "\\x07"],
  ["U+009B", "\u009b2K", "\\u009b2K"],
  ["OSC 52", "\x1b]52;c;aGk=\x07", "\\x1b]52;c;aGk=\\x07"],
] as const;

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

  // `--otp` is written into `npm-otp: <value>` as it is. A CR or LF in it would end that header line, and whatever
  // follows would be sent as more header lines.
  test.each([
    ["CRLF", "abc\r\nX-Injected: 1"],
    ["a bare LF", "abc\ndef"],
    ["a bare CR", "abc\rdef"],
  ])("--otp containing %s is rejected", async (_, otp) => {
    using mock = mockRegistry();
    using dir = tempDir("publish-otp-crlf", {
      "package.json": JSON.stringify({ name: "otp-pkg-crlf", version: "1.0.0" }),
      "bunfig.toml": mockBunfig(mock),
    });

    const { err, exitCode } = await publish(env, String(dir), "--otp", otp);
    expect(err).toBe("error: invalid `otp` value: must not contain a newline or NUL byte\n");
    expect(mock.requests).toEqual([]);
    expect(exitCode).toBe(1);
  });

  /** Asks for the web login on the first PUT, and hands out `token` at the done url. */
  function webLoginRegistry(authUrlSuffix: string, token: string) {
    return mockRegistry((req, recorded, mock) => {
      if (req.method === "PUT") {
        if (recorded.otp !== null) {
          return new Response("OK", { status: 200 });
        }
        return Response.json(
          {
            authUrl: `http://localhost:${mock.port}/auth${authUrlSuffix}`,
            doneUrl: `http://localhost:${mock.port}/done`,
          },
          { status: 401, headers: { "www-authenticate": "OTP" } },
        );
      }
      return Response.json({ token });
    });
  }

  test.each([
    ["CRLF", "abc\r\nX-Injected: 1"],
    ["a bare LF", "abc\ndef"],
    ["a bare CR", "abc\rdef"],
  ])("a web login token containing %s is rejected", async (_, token) => {
    using mock = webLoginRegistry("", token);
    using dir = tempDir("publish-token-crlf", {
      "package.json": JSON.stringify({ name: "otp-pkg-token", version: "1.0.0" }),
      "bunfig.toml": mockBunfig(mock),
    });

    const { err, exitCode } = await publish(env, String(dir));
    expect(err).toBe("WebLogin: invalid `token` field in response json\n");
    expect(mock.requests).toEqual([request("PUT", "/otp-pkg-token"), request("GET", "/done")]);
    expect(exitCode).toBe(1);
  });

  test.each(unprintable)(
    "an auth url with %s is shown spelled out, without the offer to open it",
    async (_, raw, spelled) => {
      using mock = webLoginRegistry(`${raw}| http://example.com/login`, "123456");
      using dir = tempDir("publish-auth-url", {
        "package.json": JSON.stringify({ name: "otp-pkg-url", version: "1.0.0" }),
        "bunfig.toml": mockBunfig(mock),
      });

      const { out, err, exitCode } = await publish(env, String(dir));
      expect(err).toBe("");
      const shown = `http://localhost:${mock.port}/auth${spelled}| http://example.com/login`;
      const border = `|${Buffer.alloc(shown.length + 2, "-")}|`;
      expect(out).toEndWith(
        `\nAuthenticate your account at:\n${border}\n| ${shown} |\n${border}\n\n + otp-pkg-url@1.0.0\n`,
      );
      expect(exitCode).toBe(0);
    },
  );
});

// npm prints the header of every response that has no `x-local-cache`.
describe.concurrent("the registry's npm-notice is printed", () => {
  const notice = "Classic tokens stop working next month.";
  const printed = `\nnote: ${notice}\n`;

  async function publishTo(respond: (req: Request) => Response, ...args: string[]) {
    using mock = mockRegistry(respond);
    using dir = tempDir("publish-notice", {
      "package.json": JSON.stringify({ name: "notice-pkg", version: "1.0.0" }),
      "bunfig.toml": mockBunfig(mock),
    });
    return await publish(env, String(dir), ...args);
  }
  const answer = (status: number, headers = {}) => new Response("{}", { status, headers });

  test.each([
    [200, []],
    [201, []],
    [201, ["--otp", "123456"]],
  ] as [number, string[]][])("with a %d (args: %j)", async (status, args) => {
    const { err, exitCode } = await publishTo(() => answer(status, { "npm-notice": notice }), ...args);
    expect(err).toBe(printed);
    expect(exitCode).toBe(0);
  });

  test.each([403, 409, 500])("before the error of a %d", async status => {
    const { err, exitCode } = await publishTo(() => answer(status, { "npm-notice": notice }));
    expect(err).toStartWith(`${printed}\n${status} `);
    expect(exitCode).toBe(1);
  });

  test("with the response to the --tolerate-republish lookup", async () => {
    const { err, exitCode } = await publishTo(
      req => answer(200, req.method === "GET" ? { "npm-notice": notice } : {}),
      "--tolerate-republish",
    );
    expect(err).toBe(printed);
    expect(exitCode).toBe(0);
  });

  test("unless the response came from a cache", async () => {
    const { err, exitCode } = await publishTo(() => answer(201, { "npm-notice": notice, "x-local-cache": "1" }));
    expect(err).toBe("");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("can publish with only _auth from .npmrc", () => {
  // npm forwards whatever `_auth` holds as `Basic <value>`, decodable or not.
  test.each([
    ["decodable base64", Buffer.from("alice:s3cret").toString("base64")],
    ["opaque non-base64", "!!not-base64!!"],
  ])("%s reaches the registry verbatim", async (_, blob) => {
    using mock = mockRegistry();
    using dir = tempDir("publish-npmrc-auth", {
      "package.json": JSON.stringify({ name: "npmrc-auth-pkg", version: "1.0.0" }),
      ".npmrc": `registry=http://localhost:${mock.port}/\n//localhost:${mock.port}/:_auth=${blob}\n`,
      // An empty home so the developer's own `.npmrc` / global bunfig cannot leak in.
      "home/.gitkeep": "",
    });
    const home = join(String(dir), "home");

    const { out, err, exitCode } = await publish(
      { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, NPM_CONFIG_USERCONFIG: undefined },
      String(dir),
    );
    expect(err).not.toContain("error:");
    expect(out).toContain("+ npmrc-auth-pkg@1.0.0");
    expect(mock.requests).toEqual([request("PUT", "/npmrc-auth-pkg", { authorization: `Basic ${blob}` })]);
    expect(exitCode).toBe(0);
  });
});

test.concurrent("can publish a package then install it", async () => {
  const pkg = { name: "publish-pkg-1", version: "1.1.1", dependencies: { "publish-pkg-1": "1.1.1" } };
  using dir = await registryPackage(pkg);

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

test.concurrent("the publish request has the Content-Type that verdaccio accepts", async () => {
  // verdaccio compares the header with `application/json`, character for character, and responds with 415 to
  // `application/json; charset=utf-8`. The registry in these tests does the same, so every publish in this file fails
  // if Bun changes the header. This test shows which header it is.
  using recording = new TestRegistry({ recordRequests: true }).start();
  const { packageDir, packageJson } = await recording.createTestDir();
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "publish-content-type", version: "1.0.0" })),
    write(join(packageDir, "bunfig.toml"), await recording.authBunfig("content-type")),
  ]);
  recording.requests.length = 0;

  const { err, exitCode } = await publish(env, packageDir);
  expect(err).not.toContain("error:");
  expect(
    recording.requests.map(({ method, path, status, headers }) => ({
      method,
      path,
      status,
      "content-type": headers["content-type"],
    })),
  ).toEqual([{ method: "PUT", path: "/publish-content-type", status: 200, "content-type": "application/json" }]);
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  ["relative", "publish-pkg-2", () => "./publish-pkg-2-2.2.2.tgz"],
  ["absolute", "publish-pkg-2-abs", (dir: string) => join(dir, "publish-pkg-2-abs-2.2.2.tgz")],
])("can publish from a tarball (%s path)", async (_, name, tarballPath) => {
  const pkg = { name, version: "2.2.2", dependencies: { [name]: "2.2.2" } };
  using dir = await registryPackage(pkg);

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

describe("relative tarball path", () => {
  // `bun publish` chdirs to the package root (or the workspace root) before it reads the tarball.
  // The path on the command line still has to be resolved against the directory the command ran from.
  // --dry-run never talks to the registry, so a bogus one with auth in the url is enough.
  const dryRunEnv = { ...env, npm_config_registry: "http://someuser:hunter2@127.0.0.1:1/" };

  test.concurrent("is resolved against the cwd, not the package root above it", async () => {
    using dir = tempDir("publish-tarball-cwd", {
      "package.json": JSON.stringify({ name: "publish-tarball-cwd-root", version: "0.0.0" }),
      "stale-src/package.json": JSON.stringify({ name: "publish-tarball-cwd-stale", version: "0.0.1" }),
      "dist-src/package.json": JSON.stringify({ name: "publish-tarball-cwd-dist", version: "9.9.9" }),
      "dist": {},
    });
    // a same-named tarball in the package root, and the one we actually mean in ./dist
    await pack(join(String(dir), "stale-src"), env, "--filename", join(String(dir), "rel.tgz"));
    await pack(join(String(dir), "dist-src"), env, "--filename", join(String(dir), "dist", "rel.tgz"));

    const { out, err, exitCode } = await publish(dryRunEnv, join(String(dir), "dist"), "./rel.tgz", "--dry-run");
    expect(err).not.toContain("error:");
    expect(out).toContain(" + publish-tarball-cwd-dist@9.9.9");
    expect(out).not.toContain("publish-tarball-cwd-stale");
    expect(exitCode).toBe(0);
  });

  test.concurrent("is found when the cwd is a subdirectory of the package root", async () => {
    using dir = tempDir("publish-tarball-subdir", {
      "package.json": JSON.stringify({ name: "publish-tarball-subdir-root", version: "0.0.0" }),
      "dist-src/package.json": JSON.stringify({ name: "publish-tarball-subdir-dist", version: "1.0.0" }),
      "dist": {},
    });
    await pack(join(String(dir), "dist-src"), env, "--filename", join(String(dir), "dist", "pkg.tgz"));

    const { out, err, exitCode } = await publish(dryRunEnv, join(String(dir), "dist"), "pkg.tgz", "--dry-run");
    expect(err).not.toContain("ENOENT");
    expect(out).toContain(" + publish-tarball-subdir-dist@1.0.0");
    expect(exitCode).toBe(0);
  });

  test.concurrent("is found when the cwd is a workspace package", async () => {
    using dir = tempDir("publish-tarball-workspace", {
      "package.json": JSON.stringify({
        name: "publish-tarball-workspace-root",
        version: "0.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/member/package.json": JSON.stringify({ name: "publish-tarball-workspace-member", version: "1.2.3" }),
    });
    const memberDir = join(String(dir), "packages", "member");
    await pack(memberDir, env);
    expect(await exists(join(memberDir, "publish-tarball-workspace-member-1.2.3.tgz"))).toBeTrue();

    const { out, err, exitCode } = await publish(
      dryRunEnv,
      memberDir,
      "./publish-tarball-workspace-member-1.2.3.tgz",
      "--dry-run",
    );
    expect(err).not.toContain("ENOENT");
    expect(out).toContain(" + publish-tarball-workspace-member@1.2.3");
    expect(exitCode).toBe(0);
  });

  test.concurrent(
    "refers to the file that `bun pm pack --filename` wrote for the same path from the same cwd",
    async () => {
      using dir = tempDir("publish-tarball-round-trip", {
        "package.json": JSON.stringify({
          name: "publish-tarball-round-trip-root",
          version: "0.0.0",
          workspaces: ["packages/*"],
        }),
        "packages/member/package.json": JSON.stringify({ name: "publish-tarball-round-trip-member", version: "1.2.3" }),
      });
      const memberDir = join(String(dir), "packages", "member");
      await pack(memberDir, env, "--filename", "./x.tgz");
      expect(await exists(join(memberDir, "x.tgz"))).toBeTrue();
      expect(await exists(join(String(dir), "x.tgz"))).toBeFalse();

      const { out, err, exitCode } = await publish(dryRunEnv, memberDir, "./x.tgz", "--dry-run");
      expect(err).not.toContain("error:");
      expect(out).toContain(" + publish-tarball-round-trip-member@1.2.3");
      expect(exitCode).toBe(0);
    },
  );
});

test.concurrent("can publish scoped packages", async () => {
  const pkg = { name: "@scoped/pkg-1", version: "1.1.1", dependencies: { "@scoped/pkg-1": "1.1.1" } };
  using dir = await registryPackage(pkg);

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
  using publishDir = await registryPackage(pkg, {
    "bin1.js": `#!/usr/bin/env bun\nconsole.log("bin1!")`,
    "bin2.js": `#!/usr/bin/env bun\nconsole.log("bin2!")`,
    "bins/bin3.js": `#!/usr/bin/env bun\nconsole.log("bin3!")`,
    "bins/moredir/bin4.js": `#!/usr/bin/env bun\nconsole.log("bin4!")`,
  });
  using dir = tempDir("publish-bins-consumer", {
    "package.json": JSON.stringify({ name: "foo", dependencies: { [name]: "1.1.1" } }),
    "bunfig.toml": registryBunfig,
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

describe.concurrent("bin longer than the path buffer", () => {
  // Longer than the path buffer on every platform (98302 bytes on Windows), so
  // nothing on disk can have this name.
  const long = Buffer.alloc(100_000, "b").toString();
  // The registry is never contacted with --dry-run; the userinfo only satisfies the auth check.
  const dryRunEnv = { ...env, npm_config_registry: "http://user:pass@127.0.0.1:1/" };

  test.each([
    ["bin", { bin: long }, "warn: bin '<long>' does not exist"],
    ["bin object value", { bin: { cli: long } }, "warn: bin '<long>' does not exist"],
    ["bin object key", { bin: { [long]: "cli.js" } }, null],
    ["directories.bin", { directories: { bin: long } }, "warn: bin directory '<long>' does not exist"],
  ])("tarball with a long %s", async (_, fields, warning) => {
    using tmp = tempDir("publish-long-bin", {});
    const packageDir = String(tmp);
    const packageJson = JSON.stringify({ name: "publish-long-bin", version: "1.0.0", ...fields });
    await Promise.all([
      write(join(packageDir, "package.json"), packageJson),
      Bun.Archive.write(
        join(packageDir, "publish-long-bin-1.0.0.tgz"),
        { "package/package.json": packageJson, "package/cli.js": "" },
        { compress: "gzip" },
      ),
    ]);

    const { out, err, exitCode } = await publish(dryRunEnv, packageDir, "./publish-long-bin-1.0.0.tgz", "--dry-run");
    const stderr = err.replaceAll(long, "<long>");
    expect(stderr.split("\n").filter(line => line.startsWith("warn:"))).toEqual(warning === null ? [] : [warning]);
    expect(stderr).not.toContain("error:");
    expect(out).toContain("+ publish-long-bin@1.0.0 (dry-run)");
    expect(exitCode).toBe(0);
  });

  test("directory with a long bin", async () => {
    using tmp = tempDir("publish-long-bin", {});
    const packageDir = String(tmp);
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "publish-long-bin", version: "1.0.0", bin: long }),
    );

    const { out, err, exitCode } = await publish(dryRunEnv, packageDir, "--dry-run");
    expect(err).not.toContain("error:");
    expect(out).toContain("+ publish-long-bin@1.0.0 (dry-run)");
    expect(exitCode).toBe(0);
  });
});

test.concurrent("dependencies are installed", async () => {
  using publishDir = await registryPackage({
    name: "publish-pkg-deps",
    version: "1.1.1",
    dependencies: { "no-deps": "1.0.0" },
    peerDependencies: { "a-dep": "1.0.1" },
    optionalDependencies: { "basic-1": "1.0.0" },
  });
  using dir = tempDir("publish-deps-consumer", {
    "package.json": JSON.stringify({ name: "foo", dependencies: { "publish-pkg-deps": "1.1.1" } }),
    "bunfig.toml": registryBunfig,
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
  registry.packages.delete(pkg.name);
  using dir = tempDir("publish-workspace", {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    "bunfig.toml": registryBunfig,
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

// https://github.com/oven-sh/bun/issues/20477: releases bump the versions after the last `bun install`,
// so the manifest sent to the registry has to use the package.json files, not bun.lock.
test.concurrent("publishes the workspace versions and catalog ranges currently in package.json", async () => {
  let captured: any = null;
  using mock = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "PUT") captured = await req.json();
      return new Response("OK", { status: 200 });
    },
  });

  using tmp = tempDir("publish-workspace", {});
  const packageDir = String(tmp);
  const coreDir = join(packageDir, "packages", "core");
  const utilsDir = join(packageDir, "packages", "utils");
  const rootPackageJson = (react: string) =>
    JSON.stringify({ name: "mono", private: true, workspaces: { packages: ["packages/*"], catalog: { react } } });
  const corePackageJson = (version: string) => JSON.stringify({ name: "@acme/core", version });
  const utilsPackageJson = (version: string) =>
    JSON.stringify({
      name: "@acme/utils",
      version,
      dependencies: { "@acme/core": "workspace:*" },
      peerDependencies: { "@acme/core": "workspace:^", "react": "catalog:" },
      // optional so that `bun install` does not ask the mock registry for react
      peerDependenciesMeta: { react: { optional: true } },
    });

  await Promise.all([
    write(
      join(packageDir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: false,
          registry: { url: `http://localhost:${mock.port}`, token: "unused" },
        },
      }),
    ),
    write(join(packageDir, "package.json"), rootPackageJson("^18.3.1")),
    write(join(coreDir, "package.json"), corePackageJson("1.2.3")),
    write(join(utilsDir, "package.json"), utilsPackageJson("0.4.0")),
  ]);
  await runBunInstall(env, packageDir);

  // the release bump, without another install
  await Promise.all([
    write(join(packageDir, "package.json"), rootPackageJson("^19.1.0")),
    write(join(coreDir, "package.json"), corePackageJson("1.3.0")),
    write(join(utilsDir, "package.json"), utilsPackageJson("0.4.1")),
  ]);

  const { err, exitCode } = await publish(env, utilsDir);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(captured.versions["0.4.1"]).toMatchObject({
    name: "@acme/utils",
    version: "0.4.1",
    dependencies: { "@acme/core": "1.3.0" },
    peerDependencies: { "@acme/core": "^1.3.0", "react": "^19.1.0" },
  });
});

test.concurrent("publishes a workspace package next to a bun.lock that does not parse", async () => {
  let captured: any = null;
  using mock = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "PUT") captured = await req.json();
      return new Response("OK", { status: 200 });
    },
  });

  using tmp = tempDir("publish-workspace", {});
  const packageDir = String(tmp);
  const utilsDir = join(packageDir, "packages", "utils");
  await Promise.all([
    write(
      join(packageDir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: { registry: { url: `http://localhost:${mock.port}`, token: "unused" } },
      }),
    ),
    write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "mono", private: true, workspaces: ["packages/*"] }),
    ),
    write(join(packageDir, "bun.lock"), "<<<<<<< HEAD\n"),
    write(
      join(packageDir, "packages", "core", "package.json"),
      JSON.stringify({ name: "@acme/core", version: "1.3.0" }),
    ),
    write(
      join(utilsDir, "package.json"),
      JSON.stringify({ name: "@acme/utils", version: "0.4.1", dependencies: { "@acme/core": "workspace:^" } }),
    ),
  ]);

  const { err, exitCode } = await publish(env, utilsDir);
  expect(err).toBe("");
  expect(exitCode).toBe(0);

  expect(captured.versions["0.4.1"]).toMatchObject({
    name: "@acme/utils",
    version: "0.4.1",
    dependencies: { "@acme/core": "^1.3.0" },
  });
});

test.concurrent("a published package can depend on another workspace by its directory", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const bunfig = await registry.authBunfig("workspacepath");
  const corePkgJson = { name: "publish-pkg-path-core", version: "1.2.3" };
  await Promise.all([
    registry.packages.delete("publish-pkg-path-core"),
    registry.packages.delete("publish-pkg-path-ui"),
    write(join(packageDir, "bunfig.toml"), bunfig),
    write(packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"] })),
    write(join(packageDir, "packages", "core", "package.json"), JSON.stringify(corePkgJson)),
    write(
      join(packageDir, "packages", "ui", "package.json"),
      JSON.stringify({
        name: "publish-pkg-path-ui",
        version: "2.0.0",
        dependencies: {
          "core-alias": "workspace:../core",
          "publish-pkg-path-core": "workspace:../core",
        },
      }),
    ),
  ]);

  for (const pkg of ["core", "ui"]) {
    const { out, err, exitCode } = await publish(env, join(packageDir, "packages", pkg));
    expect(err).not.toContain("error:");
    expect(out).toContain(`+ publish-pkg-path-${pkg}@`);
    expect(exitCode).toBe(0);
  }

  // consume the published package from the registry
  await Promise.all([
    rm(join(packageDir, "packages"), { recursive: true, force: true }),
    write(packageJson, JSON.stringify({ name: "root", dependencies: { "publish-pkg-path-ui": "2.0.0" } })),
  ]);
  await runBunInstall(env, packageDir);

  expect(await file(join(packageDir, "node_modules", "publish-pkg-path-ui", "package.json")).json()).toEqual({
    name: "publish-pkg-path-ui",
    version: "2.0.0",
    dependencies: {
      "core-alias": "npm:publish-pkg-path-core@1.2.3",
      "publish-pkg-path-core": "1.2.3",
    },
  });
  expect(
    await Promise.all([
      file(join(packageDir, "node_modules", "core-alias", "package.json")).json(),
      file(join(packageDir, "node_modules", "publish-pkg-path-core", "package.json")).json(),
    ]),
  ).toEqual([corePkgJson, corePkgJson]);
});

test.concurrent("a published package can depend on another workspace through a workspace: alias", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const bunfig = await registry.authBunfig("workspacealias");
  const corePkgJson = { name: "publish-pkg-alias-core", version: "1.2.3" };
  await Promise.all([
    registry.packages.delete("publish-pkg-alias-core"),
    registry.packages.delete("publish-pkg-alias-ui"),
    write(join(packageDir, "bunfig.toml"), bunfig),
    write(packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"] })),
    write(join(packageDir, "packages", "core", "package.json"), JSON.stringify(corePkgJson)),
    write(
      join(packageDir, "packages", "ui", "package.json"),
      JSON.stringify({
        name: "publish-pkg-alias-ui",
        version: "2.0.0",
        dependencies: {
          "core-alias": "workspace:publish-pkg-alias-core@*",
          "core-compatible": "workspace:publish-pkg-alias-core@^",
          "publish-pkg-alias-core": "workspace:publish-pkg-alias-core@*",
        },
      }),
    ),
  ]);

  for (const pkg of ["core", "ui"]) {
    const { out, err, exitCode } = await publish(env, join(packageDir, "packages", pkg));
    expect(err).not.toContain("error:");
    expect(out).toContain(`+ publish-pkg-alias-${pkg}@`);
    expect(exitCode).toBe(0);
  }

  // consume the published package from the registry
  await Promise.all([
    rm(join(packageDir, "packages"), { recursive: true, force: true }),
    write(packageJson, JSON.stringify({ name: "root", dependencies: { "publish-pkg-alias-ui": "2.0.0" } })),
  ]);
  await runBunInstall(env, packageDir);

  expect(await file(join(packageDir, "node_modules", "publish-pkg-alias-ui", "package.json")).json()).toEqual({
    name: "publish-pkg-alias-ui",
    version: "2.0.0",
    dependencies: {
      "core-alias": "npm:publish-pkg-alias-core@1.2.3",
      "core-compatible": "npm:publish-pkg-alias-core@^1.2.3",
      "publish-pkg-alias-core": "1.2.3",
    },
  });
  expect(
    await Promise.all([
      file(join(packageDir, "node_modules", "core-alias", "package.json")).json(),
      file(join(packageDir, "node_modules", "core-compatible", "package.json")).json(),
      file(join(packageDir, "node_modules", "publish-pkg-alias-core", "package.json")).json(),
    ]),
  ).toEqual([corePkgJson, corePkgJson, corePkgJson]);
});

// Both commands use the same packer. The only difference is where the tarball goes.
test.concurrent("packs the same tarball as `bun pm pack`", async () => {
  const pkg = { name: "pack-and-publish-1", version: "1.2.3", bin: { tool: "bin/tool.js" } };
  using dir = await registryPackage(pkg, {
    "index.js": "module.exports = 1;",
    "lib/a.js": "a",
    "bin/tool.js": "#!/usr/bin/env node\n",
    "README.md": "# hi",
    ".npmignore": "ignored.js",
    "ignored.js": "x",
  });
  using dest = tempDir("pack-and-publish-dest", {});
  /** What either command prints about the tarball: its files, then its totals and checksums. */
  const tarballLines = (out: string) =>
    out.split("\n").filter(line => /^(packed|Total files:|Shasum:|Integrity:|Unpacked size:|Packed size:) /.test(line));

  const dryPacked = await pack(String(dir), env, "--dry-run");
  expect(packedFiles(dryPacked.out)).toEqual(["package.json", "README.md", "bin/tool.js", "index.js", "lib/a.js"]);
  const dryPublished = await publish(env, String(dir), "--dry-run");
  expect(tarballLines(dryPublished.out)).toEqual(tarballLines(dryPacked.out));
  expect(dryPublished.exitCode).toBe(0);

  const packed = await pack(String(dir), env, "--destination", String(dest));
  expect(packedFiles(packed.out)).toEqual(packedFiles(dryPacked.out));
  expect(tarballLines(packed.out)).toContainEqual(expect.stringMatching(/^Shasum: [0-9a-f]{40}$/));
  const published = await publish(env, String(dir));
  expect(tarballLines(published.out)).toEqual(tarballLines(packed.out));
  expect(published.exitCode).toBe(0);

  await write(join(String(dir), "package.json"), JSON.stringify({ ...pkg, version: "1.2.4", private: true }));
  expect(packedFiles((await pack(String(dir), env, "--destination", String(dest))).out)).toEqual(
    packedFiles(packed.out),
  );
  expect(await publish(env, String(dir))).toEqual({
    out: expect.stringMatching(/^bun publish v\S+ \(\S+\)\n$/),
    err: "error: attempted to publish a private package\n",
    exitCode: 1,
  });
});

test.concurrent("a bundled optional dependency that is not installed on this machine is left out", async () => {
  using mock = mockRegistry();
  using dir = tempDir("publish-bundled-absent", {
    "package.json": JSON.stringify({
      name: "bundled-absent",
      version: "1.0.0",
      dependencies: { dep1: "1.0.0" },
      optionalDependencies: { absent: "1.0.0" },
      bundledDependencies: ["absent", "dep1"],
    }),
    "node_modules/dep1/package.json": JSON.stringify({ name: "dep1", version: "1.0.0" }),
    "bunfig.toml": mockBunfig(mock),
  });

  const { err, exitCode } = await publish(env, String(dir));
  expect(err).toBe("");
  expect(mock.requests).toEqual([request("PUT", "/bundled-absent")]);
  expect((await attachedTarball(mock.requests[0].manifest)).files).toEqual([
    "package/node_modules/dep1/package.json",
    "package/package.json",
  ]);
  expect(exitCode).toBe(0);
});

describe.concurrent("--dry-run", () => {
  test("does not publish", async () => {
    using dir = await registryPackage({ name: "dry-run-1", version: "1.1.1", dependencies: { "dry-run-1": "1.1.1" } });

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

    expect(await registry.packages.has("dry-run-1")).toBeFalse();
  });

  // Publishing from a directory used to unlink `<name>-<version>.tgz` in the package directory
  // (where it packed to), also with --dry-run, where nothing had been packed and the file was
  // whatever the user had put there.
  test("doesn't touch a tarball that's already in the package directory", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const bunfig = await registry.authBunfig("dryrunexisting");
    await Promise.all([
      registry.packages.delete("dry-run-3"),
      write(join(packageDir, "bunfig.toml"), bunfig),
      write(packageJson, JSON.stringify({ name: "dry-run-3", version: "3.3.3" })),
    ]);
    await pack(packageDir, env);
    const tarball = join(packageDir, "dry-run-3-3.3.3.tgz");
    const packed = await file(tarball).bytes();

    const { exitCode } = await publish(env, packageDir, "--dry-run");

    expect({ exitCode, tarballExists: await exists(tarball) }).toEqual({ exitCode: 0, tarballExists: true });
    expect(await file(tarball).bytes()).toEqual(packed);
    expect(await registry.packages.has("dry-run-3")).toBeFalse();
  });

  test("does not publish from tarball path", async () => {
    using dir = await registryPackage({ name: "dry-run-2", version: "2.2.2", dependencies: { "dry-run-2": "2.2.2" } });

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

    expect(await registry.packages.has("dry-run-2")).toBeFalse();
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

  // publish only reads package.json, so a file that is readable but not writable (a
  // read-only checkout, a file owned by another user) must not stop it.
  test.skipIf(isWindows)("read-only package.json", async () => {
    using dir = tempDir("publish-read-only", {
      "package.json": JSON.stringify({ name: "dry-run-read-only", version: "4.4.4" }),
      "index.js": "",
    });
    chmodSync(join(String(dir), "package.json"), 0o444);
    using unprivileged = unprivilegedSpawnOptions(String(dir));

    await using proc = spawn({
      cmd: [bunExe(), "publish", "--dry-run"],
      cwd: String(dir),
      // Credentials in the URL satisfy the auth check; --dry-run stops before any request.
      env: { ...env, npm_config_registry: "http://someuser:hunter2@127.0.0.1:1/" },
      stdout: "pipe",
      stderr: "pipe",
      ...unprivileged,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).toBe("");
    expect(out).toContain(" + dry-run-read-only@4.4.4 (dry-run)");
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

  // `http://user@host/` is `user` with an empty password (npm publishes with `Basic base64("user:")`);
  // bun used to stop with "missing authentication". Spelled `user:@` because `user@host:port` does not
  // get through bun's URL parser yet (#16181); both reach the registry config as a username without a password.
  test("--registry with user:@ publishes with Basic auth and an empty password", async () => {
    using mock = mockRegistry();
    using dir = tempDir("publish-userinfo-no-password", {
      "package.json": JSON.stringify({ name: "userinfo-no-password-pkg", version: "1.0.0" }),
    });

    const { out, err, exitCode } = await publish(
      env,
      String(dir),
      "--registry",
      `http://pubuser:@localhost:${mock.port}/`,
    );
    expect(err).toBe("");
    expect(out).toContain(`Registry: http://localhost:${mock.port}/\n`);
    expect(out).toContain(" + userinfo-no-password-pkg@1.0.0");
    expect(mock.requests).toEqual([
      request("PUT", "/userinfo-no-password-pkg", {
        authorization: `Basic ${Buffer.from("pubuser:").toString("base64")}`,
      }),
    ]);
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

describe.concurrent("tarball path", () => {
  // --dry-run stops before the first request, so credentials in the registry url are enough
  // for the auth check and the closed port guarantees nothing is contacted.
  const dryRunEnv = { ...env, npm_config_registry: "http://someuser:hunter2@127.0.0.1:1/" };

  function packageDir(dirName: string, packageName: string) {
    return tempDir(dirName, { "package.json": JSON.stringify({ name: packageName, version: "1.0.0" }) });
  }

  // The tarball path is resolved against the package directory (`${dir}/${tarballPath}`) into a
  // buffer of MAX_PATH_BYTES (src/bun_core/util.rs): 4096 bytes on Linux, 1024 on macOS and, on
  // Windows, the longest possible command line (32767 UTF-16 units) at three UTF-8 bytes per unit.
  const PATH_BUFFER_BYTES = isWindows ? 32767 * 3 + 1 : isLinux ? 4096 : 1024;

  // So on Windows the resolved path only gets that long when it is made of three byte characters.
  // That goes for the directory too: the argument shares the command line with bun.exe and the
  // other arguments, and every byte the directory contributes is one the argument does not need.
  // 150 characters keep the directory within MAX_PATH (260 units), the longest a process can be
  // started in, and leave about 140 units of the command line for the path of bun.exe.
  const FILLER = isWindows ? "\u4e00" : "d";
  const TOO_LONG_DIR = isWindows ? Buffer.alloc(150 * 3, FILLER).toString() : "publish-tarball-path-too-long";

  function nameOfBytes(bytes: number) {
    const remainder = bytes % Buffer.byteLength(FILLER);
    return Buffer.alloc(bytes - remainder, FILLER).toString() + Buffer.alloc(remainder, "d").toString();
  }

  function nameResolvingTo(resolvedBytes: number, dir: string) {
    return nameOfBytes(resolvedBytes - Buffer.byteLength(dir) - 1);
  }

  async function expectTooLong(tarballPathFor: (dir: string) => string) {
    using dir = packageDir(TOO_LONG_DIR, "publish-tarball-path-too-long");
    const tarballPath = tarballPathFor(String(dir));
    if (isWindows) {
      // CreateProcess takes command lines of up to 32767 units, terminating NUL included.
      expect(`"${bunExe()}" publish ${tarballPath} --dry-run\0`.length).toBeLessThanOrEqual(32767);
    }

    const { err, exitCode } = await publish(dryRunEnv, String(dir), tarballPath, "--dry-run");

    expect(err).toContain(`ENAMETOOLONG: File name too long: failed to read tarball: '${tarballPath}'`);
    expect(exitCode).toBe(1);
  }

  test("one byte longer than the path buffer once resolved fails with ENAMETOOLONG", () =>
    expectTooLong(dir => nameResolvingTo(PATH_BUFFER_BYTES + 1, dir)));

  // Neither of these works on Windows: an argument longer than the whole buffer does not fit in a
  // command line, and a path that fills the buffer exactly is refused by the open rather than the
  // join, which on Windows currently reports it as ENOSYS (it takes ENAMETOOLONG's number from the
  // C runtime, where it is a different one than in bun's errno table).
  test.skipIf(isWindows).each([
    ["longer than the path buffer", () => nameOfBytes(5000)],
    // Leaves no room for the terminating NUL.
    ["as long as the path buffer once resolved", (dir: string) => nameResolvingTo(PATH_BUFFER_BYTES, dir)],
  ])("%s fails with ENAMETOOLONG", (_, tarballPathFor) => expectTooLong(tarballPathFor));

  // The resolved path has to fit in the buffer, not the argument as written.
  test("that only fits the path buffer once resolved is read", async () => {
    using dir = packageDir("publish-tarball-path-resolved", "publish-tarball-path-resolved");
    await pack(String(dir), env);
    const tarballPath = Buffer.alloc(5000, "x/../").toString() + "publish-tarball-path-resolved-1.0.0.tgz";

    const { out, err, exitCode } = await publish(dryRunEnv, String(dir), tarballPath, "--dry-run");

    expect(err).not.toContain("error:");
    expect(out).toContain(" + publish-tarball-path-resolved@1.0.0 (dry-run)");
    expect(exitCode).toBe(0);
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
    using dir = await registryPackage({ name, version: "4.4.4", scripts, dependencies: { [name]: "4.4.4" } });

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
    using dir = await registryPackage({
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
  using dir = await registryPackage(
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
  using dir = await registryPackage({
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
  expect(await registry.packages.has("publish-pkg-6")).toBeFalse();

  // try tarball
  await pack(String(dir), env);
  ({ out, err, exitCode } = await publish(env, String(dir), "./publish-pkg-6-6.6.6.tgz"));
  expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`
    "bun publish <version> (<revision>)

    packed 124B package.json"
  `);
  expect(err).toBe("error: attempted to publish a private package\n");
  expect(exitCode).toBe(1);
  expect(await registry.packages.has("publish-pkg-6")).toBeFalse();
  expect(await exists(join(dir, "publish-pkg-6-6.6.6.tgz"))).toBeTrue();
});

// npm checks `manifest.private` with JS truthiness, so every non-empty string and non-zero number refuses the
// publish, "false" included.
describe.concurrent("`private` that is not a boolean", () => {
  function privatePackage(mock: MockRegistry, value: unknown) {
    return tempDir("publish-private", {
      "package.json": JSON.stringify({ name: "private-pkg", version: "1.0.0", private: value }),
      "bunfig.toml": mockBunfig(mock),
    });
  }

  test.each([["true"], ["yes"], ["false"], [1], [{}], [[]]])("%j refuses the publish", async value => {
    using mock = mockRegistry();
    using dir = privatePackage(mock, value);

    let { err, exitCode } = await publish(env, String(dir));
    expect(err).toBe("error: attempted to publish a private package\n");
    expect(exitCode).toBe(1);

    await pack(String(dir), env);
    ({ err, exitCode } = await publish(env, String(dir), "./private-pkg-1.0.0.tgz"));
    expect(err).toBe("error: attempted to publish a private package\n");
    expect(exitCode).toBe(1);
    expect(mock.requests).toEqual([]);
  });

  test.each([false, null, 0, ""])("%j publishes", async value => {
    using mock = mockRegistry();
    using dir = privatePackage(mock, value);

    const { err, exitCode } = await publish(env, String(dir));
    expect(err).toBe("");
    expect(mock.requests).toEqual([request("PUT", "/private-pkg")]);
    expect(exitCode).toBe(0);
  });

  test("a prepublishOnly that sets it refuses the publish", async () => {
    using mock = mockRegistry();
    using dir = tempDir("publish-private-script", {
      "package.json": JSON.stringify({
        name: "private-pkg",
        version: "1.0.0",
        scripts: { prepublishOnly: `${bunExe()} set-private.js` },
      }),
      "set-private.js": `const fs = require("fs");
        fs.writeFileSync("package.json", JSON.stringify({ ...JSON.parse(fs.readFileSync("package.json", "utf8")), private: "true" }));`,
      "bunfig.toml": mockBunfig(mock),
    });

    const { err, exitCode } = await publish(env, String(dir));
    expect(err).toBe(`$ ${bunExe()} set-private.js\nerror: attempted to publish a private package\n`);
    expect(mock.requests).toEqual([]);
    expect(exitCode).toBe(1);
  });
});

// Same as `JSON.parse`, which is how every other tool reads the package.json in the tarball.
describe.concurrent("the last of two equal keys in package.json wins", () => {
  const equalKeys = `{
    "name": "first-name", "version": "1.0.0", "private": true, "publishConfig": { "tag": "first" },
    "name": "equal-keys", "version": "2.0.0", "private": false, "publishConfig": { "tag": "second", "tag": "last" }
  }`;

  test.each(["a directory", "a tarball"])("from %s", async from => {
    using mock = mockRegistry();
    using dir = tempDir("publish-equal-keys", {
      "package.json": from === "a directory" ? equalKeys : JSON.stringify({ name: "here", private: true }),
      "bunfig.toml": mockBunfig(mock),
    });
    const args: string[] = [];
    if (from === "a tarball") {
      await Bun.Archive.write(join(dir, "it.tgz"), { "package/package.json": equalKeys }, { compress: "gzip" });
      args.push("./it.tgz");
    }

    const { out, err, exitCode } = await publish(env, String(dir), ...args);
    expect(err).toBe("");
    expect(out).toContain("\n + equal-keys@2.0.0\n");
    expect(mock.requests).toEqual([request("PUT", "/equal-keys")]);
    const [{ manifest }] = mock.requests;
    expect(manifest["dist-tags"]).toEqual({ last: "2.0.0" });
    expect(Object.keys(manifest.versions)).toEqual(["2.0.0"]);
    expect(Object.keys(manifest._attachments)).toEqual(["equal-keys-2.0.0.tgz"]);
    expect(exitCode).toBe(0);
  });

  test('a last "private": true refuses the publish', async () => {
    using mock = mockRegistry();
    using dir = tempDir("publish-equal-keys-private", {
      "package.json": `{ "name": "equal-keys", "version": "1.0.0", "private": false, "private": true }`,
      "bunfig.toml": mockBunfig(mock),
    });

    const { err, exitCode } = await publish(env, String(dir));
    expect(err).toBe("error: attempted to publish a private package\n");
    expect(mock.requests).toEqual([]);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("package.json version", () => {
  const NOT_SEMVER = "error: package.json `version` is not a valid semver version\n";

  function versionPackage(mock: MockRegistry, version: string, fields = {}, files = {}) {
    return tempDir("publish-version", {
      "package.json": JSON.stringify({ name: "version-pkg", version, ...fields }),
      "bunfig.toml": mockBunfig(mock),
      ...files,
    });
  }

  test.each(["1.0.0.1", "not-a-version", "1.0", "1.0.0-beta_1", "1.x.0", "01.0.0", "99999999999999999999999.0.0"])(
    "%j is refused before a request is sent",
    async version => {
      using mock = mockRegistry();
      using dir = versionPackage(mock, version);

      let { err, exitCode } = await publish(env, String(dir));
      expect(err).toBe(NOT_SEMVER);
      expect(exitCode).toBe(1);

      await pack(String(dir), env);
      ({ err, exitCode } = await publish(env, String(dir), `./version-pkg-${version}.tgz`));
      expect(err).toBe(NOT_SEMVER);
      expect(exitCode).toBe(1);
      expect(mock.requests).toEqual([]);
    },
  );

  test.each([
    ["v1.0.0", "1.0.0"],
    ["=1.0.0", "1.0.0"],
    [" 1.0.0-beta.1 ", "1.0.0-beta.1"],
    ["1.0.0+build.5", "1.0.0"],
  ])("%j is published as %j", async (version, published) => {
    using mock = mockRegistry();
    using dir = versionPackage(mock, version);
    await pack(String(dir), env, "--filename", "pkg.tgz");

    for (const args of [[], ["./pkg.tgz"]]) {
      const { out, err, exitCode } = await publish(env, String(dir), ...args, "--tag", "latest");
      expect(err).toBe("");
      expect(out).toContain(`\n + version-pkg@${published}\n`);
      expect(exitCode).toBe(0);
    }

    expect(mock.requests).toEqual([request("PUT", "/version-pkg"), request("PUT", "/version-pkg")]);
    for (const { manifest } of mock.requests) {
      expect(manifest["dist-tags"]).toEqual({ latest: published });
      expect(Object.keys(manifest.versions)).toEqual([published]);
      expect(manifest.versions[published]).toMatchObject({ _id: `version-pkg@${published}`, version: published });
    }
  });

  // The check applies to what the scripts leave behind, not to the placeholder that they replace.
  test.each([
    ["0.0.0-PLACEHOLDER_", "2.0.0", ""],
    ["1.0.0", "not-a-version", NOT_SEMVER],
  ])("%j that prepublishOnly rewrites to %j", async (version, rewritten, error) => {
    using mock = mockRegistry();
    using dir = versionPackage(
      mock,
      version,
      { scripts: { prepublishOnly: `${bunExe()} set-version.js` } },
      {
        "set-version.js": `const fs = require("fs");
          fs.writeFileSync("package.json", JSON.stringify({ ...JSON.parse(fs.readFileSync("package.json", "utf8")), version: ${JSON.stringify(rewritten)} }));`,
      },
    );

    const { err, exitCode } = await publish(env, String(dir));
    expect(err).toBe(`$ ${bunExe()} set-version.js\n${error}`);
    expect(mock.requests.map(({ manifest }) => Object.keys(manifest.versions))).toEqual(error ? [] : [[rewritten]]);
    expect(exitCode).toBe(error ? 1 : 0);
  });
});

// Bun can't sign a provenance statement. A publish that asks for one has to fail, because a publish that succeeds
// without it looks the same as one that has it.
describe.concurrent("provenance", () => {
  const NOT_SUPPORTED = "is not supported yet: bun publish cannot generate provenance statements\n";

  // `requests` counts everything that reaches the registry. A prepublishOnly that runs is echoed to stderr.
  async function publishProvenancePkg(
    publishConfig: object | undefined,
    args: string[],
    fromTarball = false,
    extraEnv = {},
    npmrc = "",
  ) {
    let requests = 0;
    using mock = Bun.serve({
      port: 0,
      fetch() {
        requests++;
        return new Response("OK", { status: 200 });
      },
    });
    using dir = tempDir("publish-provenance", {
      ".npmrc": npmrc,
      "bunfig.toml": Bun.TOML.stringify({
        install: { cache: false, registry: { url: `http://localhost:${mock.port}`, token: "unused" } },
      }),
      "package.json": JSON.stringify({
        name: "provenance-pkg",
        version: "1.0.0",
        publishConfig,
        scripts: { prepublishOnly: "echo prepublishOnly" },
      }),
    });
    if (fromTarball) await pack(String(dir), env, "--filename", "pkg.tgz");

    const result = await publish({ ...env, ...extraEnv }, String(dir), ...(fromTarball ? ["./pkg.tgz"] : []), ...args);
    return { ...result, requests };
  }

  test.each(["--provenance", "--provenance --dry-run", "--provenance=true", "--provenance-file x.json"])(
    "%s is refused",
    async args => {
      const { out, err, exitCode, requests } = await publishProvenancePkg(undefined, args.split(" "));
      expect(err).toBe(`error: --provenance ${NOT_SUPPORTED}`);
      expect(out).not.toContain("provenance-pkg@1.0.0");
      expect({ requests, exitCode }).toEqual({ requests: 0, exitCode: 1 });
    },
  );

  test.each([
    [true, false],
    [true, true],
    ["true", false],
  ] as [boolean | string, boolean][])(
    "publishConfig.provenance: %p, from a tarball: %p",
    async (provenance, fromTarball) => {
      const { out, err, exitCode, requests } = await publishProvenancePkg({ provenance }, [], fromTarball);
      expect(err).toBe(`error: "provenance" in the publishConfig of package.json ${NOT_SUPPORTED}`);
      expect(out).not.toContain("provenance-pkg@1.0.0");
      expect({ requests, exitCode }).toEqual({ requests: 0, exitCode: 1 });
    },
  );

  test("publishConfig.provenance: false publishes", async () => {
    const { out, err, exitCode, requests } = await publishProvenancePkg({ provenance: false }, []);
    expect(err).not.toContain("error:");
    expect(out).toContain(" + provenance-pkg@1.0.0");
    expect({ requests, exitCode }).toEqual({ requests: 1, exitCode: 0 });
  });

  // The way a GitHub Actions job asks for it.
  test.each([
    [{ NPM_CONFIG_PROVENANCE: "true" }, [], false],
    [{ NPM_CONFIG_PROVENANCE: "true" }, [], true],
    [{ NPM_CONFIG_PROVENANCE: "true" }, ["--dry-run"], false],
    [{ npm_config_provenance: "true" }, [], false],
    [{ NPM_CONFIG_PROVENANCE: "true", npm_config_provenance: "true" }, [], false],
  ] as [object, string[], boolean][])(
    "%j in the environment is refused, args: %j, from a tarball: %p",
    async (vars, args, fromTarball) => {
      const { out, err, exitCode, requests } = await publishProvenancePkg(undefined, args, fromTarball, vars);
      expect(err).toBe(`error: NPM_CONFIG_PROVENANCE ${NOT_SUPPORTED}`);
      expect(out).not.toContain("provenance-pkg@1.0.0");
      expect({ requests, exitCode }).toEqual({ requests: 0, exitCode: 1 });
    },
  );

  test.each([false, true])("provenance=true in .npmrc is refused, from a tarball: %p", async fromTarball => {
    const { out, err, exitCode, requests } = await publishProvenancePkg(
      undefined,
      [],
      fromTarball,
      {},
      "provenance=true",
    );
    expect(err).toBe(`error: "provenance" in .npmrc ${NOT_SUPPORTED}`);
    expect(out).not.toContain("provenance-pkg@1.0.0");
    expect({ requests, exitCode }).toEqual({ requests: 0, exitCode: 1 });
  });

  test("provenance=false in .npmrc publishes", async () => {
    const { out, err, exitCode, requests } = await publishProvenancePkg(undefined, [], false, {}, "provenance=false");
    expect(err).toBe("$ echo prepublishOnly\n");
    expect(out).toContain(" + provenance-pkg@1.0.0");
    expect({ requests, exitCode }).toEqual({ requests: 1, exitCode: 0 });
  });

  test.each(["false", ""])("NPM_CONFIG_PROVENANCE=%j publishes", async NPM_CONFIG_PROVENANCE => {
    const { out, err, exitCode, requests } = await publishProvenancePkg(undefined, [], false, {
      NPM_CONFIG_PROVENANCE,
    });
    expect(err).toBe("$ echo prepublishOnly\n");
    expect(out).toContain(" + provenance-pkg@1.0.0");
    expect({ requests, exitCode }).toEqual({ requests: 1, exitCode: 0 });
  });

  type Settings = { args?: string[]; publishConfig?: object; vars?: object; npmrc?: string; fromTarball?: boolean };

  test.each<Settings>([
    // Values that npm reads as false.
    { args: ["--provenance=false"] },
    { args: ["--no-provenance"] },
    { publishConfig: { provenance: null } },
    { publishConfig: { provenance: "false" } },
    { publishConfig: { provenance: 0 } },
    { vars: { NPM_CONFIG_PROVENANCE: "0" } },
    { vars: { NPM_CONFIG_PROVENANCE: "null" } },
    { npmrc: "provenance=0" },
    // Like in npm, the command line takes precedence over publishConfig, then the environment, then .npmrc.
    { args: ["--no-provenance"], publishConfig: { provenance: true } },
    { args: ["--no-provenance"], publishConfig: { provenance: true }, fromTarball: true },
    { args: ["--provenance=false"], vars: { NPM_CONFIG_PROVENANCE: "true" }, npmrc: "provenance=true" },
    { publishConfig: { provenance: false }, vars: { NPM_CONFIG_PROVENANCE: "true" }, npmrc: "provenance=true" },
    { vars: { NPM_CONFIG_PROVENANCE: "false" }, npmrc: "provenance=true" },
  ])("provenance switched off publishes: %j", async ({ args = [], publishConfig, vars, npmrc, fromTarball }) => {
    const result = await publishProvenancePkg(publishConfig, args, fromTarball, vars, npmrc);
    expect(result.err).toBe(fromTarball ? "" : "$ echo prepublishOnly\n");
    expect(result.out).toContain(" + provenance-pkg@1.0.0");
    expect(result).toMatchObject({ requests: 1, exitCode: 0 });
  });

  test.each<[Settings, string]>([
    [{ vars: { NPM_CONFIG_PROVENANCE: "1" } }, "NPM_CONFIG_PROVENANCE"],
    [{ vars: { NPM_CONFIG_PROVENANCE: "False" } }, "NPM_CONFIG_PROVENANCE"],
    [{ vars: { NPM_CONFIG_PROVENANCE: "true" }, npmrc: "provenance=false" }, "NPM_CONFIG_PROVENANCE"],
    [
      { publishConfig: { provenance: true }, vars: { NPM_CONFIG_PROVENANCE: "false" } },
      '"provenance" in the publishConfig of package.json',
    ],
    [{ args: ["--provenance"], publishConfig: { provenance: false } }, "--provenance"],
    [{ args: ["--provenance", "--no-provenance"] }, "--provenance"],
  ])("provenance switched on is refused: %j", async ({ args = [], publishConfig, vars, npmrc }, askedBy) => {
    const result = await publishProvenancePkg(publishConfig, args, false, vars, npmrc);
    expect(result.err).toBe(`error: ${askedBy} ${NOT_SUPPORTED}`);
    expect(result).toMatchObject({ requests: 0, exitCode: 1 });
  });
});

// Publishing from a directory used to pack into that directory and delete the file again after
// publishing, so any failure in between (here: postpack) left the tarball behind.
test.concurrent("a failed publish does not leave a tarball in the package directory", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "publish-postpack-failed",
        version: "1.0.0",
        scripts: { postpack: "exit 3" },
      }),
    ),
    write(join(packageDir, "index.js"), "module.exports = 1;"),
    write(join(packageDir, "bunfig.toml"), await registry.authBunfig("postpackfailed")),
  ]);

  const { err, exitCode } = await publish(env, packageDir);

  expect(err).toContain('script "postpack" exited with code 3');
  expect({ exitCode, tarballExists: await exists(join(packageDir, "publish-postpack-failed-1.0.0.tgz")) }).toEqual({
    exitCode: 3,
    tarballExists: false,
  });
});

describe.concurrent("access", () => {
  test("--access", async () => {
    using dir = await registryPackage({ name: "publish-pkg-7", version: "7.7.7" });

    // should fail
    let { out, err, exitCode } = await publish(env, String(dir), "--access", "restricted");
    expect(normalizePublishOutput(out, registry.port)).toMatchInlineSnapshot(`"bun publish <version> (<revision>)"`);
    expect(err).toBe("error: unable to restrict access to unscoped package\n");
    expect(exitCode).toBe(1);
    expect(await registry.packages.has("publish-pkg-7")).toBeFalse();

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

    expect(await registry.packages.has("publish-pkg-7")).toBeTrue();
  });

  test.each(["restricted", "public"])("access %s", async access => {
    const name = `@secret/publish-pkg-8-${access}`;
    const pkg = { name, version: "8.8.8", dependencies: { [name]: "8.8.8" }, publishConfig: { access } };
    using dir = await registryPackage(pkg);

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
    using dir = await registryPackage(pkg);

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

  function tagPackage(mock: MockRegistry, version: string, fields = {}) {
    return tempDir("publish-tag", {
      "package.json": JSON.stringify({ name: "tag-pkg", version, ...fields }),
      "bunfig.toml": mockBunfig(mock),
    });
  }

  // `bun add tag-pkg@1.2.3` asks for the version, so nobody could install by such a tag. `npm publish` refuses them
  // too.
  test.each(["1.2.3", "v1.2.3", "v1", "1.x", "x", "*", "^1.0.0", ">=2", "1.0.0-rc.1"])(
    "%j is refused as the tag before a request is sent",
    async tag => {
      using mock = mockRegistry();
      const error = `error: invalid tag "${tag}": cannot be a version or range\n`;

      for (const [fields, flags] of [
        [{}, ["--tag", tag]],
        [{ publishConfig: { tag } }, []],
      ] as const) {
        using dir = tagPackage(mock, "1.0.0", fields);
        await pack(String(dir), env, "--filename", "pkg.tgz");
        for (const args of [[], ["./pkg.tgz"]]) {
          const { err, exitCode } = await publish(env, String(dir), ...args, ...flags);
          expect(err).toBe(error);
          expect(exitCode).toBe(1);
        }
      }
      expect(mock.requests).toEqual([]);
    },
  );

  test("a prerelease isn't published as latest without --tag latest", async () => {
    using mock = mockRegistry();
    using dir = tagPackage(mock, "2.0.0-beta.1");
    await pack(String(dir), env, "--filename", "pkg.tgz");

    for (const args of [[], ["./pkg.tgz"], ["--dry-run"]]) {
      const { err, exitCode } = await publish(env, String(dir), ...args);
      expect(err).toBe(
        'error: prerelease needs a tag: 2.0.0-beta.1 would become "latest"\n' +
          'note: pass a tag, for example bun publish --tag next, or --tag latest to publish it as "latest" anyway\n',
      );
      expect(exitCode).toBe(1);
    }
    expect(mock.requests).toEqual([]);

    for (const tag of ["beta", "latest"]) {
      const { err, exitCode } = await publish(env, String(dir), "--tag", tag);
      expect(err).toBe("");
      expect(mock.requests.pop()?.manifest["dist-tags"]).toEqual({ [tag]: "2.0.0-beta.1" });
      expect(exitCode).toBe(0);
    }
  });

  test("publishConfig.tag is the tag of a prerelease", async () => {
    using mock = mockRegistry();
    using dir = tagPackage(mock, "2.0.0-beta.1", { publishConfig: { tag: "next" } });

    const { err, exitCode } = await publish(env, String(dir));
    expect(err).toBe("");
    expect(mock.requests.map(({ manifest }) => manifest["dist-tags"])).toEqual([{ next: "2.0.0-beta.1" }]);
    expect(exitCode).toBe(0);
  });
});

describe("publishConfig registry", () => {
  // Every request a registry receives, so a test can assert that a registry
  // received exactly one PUT carrying its own token, or nothing at all.
  // `secure`: over https with the harness certificate (`ca`). What a package.json pins is data, like a tarball URL,
  // so a `.npmrc` line follows it only there.
  function mockRegistry({ secure = false } = {}) {
    const requests: { method: string; path: string; authorization: string | null }[] = [];
    let manifest: any;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      ...(secure ? { tls } : {}),
      async fetch(req) {
        requests.push({
          method: req.method,
          path: new URL(req.url).pathname,
          authorization: req.headers.get("authorization"),
        });
        if (req.method === "PUT") manifest = await req.json();
        return new Response("OK");
      },
    });
    return {
      url: `${secure ? "https" : "http"}://127.0.0.1:${server.port}/`,
      host: `127.0.0.1:${server.port}`,
      // The key that `//host/path/:_authToken=` lines in .npmrc use.
      npmrcToken: `//127.0.0.1:${server.port}/:_authToken=token-for-${server.port}`,
      token: `token-for-${server.port}`,
      requests,
      get manifest() {
        return manifest;
      },
      [Symbol.dispose]() {
        server.stop(true);
      },
    };
  }

  const put = (path: string, token: string) => [{ method: "PUT", path, authorization: `Bearer ${token}` }];
  const ca = ["--ca", tls.cert];

  test.concurrent("is published to, with the credentials .npmrc configures for it", async () => {
    using configured = mockRegistry();
    using pinned = mockRegistry({ secure: true });
    using dir = tempDir("publish-config-registry", {
      ".npmrc": `registry=${configured.url}\n${configured.npmrcToken}\n${pinned.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "@corp/secretpkg",
        version: "1.0.0",
        publishConfig: { registry: pinned.url, access: "restricted", tag: "internal" },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir), ...ca);
    expect(err).not.toContain("error:");
    expect(out).toContain(`Tag: internal\nAccess: restricted\nRegistry: ${pinned.url}\n`);
    expect(out).toContain(" + @corp/secretpkg@1.0.0");
    expect(exitCode).toBe(0);

    expect(configured.requests).toEqual([]);
    expect(pinned.requests).toEqual(put("/@corp%2fsecretpkg", pinned.token));
    expect(pinned.manifest).toMatchObject({
      "dist-tags": { internal: "1.0.0" },
      access: "restricted",
      versions: { "1.0.0": { dist: { tarball: `http://${pinned.host}/@corp/secretpkg/-/@corp/secretpkg-1.0.0.tgz` } } },
    });
  });

  test.concurrent("is published to when publishing a tarball", async () => {
    using configured = mockRegistry();
    using pinned = mockRegistry({ secure: true });
    using dir = tempDir("publish-config-registry-tarball", {
      ".npmrc": `registry=${configured.url}\n${configured.npmrcToken}\n${pinned.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "@corp/secretpkg",
        version: "1.0.0",
        publishConfig: { registry: pinned.url, access: "restricted", tag: "internal" },
      }),
    });
    await pack(String(dir), env);

    const { out, err, exitCode } = await publish(env, String(dir), "./corp-secretpkg-1.0.0.tgz", ...ca);
    expect(err).not.toContain("error:");
    expect(out).toContain(`Tag: internal\nAccess: restricted\nRegistry: ${pinned.url}\n`);
    expect(out).toContain(" + @corp/secretpkg@1.0.0");
    expect(exitCode).toBe(0);

    expect(configured.requests).toEqual([]);
    expect(pinned.requests).toEqual(put("/@corp%2fsecretpkg", pinned.token));
    expect(pinned.manifest).toMatchObject({
      "dist-tags": { internal: "1.0.0" },
      access: "restricted",
      versions: { "1.0.0": { dist: { tarball: `http://${pinned.host}/@corp/secretpkg/-/@corp/secretpkg-1.0.0.tgz` } } },
    });
  });

  // Like the name and the version, `publishConfig` is the one in package.json once these scripts have run.
  describe("after the scripts that run before packing", () => {
    /** A package whose `script` merges `written` into its package.json. */
    function scripted(npmrc: string, script: string, fields: object, written: object) {
      return tempDir("publish-config-script", {
        ".npmrc": npmrc,
        "package.json": JSON.stringify({
          name: "scripted-pkg",
          version: "1.0.0",
          scripts: { [script]: `${bunExe()} write.js` },
          files: ["index.js"],
          ...fields,
        }),
        "write.js": `const fs = require("fs");
          const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
          fs.writeFileSync("package.json", JSON.stringify({ ...pkg, ...${JSON.stringify(written)} }));`,
      });
    }

    test.concurrent.each(["prepublishOnly", "prepack", "prepare"])("one that %s writes is used", async script => {
      using configured = mockRegistry();
      using pinned = mockRegistry({ secure: true });
      using dir = scripted(
        `registry=${configured.url}\n${configured.npmrcToken}\n${pinned.npmrcToken}\n`,
        script,
        {},
        { publishConfig: { registry: pinned.url, tag: "internal" } },
      );

      const { out, err, exitCode } = await publish(env, String(dir), ...ca);
      expect(err).not.toContain("error:");
      expect(out).toContain(`Tag: internal\nAccess: default\nRegistry: ${pinned.url}\n`);
      expect(configured.requests).toEqual([]);
      expect(pinned.requests).toEqual(put("/scripted-pkg", pinned.token));
      expect(pinned.manifest["dist-tags"]).toEqual({ internal: "1.0.0" });
      expect(exitCode).toBe(0);
    });

    test.concurrent("one that a script removes isn't used", async () => {
      using configured = mockRegistry();
      using pinned = mockRegistry({ secure: true });
      using dir = scripted(
        `registry=${configured.url}\n${configured.npmrcToken}\n${pinned.npmrcToken}\n`,
        "prepublishOnly",
        { publishConfig: { registry: pinned.url, tag: "internal" } },
        { publishConfig: {} },
      );

      const { out, err, exitCode } = await publish(env, String(dir), ...ca);
      expect(err).not.toContain("error:");
      expect(out).toContain(`Tag: latest\nAccess: default\nRegistry: ${configured.url}\n`);
      expect(pinned.requests).toEqual([]);
      expect(configured.requests).toEqual(put("/scripted-pkg", configured.token));
      expect(exitCode).toBe(0);
    });

    test.concurrent.each([
      [{ access: "restricted" }, "error: unable to restrict access to unscoped package\n"],
      [
        { provenance: true },
        'error: "provenance" in the publishConfig of package.json is not supported yet: bun publish cannot generate provenance statements\n',
      ],
    ])("%j that a script writes is refused", async (publishConfig, error) => {
      using configured = mockRegistry();
      using dir = scripted(
        `registry=${configured.url}\n${configured.npmrcToken}\n`,
        "prepublishOnly",
        {},
        { publishConfig },
      );

      const { err, exitCode } = await publish(env, String(dir));
      expect(err).toBe(`$ ${bunExe()} write.js\n${error}`);
      expect(configured.requests).toEqual([]);
      expect(exitCode).toBe(1);
    });
  });

  test.concurrent("is what --dry-run reports", async () => {
    using configured = mockRegistry();
    using pinned = mockRegistry({ secure: true });
    using dir = tempDir("publish-config-registry-dry-run", {
      ".npmrc": `registry=${configured.url}\n${configured.npmrcToken}\n${pinned.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "dry-run-pinned",
        version: "1.0.0",
        publishConfig: { registry: pinned.url },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir), "--dry-run");
    expect(err).not.toContain("error:");
    expect(out).toContain(`Registry: ${pinned.url}\n`);
    expect(exitCode).toBe(0);
    expect(configured.requests).toEqual([]);
    expect(pinned.requests).toEqual([]);
  });

  test.concurrent("without its own credentials, nothing is sent to the configured registry", async () => {
    using configured = mockRegistry();
    using pinned = mockRegistry();
    using dir = tempDir("publish-config-registry-no-auth", {
      ".npmrc": `registry=${configured.url}\n${configured.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "@corp/secretpkg",
        version: "1.0.0",
        publishConfig: { registry: pinned.url },
      }),
    });

    const { err, exitCode } = await publish(env, String(dir));
    expect(err).toContain("error: missing authentication");
    expect(exitCode).toBe(1);
    expect(configured.requests).toEqual([]);
    expect(pinned.requests).toEqual([]);
  });

  test.concurrent("keeps the credentials of the configured registry when it pins that same registry", async () => {
    using configured = mockRegistry();
    using dir = tempDir("publish-config-registry-same", {
      "bunfig.toml": `[install]\nregistry = { url = "${configured.url}", token = "${configured.token}" }\n`,
      "package.json": JSON.stringify({
        name: "pinned-to-configured",
        version: "1.0.0",
        // No trailing slash, unlike the bunfig.toml url: still the same registry.
        publishConfig: { registry: configured.url.slice(0, -1) },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).not.toContain("error:");
    expect(out).toContain(" + pinned-to-configured@1.0.0");
    expect(exitCode).toBe(0);
    expect(configured.requests).toEqual(put("/pinned-to-configured", configured.token));
  });

  test.concurrent("on the same origin as the configured registry, its credentials carry over", async () => {
    using configured = mockRegistry();
    using dir = tempDir("publish-config-registry-same-origin", {
      "bunfig.toml": `[install]\nregistry = { url = "${configured.url}", token = "${configured.token}" }\n`,
      "package.json": JSON.stringify({
        name: "pinned-to-path",
        version: "1.0.0",
        publishConfig: { registry: `${configured.url}publish/` },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).not.toContain("error:");
    expect(out).toContain(`Registry: ${configured.url}publish/\n`);
    expect(exitCode).toBe(0);
    expect(configured.requests).toEqual(put("/publish/pinned-to-path", configured.token));
  });

  test.concurrent("loses to --registry", async () => {
    using flag = mockRegistry();
    using pinned = mockRegistry();
    using dir = tempDir("publish-config-registry-flag", {
      ".npmrc": `registry=${flag.url}\n${flag.npmrcToken}\n${pinned.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "flag-wins",
        version: "1.0.0",
        publishConfig: { registry: pinned.url },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir), "--registry", flag.url);
    expect(err).not.toContain("error:");
    expect(out).toContain(`Registry: ${flag.url}\n`);
    expect(exitCode).toBe(0);
    expect(flag.requests).toEqual(put("/flag-wins", flag.token));
    expect(pinned.requests).toEqual([]);
  });

  test.concurrent("--registry is given the credentials .npmrc configures for it", async () => {
    using flag = mockRegistry();
    using dir = tempDir("registry-flag-npmrc-auth", {
      ".npmrc": `${flag.npmrcToken}\n`,
      "package.json": JSON.stringify({ name: "flag-auth", version: "1.0.0" }),
    });

    const { out, err, exitCode } = await publish(env, String(dir), "--registry", flag.url);
    expect(err).not.toContain("error:");
    expect(out).toContain(" + flag-auth@1.0.0");
    expect(exitCode).toBe(0);
    expect(flag.requests).toEqual(put("/flag-auth", flag.token));
  });

  test.concurrent("does not override a registry configured for the package's scope", async () => {
    using configured = mockRegistry();
    using scoped = mockRegistry();
    using pinned = mockRegistry();
    using dir = tempDir("publish-config-registry-scoped", {
      ".npmrc": [
        `registry=${configured.url}`,
        `@corp:registry=${scoped.url}`,
        configured.npmrcToken,
        scoped.npmrcToken,
        pinned.npmrcToken,
        "",
      ].join("\n"),
      "package.json": JSON.stringify({
        name: "@corp/scoped-wins",
        version: "1.0.0",
        publishConfig: { registry: pinned.url },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).not.toContain("error:");
    expect(out).toContain(`Registry: ${scoped.url}\n`);
    expect(exitCode).toBe(0);
    expect(configured.requests).toEqual([]);
    expect(scoped.requests).toEqual(put("/@corp%2fscoped-wins", scoped.token));
    expect(pinned.requests).toEqual([]);
  });

  test.concurrent("@scope:registry overrides the registry configured for the scope", async () => {
    using scoped = mockRegistry();
    using pinned = mockRegistry({ secure: true });
    using dir = tempDir("publish-config-scope-registry", {
      ".npmrc": `@corp:registry=${scoped.url}\n${scoped.npmrcToken}\n${pinned.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "@corp/pinned-scope",
        version: "1.0.0",
        publishConfig: { "@corp:registry": pinned.url },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir), ...ca);
    expect(err).not.toContain("error:");
    expect(out).toContain(`Registry: ${pinned.url}\n`);
    expect(exitCode).toBe(0);
    expect(scoped.requests).toEqual([]);
    expect(pinned.requests).toEqual(put("/@corp%2fpinned-scope", pinned.token));
  });

  // Which credential goes to the URL a package.json (for `bun publish x.tgz`, the one in the tarball) pins.
  // `configured` is the default registry, https, mounted at /reg/, with the token DEF on its own key.
  type Mock = ReturnType<typeof mockRegistry>;
  type Pin = {
    registry: string;
    npmrc?: string;
    env?: Record<string, string>;
    /** Who gets the PUT, where and with which `Authorization`. Nobody: "missing authentication", no request at all. */
    sent?: [to: Mock, path: string, authorization: string];
  };
  const pins: [string, (configured: Mock, pinned: Mock, plain: Mock) => Pin][] = [
    [
      "another https host with a line on an ancestor key",
      (_, pinned) => ({
        registry: `${pinned.url}pub/`,
        npmrc: `//${pinned.host}/:_authToken=PUB\n`,
        sent: [pinned, "/pub/pinned-pkg", "Bearer PUB"],
      }),
    ],
    ["another https host without a line", (_, pinned) => ({ registry: `${pinned.url}pub/` })],
    [
      "another https host, with only $BUN_CONFIG_TOKEN",
      (_, pinned) => ({ registry: `${pinned.url}pub/`, env: { BUN_CONFIG_TOKEN: "ENV" } }),
    ],
    [
      "a path below the configured registry",
      configured => ({
        registry: `${configured.url}reg/pub/`,
        sent: [configured, "/reg/pub/pinned-pkg", "Bearer DEF"],
      }),
    ],
    ["a sibling path of the configured registry", configured => ({ registry: `${configured.url}pub/` })],
    [
      "an http host that has a line",
      (_, __, plain) => ({ registry: plain.url, npmrc: `//${plain.host}/:_authToken=PLAIN\n` }),
    ],
    [
      "an http URL the user configured as a registry too",
      (_, __, plain) => ({
        registry: plain.url,
        npmrc: `@other:registry=${plain.url}\n//${plain.host}/:_authToken=PLAIN\n`,
        sent: [plain, "/pinned-pkg", "Bearer PLAIN"],
      }),
    ],
    [
      "userinfo",
      (_, pinned) => ({
        registry: `https://u:p@${pinned.host}/pub/`,
        sent: [pinned, "/pub/pinned-pkg", `Basic ${btoa("u:p")}`],
      }),
    ],
    [
      "userinfo that names a variable of this process",
      (_, pinned) => ({
        registry: `https://:$PUBLISH_SECRET@${pinned.host}/pub/`,
        env: { PUBLISH_SECRET: "must-not-leak" },
        sent: [pinned, "/pub/pinned-pkg", "Bearer $PUBLISH_SECRET"],
      }),
    ],
    [
      "a token after the path",
      (_, pinned) => ({
        registry: `${pinned.url}pub/:_authToken=EMBEDDED`,
        sent: [pinned, "/pub/pinned-pkg", "Bearer EMBEDDED"],
      }),
    ],
  ];

  describe.each(["a directory", "a tarball"])("from %s, pinned to", from => {
    test.concurrent.each(pins)("%s", async (_, pin) => {
      using configured = mockRegistry({ secure: true });
      using pinned = mockRegistry({ secure: true });
      using plain = mockRegistry();
      const { registry, npmrc = "", env: extraEnv, sent } = pin(configured, pinned, plain);
      using dir = tempDir("publish-config-registry-pin", {
        ".npmrc": `registry=${configured.url}reg/\n//${configured.host}/reg/:_authToken=DEF\n${npmrc}`,
        "package.json": JSON.stringify({ name: "pinned-pkg", version: "1.0.0", publishConfig: { registry } }),
      });
      if (from === "a tarball") await pack(String(dir), env);

      const { err, exitCode } = await publish(
        { ...env, ...extraEnv },
        String(dir),
        ...(from === "a tarball" ? ["./pinned-pkg-1.0.0.tgz"] : []),
        ...ca,
      );

      if (sent === undefined) expect(err).toContain("error: missing authentication");
      else expect(err).not.toContain("error:");
      for (const mock of [configured, pinned, plain]) {
        expect(mock.requests).toEqual(
          mock === sent?.[0] ? [{ method: "PUT", path: sent[1], authorization: sent[2] }] : [],
        );
      }
      expect(exitCode).toBe(sent === undefined ? 1 : 0);
    });
  });

  const expected = "expected a URL starting with 'https://' or 'http://'";
  test.concurrent.each([
    [
      "registry",
      "ftp://127.0.0.1:1/",
      `error: invalid \`registry\` value in \`publishConfig\`: "ftp://127.0.0.1:1/", ${expected}\n`,
    ],
    ["registry", ["http://127.0.0.1:1/"], `error: invalid \`registry\` value in \`publishConfig\`, ${expected}\n`],
    ["registry", "", `error: invalid \`registry\` value in \`publishConfig\`: "", ${expected}\n`],
    [
      "@corp:registry",
      "127.0.0.1:1",
      `error: invalid \`@corp:registry\` value in \`publishConfig\`: "127.0.0.1:1", ${expected}\n`,
    ],
  ])("%s set to %j is an error, and nothing is published anywhere", async (key, value, message) => {
    using configured = mockRegistry();
    using dir = tempDir("publish-config-registry-invalid", {
      ".npmrc": `registry=${configured.url}\n${configured.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "@corp/invalid-registry",
        version: "1.0.0",
        publishConfig: { [key]: value },
      }),
    });

    const { err, exitCode } = await publish(env, String(dir));
    expect(err).toContain(message);
    expect(exitCode).toBe(1);
    expect(configured.requests).toEqual([]);
  });
});

test.concurrent("$npm_command is accurate during publish", async () => {
  using dir = await registryPackage({
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
  registry.packages.delete("publish-pkg-11");
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
    "bunfig.toml": registryBunfig,
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

// https://github.com/oven-sh/bun/issues/29273
// `C:` is the current directory of drive C, it is not the root `C:\`.
test.concurrent.skipIf(!isWindows)("publishes a package in the root of a drive", async () => {
  using dir = await registryPackage({
    name: "publish-pkg-drive-root",
    version: "1.0.0",
    scripts: { prepack: "touch prepack.txt", publish: "touch publish.txt" },
  });
  using drive = substDrive(String(dir));

  const { out, err, exitCode } = await publish(env, drive.root);
  expect(err).toBe("$ touch prepack.txt\n$ touch publish.txt\n");
  expect(out).toContain(" + publish-pkg-drive-root@1.0.0");
  // Each script ran in the root.
  expect(existsSync(join(String(dir), "prepack.txt"))).toBe(true);
  expect(existsSync(join(String(dir), "publish.txt"))).toBe(true);
  expect(exitCode).toBe(0);
});

test.concurrent("lifecycle scripts get the workspace member's npm_package_* when publishing a member", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const memberDir = join(packageDir, "packages", "publish-pkg-12");
  const echoPackageEnv = "$npm_package_name $npm_package_version $npm_package_json $npm_config_local_prefix";
  const events = ["prepublishOnly", "prepack", "postpack", "publish", "postpublish"];
  await Promise.all([
    write(join(packageDir, "bunfig.toml"), await registry.authBunfig("npm_package_env")),
    write(packageJson, JSON.stringify({ name: "root", version: "0.0.1", workspaces: ["packages/*"] })),
    write(
      join(memberDir, "package.json"),
      JSON.stringify({
        name: "publish-pkg-12",
        version: "12.0.0",
        scripts: Object.fromEntries(events.map(event => [event, `echo ${event} ${echoPackageEnv}`])),
      }),
    ),
  ]);

  const { out, err, exitCode } = await publish(env, memberDir, "--dry-run");
  // npm_config_local_prefix is the workspace root, as with npm.
  const memberEnv = `publish-pkg-12 12.0.0 ${join(memberDir, "package.json")} ${packageDir}`;
  expect(out.split("\n").filter(line => events.some(event => line.startsWith(`${event} `)))).toEqual(
    events.map(event => `${event} ${memberEnv}`),
  );
  expect(err).not.toContain("error:");
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

  // A README that is a symlink is not packed (symlinks never are), so its
  // target must not be published as the readme either.
  test("a README that is a symlink is not sent as readme", async () => {
    let captured: any = null;
    using mock = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") captured = await req.json();
        return new Response("OK", { status: 200 });
      },
    });

    using tmp = tempDir("publish-readme-symlink", {});
    const dir = String(tmp);
    const packageDir = join(dir, "pkg");
    await Promise.all([
      write(join(dir, "outside", "README.md"), "# outside the package"),
      write(
        join(packageDir, "bunfig.toml"),
        Bun.TOML.stringify({
          install: {
            cache: false,
            registry: { url: `http://localhost:${mock.port}`, token: "unused" },
          },
        }),
      ),
      write(join(packageDir, "package.json"), JSON.stringify({ name: "readme-pkg-3", version: "3.0.0" })),
      write(join(packageDir, "index.js"), "module.exports = 3;"),
    ]);
    await symlink(join("..", "outside", "README.md"), join(packageDir, "README.md"), "file");

    const { err, exitCode } = await publish(env, packageDir);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(captured.versions["3.0.0"]).not.toContainAnyKeys(["readme", "readmeFilename"]);
    expect(JSON.stringify(captured)).not.toContain("outside the package");
  });
});

// The manifest "bin" that reaches the registry. Paths are resolved against the
// package root the way npm does it ("../cli.js" is "cli.js"), a value that
// resolves to the root itself is dropped, other values are kept as written (npm
// keeps "lib/" as well), and "directories.bin" is expanded with the same rule
// the tarball uses.
describe.concurrent("bin in the published manifest", () => {
  test.each([
    [{ bin: "cli.js" }, { "bin-pkg": "cli.js" }],
    [{ bin: "../cli.js" }, { "bin-pkg": "cli.js" }],
    [{ bin: "" }, {}],
    [{ bin: "." }, {}],
    [{ bin: { x: "lib/", y: "./cli.js", z: "", w: ".", v: "../../cli.js" } }, { x: "lib/", y: "cli.js", v: "cli.js" }],
    [{ directories: { bin: "bins/" } }, { "a.js": "bins/a.js" }],
    [{ directories: { bin: "" } }, undefined],
    [{ directories: { bin: "." } }, undefined],
    [{ directories: { bin: "cli.js" } }, undefined],
    [{ directories: { bin: "missing" } }, undefined],
    [{ bin: "", directories: { bin: "bins" } }, { "a.js": "bins/a.js" }],
    [{ bin: {}, directories: { bin: "bins" } }, { "a.js": "bins/a.js" }],
    [{ bin: "", directories: { bin: "missing" } }, {}],
    [{ bin: "cli.js", directories: { bin: "bins" } }, { "bin-pkg": "cli.js" }],
  ])("%j", async (fields, expected) => {
    let captured: any = null;
    using mock = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") captured = await req.json();
        return new Response("OK", { status: 200 });
      },
    });

    using tmp = tempDir("publish-bin-manifest", {});
    const packageDir = String(tmp);
    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        Bun.TOML.stringify({
          install: {
            cache: false,
            registry: { url: `http://localhost:${mock.port}`, token: "unused" },
          },
        }),
      ),
      write(join(packageDir, "package.json"), JSON.stringify({ name: "bin-pkg", version: "1.0.0", ...fields })),
      write(join(packageDir, "cli.js"), "#!/usr/bin/env node\n"),
      write(join(packageDir, "lib", "a.js"), "module.exports = 1;"),
      write(join(packageDir, "bins", "a.js"), "#!/usr/bin/env node\n"),
    ]);

    const { err, exitCode } = await publish(env, packageDir);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(captured.versions["1.0.0"].bin).toEqual(expected);
  });

  // No matter which folder the command runs in.
  test.each([
    [{ directories: { bin: "bin" } }, { "tool-cmd": "bin/tool-cmd", "other-cmd": "bin/more/other-cmd" }, ""],
    [{ directories: { bin: "scripts" } }, undefined, "warn: bin directory 'scripts' does not exist\n"],
    [
      { bin: { packed: "bin/tool-cmd", "not-packed": "scripts/here.sh" } },
      { packed: "bin/tool-cmd", "not-packed": "scripts/here.sh" },
      "warn: bin 'scripts/here.sh' does not exist\n",
    ],
  ])("of a tarball with %j is looked up in the tarball", async (fields, expected, warnings) => {
    using mock = mockRegistry();
    using dir = tempDir("publish-bin-tarball", {
      "package.json": JSON.stringify({ name: "here", private: true }),
      "bunfig.toml": mockBunfig(mock),
      "bin/here.sh": "#!/bin/sh\n",
      "scripts/here.sh": "#!/bin/sh\n",
    });
    await Bun.Archive.write(
      join(dir, "tool-1.0.0.tgz"),
      {
        "package/package.json": JSON.stringify({ name: "tool", version: "1.0.0", ...fields }),
        "package/bin/tool-cmd": "#!/bin/sh\n",
        "package/bin/more/other-cmd": "#!/bin/sh\n",
      },
      { compress: "gzip" },
    );

    const { err, exitCode } = await publish(env, String(dir), "./tool-1.0.0.tgz");
    expect(err).toBe(warnings);
    expect(mock.requests).toEqual([request("PUT", "/tool")]);
    expect(mock.requests[0].manifest.versions["1.0.0"].bin).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  // Neither one is packed. Listing them would send the file names of a directory outside the package to the registry.
  test.each([
    ["linked", "warn: bin directory 'linked' is not a directory\n"],
    ["linked/nested", "warn: bin directory 'linked/nested' does not exist\n"],
  ])('"directories.bin" of %j, a symlink out of the package, is not listed', async (bin, warning) => {
    using mock = mockRegistry();
    using dir = tempDir("publish-bin-symlink", {
      "outside/secret-name.js": "outside the package",
      "outside/nested/other-secret-name.js": "outside the package",
      "pkg/package.json": JSON.stringify({ name: "bin-pkg", version: "1.0.0", directories: { bin } }),
      "pkg/bunfig.toml": mockBunfig(mock),
      "pkg/index.js": "module.exports = 1;",
    });
    // A junction on Windows. Elsewhere, "junction" is ignored and a plain symlink is created.
    await symlink(join(dir, "outside"), join(dir, "pkg", "linked"), "junction");

    const { err, exitCode } = await publish(env, join(dir, "pkg"));
    expect(err).toBe(warning);
    expect(mock.requests).toEqual([request("PUT", "/bin-pkg")]);
    const [{ manifest }] = mock.requests;
    expect(manifest.versions["1.0.0"].bin).toBeUndefined();
    expect(JSON.stringify(manifest.versions)).not.toContain("secret-name");
    expect((await attachedTarball(manifest)).files).toEqual(["package/index.js", "package/package.json"]);
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

describe.concurrent("basic auth", () => {
  // Every spelling below makes `bun install` send `Authorization: Basic`, and npm publishes with
  // all of them. `bun publish` used to stop with "missing authentication" unless a bearer token
  // was configured, before sending anything. https://github.com/oven-sh/bun/issues/18670
  const username = "alice";
  const password = "s3cret";
  const userPass = Buffer.from(`${username}:${password}`).toString("base64");

  const configs: [name: string, files: (host: string) => Record<string, string>][] = [
    [".npmrc _auth", host => ({ ".npmrc": `registry=http://${host}/\n//${host}/:_auth=${userPass}\n` })],
    [
      ".npmrc username and _password",
      host => ({
        ".npmrc": [
          `registry=http://${host}/`,
          `//${host}/:username=${username}`,
          `//${host}/:_password=${Buffer.from(password).toString("base64")}`,
          "",
        ].join("\n"),
      }),
    ],
    [".npmrc registry url with userinfo", host => ({ ".npmrc": `registry=http://${username}:${password}@${host}/\n` })],
    [
      "bunfig.toml registry username and password",
      host => ({
        "bunfig.toml": Bun.TOML.stringify({
          install: { cache: false, registry: { url: `http://${host}/`, username, password } },
        }),
      }),
    ],
  ];

  async function publishWith(files: (host: string) => Record<string, string>) {
    const requests: string[] = [];
    using mock = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(`${req.method} ${new URL(req.url).pathname} ${req.headers.get("authorization")}`);
        return new Response("OK", { status: 200 });
      },
    });

    using dir = tempDir("publish-basic-auth", {
      "package.json": JSON.stringify({ name: "basic-auth-pkg", version: "1.0.0" }),
      // Empty home directory so the machine's own .npmrc / bunfig.toml cannot supply credentials.
      "home/.keep": "",
      ...files(`localhost:${mock.port}`),
    });
    const home = join(String(dir), "home");

    const result = await publish({ ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home }, String(dir));
    return { ...result, requests };
  }

  test.each(configs)("%s", async (_, files) => {
    const { out, err, exitCode, requests } = await publishWith(files);
    expect(err).not.toContain("error:");
    expect(out).toContain(" + basic-auth-pkg@1.0.0");
    expect(requests).toEqual([`PUT /basic-auth-pkg Basic ${userPass}`]);
    expect(exitCode).toBe(0);
  });

  test("still refuses to publish without any credentials", async () => {
    const { out, err, exitCode, requests } = await publishWith(host => ({ ".npmrc": `registry=http://${host}/\n` }));
    expect(err).toContain("error: missing authentication (run `bunx npm login`)");
    expect(out).not.toContain(" + basic-auth-pkg@1.0.0");
    expect(requests).toEqual([]);
    expect(exitCode).toBe(1);
  });
});

test.concurrent("user:pass@ in a registry url taken from an env var is sent as Basic auth", async () => {
  const requests: { method: string; pathname: string; authorization: string | null }[] = [];
  using mock = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push({
        method: req.method,
        pathname: new URL(req.url).pathname,
        authorization: req.headers.get("authorization"),
      });
      return new Response("OK", { status: 200 });
    },
  });

  using packageDir = tempDir("publish-env-registry-userinfo", {
    "package.json": JSON.stringify({ name: "env-userinfo-pkg", version: "1.0.0" }),
    "bunfig.toml": `[install]\nregistry = "$PUBLISH_REGISTRY"\n`,
  });

  const { out, err, exitCode } = await publish(
    { ...env, PUBLISH_REGISTRY: `http://pubuser:hunter2@localhost:${mock.port}/` },
    String(packageDir),
  );
  expect({ requests, err }).toEqual({
    requests: [
      {
        method: "PUT",
        pathname: "/env-userinfo-pkg",
        authorization: `Basic ${Buffer.from("pubuser:hunter2").toString("base64")}`,
      },
    ],
    err: expect.not.stringContaining("error:"),
  });
  expect(out).toContain(`Registry: http://localhost:${mock.port}/\n`);
  expect(out).toContain(" + env-userinfo-pkg@1.0.0");
  expect(out).not.toContain("hunter2");
  expect(exitCode).toBe(0);
});

describe.concurrent("--tolerate-republish", () => {
  test("republishing normally fails", async () => {
    using dir = await registryPackage({ name: "republish-test-1", version: "1.0.0" });

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
      `\n403 Forbidden: http://localhost:${registry.port}/republish-test-1\n\n` +
        ` - You cannot publish over the previously published versions: 1.0.0.\n`,
    );
    expect(exitCode).toBe(1);
  });

  test("republishing with --tolerate-republish skips when version exists", async () => {
    using dir = await registryPackage({ name: "republish-test-2", version: "1.0.0" });

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
      Packed size: <size>"
    `);
    expect(exitCode).toBe(0);
  });

  // Nothing was published, so nothing says that it was: no ` + name@version`, and no `publish` and `postpublish`
  // scripts.
  test("a skipped version runs the scripts of the pack only", async () => {
    using mock = mockRegistry(req =>
      req.method === "GET"
        ? Response.json({ name: "republish-scripts", versions: { "1.0.0": {} } })
        : new Response("OK", { status: 200 }),
    );
    const events = ["prepublishOnly", "prepack", "prepare", "postpack", "publish", "postpublish"];
    const pkg = (version: string) =>
      JSON.stringify({
        name: "republish-scripts",
        version,
        scripts: Object.fromEntries(events.map(event => [event, `echo ${event}`])),
      });
    using dir = tempDir("publish-republish-scripts", { "package.json": pkg("1.0.0"), "bunfig.toml": mockBunfig(mock) });
    const ran = (err: string) => err.split("\n").filter(line => line.startsWith("$ "));

    let { out, err, exitCode } = await publish(env, String(dir), "--tolerate-republish");
    expect(ran(err)).toEqual(events.slice(0, 4).map(event => `$ echo ${event}`));
    expect(err).toContain("warn: Registry already knows about version 1.0.0; skipping.\n");
    expect(out).not.toContain("republish-scripts@");
    expect(exitCode).toBe(0);

    // a version the registry does not have is published as without the flag
    await write(join(dir, "package.json"), pkg("1.0.1"));
    ({ out, err, exitCode } = await publish(env, String(dir), "--tolerate-republish"));
    expect(ran(err)).toEqual(events.map(event => `$ echo ${event}`));
    expect(out).toContain("\n + republish-scripts@1.0.1\n");
    expect(exitCode).toBe(0);

    expect(mock.requests).toEqual([
      expect.objectContaining({ method: "GET", pathname: "/republish-scripts" }),
      expect.objectContaining({ method: "GET", pathname: "/republish-scripts" }),
      request("PUT", "/republish-scripts"),
    ]);
  });

  test("republishing tarball with --tolerate-republish skips when version exists", async () => {
    using dir = await registryPackage({ name: "republish-test-3", version: "1.0.0" });

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
      Packed size: <size>"
    `);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("--recursive and --filter", () => {
  // `asked`: every request as `METHOD name`, in order. `known`: the name@version pairs the registry already has.
  // `reject`: the names whose PUT it answers with 403. `manifests`: the bodies of the PUTs it accepted, by name.
  function workspaceRegistry(secure = false) {
    const asked: string[] = [];
    const known: string[] = [];
    const reject: string[] = [];
    const manifests: Record<string, any> = {};
    const mock = mockRegistry((req, recorded) => {
      const name = decodeURIComponent(recorded.pathname.slice(1));
      asked.push(`${req.method} ${name}`);
      if (req.method === "GET") {
        const versions = known.filter(pair => pair.startsWith(`${name}@`)).map(pair => pair.slice(name.length + 1));
        if (versions.length === 0) return new Response("not found", { status: 404 });
        return Response.json({ name, versions: Object.fromEntries(versions.map(version => [version, {}])) });
      }
      if (reject.includes(name)) return Response.json({ error: `${name} is not yours` }, { status: 403 });
      manifests[name] = recorded.manifest;
      return new Response("OK");
    }, secure);
    return { mock, asked, known, reject, manifests, [Symbol.dispose]: () => mock[Symbol.dispose]() };
  }

  // A private root with `a`, `b` (depends on `a`), `c` (depends on `b`) and `hidden` (private) in packages/. Nothing is
  // installed and there is no bun.lock: the members, their order and their versions come from the package.json files.
  // `members` adds directories, or replaces fields of these four.
  function workspace(mock: MockRegistry, members: Record<string, object> = {}, files: Record<string, string> = {}) {
    const member = (name: string, dependencies?: Record<string, string>) => ({
      name: `rec-${name}`,
      version: "1.0.0",
      dependencies,
      scripts: { prepublishOnly: `echo prepublishOnly rec-${name}`, postpublish: "echo postpublish $npm_package_name" },
    });
    const all: Record<string, object> = {
      a: member("a"),
      b: member("b", { "rec-a": "workspace:*" }),
      c: member("c", { "rec-b": "workspace:^" }),
      hidden: { name: "rec-hidden", version: "1.0.0", private: true },
    };
    for (const [dir, fields] of Object.entries(members)) all[dir] = { ...all[dir], ...fields };
    return tempDir("publish-recursive", {
      "bunfig.toml": mockBunfig(mock),
      "package.json": JSON.stringify({ name: "rec-root", private: true, workspaces: ["packages/*"] }),
      ...Object.fromEntries(
        Object.entries(all).map(([dir, json]) => [`packages/${dir}/package.json`, JSON.stringify(json)]),
      ),
      ...files,
    });
  }

  const lines = (text: string) => text.split("\n").filter(line => line !== "");
  const published = (out: string) => out.match(/^ \+ .*$/gm) ?? [];
  const POSTPUBLISH = "$ echo postpublish $npm_package_name";

  test("packs everything, then publishes dependencies before dependents", async () => {
    using registry = workspaceRegistry();
    using dir = workspace(registry.mock);

    const { out, err, exitCode } = await publish(env, String(dir), "--recursive");
    expect(lines(err)).toEqual([
      "$ echo prepublishOnly rec-a",
      "$ echo prepublishOnly rec-b",
      "$ echo prepublishOnly rec-c",
      POSTPUBLISH,
      POSTPUBLISH,
      POSTPUBLISH,
    ]);
    expect(registry.asked).toEqual(["GET rec-a", "GET rec-b", "GET rec-c", "PUT rec-a", "PUT rec-b", "PUT rec-c"]);
    expect(published(out)).toEqual([" + rec-a@1.0.0", " + rec-b@1.0.0", " + rec-c@1.0.0"]);
    expect(out.match(/^skipped .*$/gm)?.sort()).toEqual(["skipped rec-hidden: private", "skipped rec-root: private"]);
    // Each script sees its own package, not the one that was packed last.
    expect(out.match(/^postpublish .*$/gm)).toEqual(["postpublish rec-a", "postpublish rec-b", "postpublish rec-c"]);
    expect(registry.manifests["rec-b"].versions["1.0.0"].dependencies).toEqual({ "rec-a": "1.0.0" });
    expect(registry.manifests["rec-c"].versions["1.0.0"].dependencies).toEqual({ "rec-b": "^1.0.0" });
    for (const { method, userAgent } of registry.mock.requests) {
      if (method === "PUT") expect(userAgent).toContain(" workspaces/true");
    }
    expect(existsSync(join(dir, "bun.lock"))).toBeFalse();
    expect(exitCode).toBe(0);
  });

  test("a package without scripts gets the version of a dependency that ran one", async () => {
    using registry = workspaceRegistry();
    using dir = workspace(registry.mock, {
      a: { version: "2.0.0" },
      plain: { name: "rec-plain", version: "1.0.0", dependencies: { "rec-a": "workspace:^" } },
    });

    const { out, err, exitCode } = await publish(env, String(dir), "--filter", "rec-a", "--filter", "rec-plain");
    expect(lines(err)).toEqual(["$ echo prepublishOnly rec-a", POSTPUBLISH]);
    expect(published(out)).toEqual([" + rec-a@2.0.0", " + rec-plain@1.0.0"]);
    expect(registry.manifests["rec-plain"].versions["1.0.0"].dependencies).toEqual({ "rec-a": "^2.0.0" });
    expect(exitCode).toBe(0);
  });

  test.each([
    ["workspace:../a", "1.0.0-rc.1"],
    ["workspace:rec-a@^", "^1.0.0-rc.1"],
    ["workspace:rec-a@~", "~1.0.0-rc.1"],
  ])("%s on a prerelease is published as %s, with and without -r", async (spec, range) => {
    using registry = workspaceRegistry();
    using dir = workspace(registry.mock, {
      a: { version: "1.0.0-rc.1" },
      plain: { name: "rec-plain", version: "1.0.0", dependencies: { "rec-a": spec } },
    });

    for (const [cwd, ...flags] of [[join(dir, "packages", "plain")], [String(dir), "-r", "--tag", "next"]]) {
      delete registry.manifests["rec-plain"];
      const { out, err, exitCode } = await publish(env, cwd, ...flags);
      expect(err).not.toContain("error:");
      expect(published(out)).toContain(" + rec-plain@1.0.0");
      expect(registry.manifests["rec-plain"].versions["1.0.0"].dependencies).toEqual({ "rec-a": range });
      expect(exitCode).toBe(0);
    }
  });

  test("the scripts of each package run the commands of its own node_modules/.bin", async () => {
    using registry = workspaceRegistry();
    const names = ["prepublishOnly", "prepack", "prepare", "postpack", "publish", "postpublish"];
    const scripts = Object.fromEntries(names.map(name => [name, "tool"]));
    using dir = workspace(registry.mock, {
      a: { scripts },
      b: { scripts: { ...scripts, prepare: "only-a || echo tool of nobody" } },
    });
    for (const name of ["a", "b"]) writeBinCommand(join(dir, "packages", name), "tool", `tool of rec-${name}`);
    writeBinCommand(join(dir, "packages", "a"), "only-a", "tool of rec-a, in rec-b");

    const { out, err, exitCode } = await publish(env, String(dir), "--filter", "rec-a", "--filter", "rec-b");
    expect(lines(err).filter(line => !line.includes("only-a"))).toEqual(Array(11).fill("$ tool"));
    expect(out.match(/^tool of .*$/gm)).toEqual([
      ...Array(4).fill("tool of rec-a"),
      "tool of rec-b",
      "tool of rec-b",
      "tool of nobody",
      "tool of rec-b",
      // after both are packed
      "tool of rec-a",
      "tool of rec-a",
      "tool of rec-b",
      "tool of rec-b",
    ]);
    expect(exitCode).toBe(0);
  });

  test("a version that is on the registry is skipped before its scripts run", async () => {
    using registry = workspaceRegistry();
    registry.known.push("rec-a@1.0.0", "rec-c@1.0.0", "rec-b@0.9.0");
    using dir = workspace(registry.mock);

    const { out, err, exitCode } = await publish(env, String(dir), "-r");
    expect(lines(err)).toEqual(["$ echo prepublishOnly rec-b", POSTPUBLISH]);
    expect(registry.asked).toEqual(["GET rec-a", "GET rec-b", "GET rec-c", "PUT rec-b"]);
    expect(published(out)).toEqual([" + rec-b@1.0.0"]);
    expect(out).toContain("skipped rec-a@1.0.0: already on the registry\n");
    expect(out).toContain("skipped rec-c@1.0.0: already on the registry\n");
    expect(exitCode).toBe(0);
  });

  test("a dependent of a dependency cycle comes after the cycle", async () => {
    using registry = workspaceRegistry();
    using dir = workspace(registry.mock, {
      x: { name: "rec-x", version: "1.0.0", dependencies: { "rec-y": "workspace:*" } },
      y: { name: "rec-y", version: "1.0.0", dependencies: { "rec-x": "workspace:*" } },
      after: { name: "rec-after", version: "1.0.0", dependencies: { "rec-x": "workspace:*" } },
    });

    const { err, exitCode } = await publish(env, String(dir), "-F", "rec-x", "-F", "rec-y", "-F", "rec-after");
    expect(err).toBe("");
    const puts = registry.asked.filter(request => request.startsWith("PUT "));
    expect([...puts].sort()).toEqual(["PUT rec-after", "PUT rec-x", "PUT rec-y"]);
    expect(puts.indexOf("PUT rec-after")).toBeGreaterThan(puts.indexOf("PUT rec-x"));
    expect(exitCode).toBe(0);
  });

  test("a script that fails while packing publishes nothing", async () => {
    using registry = workspaceRegistry();
    // `c` is packed last
    using dir = workspace(registry.mock, { c: { scripts: { prepublishOnly: "exit 3" } } });

    const { out, err, exitCode } = await publish(env, String(dir), "-r");
    expect(lines(err)).toEqual([
      "$ echo prepublishOnly rec-a",
      "$ echo prepublishOnly rec-b",
      "$ exit 3",
      'error: script "prepublishOnly" exited with code 3',
    ]);
    expect(registry.asked).toEqual(["GET rec-a", "GET rec-b", "GET rec-c"]);
    expect(published(out)).toEqual([]);
    expect(exitCode).toBe(3);
  });

  test("a version that is not semver publishes nothing", async () => {
    using registry = workspaceRegistry();
    using dir = workspace(registry.mock, { b: { version: "not-a-version" } });

    const { out, err, exitCode } = await publish(env, String(dir), "-r");
    expect(lines(err)).toEqual([
      "$ echo prepublishOnly rec-a",
      "$ echo prepublishOnly rec-b",
      "error: package.json `version` is not a valid semver version",
    ]);
    expect(registry.asked).toEqual(["GET rec-a"]);
    expect(published(out)).toEqual([]);
    expect(exitCode).toBe(1);
  });

  test('"private": "true" is skipped', async () => {
    using registry = workspaceRegistry();
    using dir = workspace(registry.mock, { a: { private: "true" } });

    const { out, err, exitCode } = await publish(env, String(dir), "-r");
    expect(lines(err)).toEqual([
      "$ echo prepublishOnly rec-b",
      "$ echo prepublishOnly rec-c",
      POSTPUBLISH,
      POSTPUBLISH,
    ]);
    expect(registry.asked).toEqual(["GET rec-b", "GET rec-c", "PUT rec-b", "PUT rec-c"]);
    expect(out).toContain("skipped rec-a: private\n");
    expect(exitCode).toBe(0);
  });

  test("a rejected package ends the run, and the next run continues from there", async () => {
    using registry = workspaceRegistry();
    registry.reject.push("rec-b");
    using dir = workspace(registry.mock);

    let { out, err, exitCode } = await publish(env, String(dir), "-r");
    expect(err).toContain("rec-b is not yours");
    // `c` depends on `b`, so it isn't published either.
    expect(registry.asked).toEqual(["GET rec-a", "GET rec-b", "GET rec-c", "PUT rec-a", "PUT rec-b"]);
    expect(published(out)).toEqual([" + rec-a@1.0.0"]);
    expect(exitCode).toBe(1);

    registry.known.push("rec-a@1.0.0");
    registry.reject.length = 0;
    registry.asked.length = 0;
    ({ out, err, exitCode } = await publish(env, String(dir), "-r"));
    expect(registry.asked).toEqual(["GET rec-a", "GET rec-b", "GET rec-c", "PUT rec-b", "PUT rec-c"]);
    expect(published(out)).toEqual([" + rec-b@1.0.0", " + rec-c@1.0.0"]);
    expect(exitCode).toBe(0);
  });

  test("a package without credentials publishes nothing", async () => {
    using registry = workspaceRegistry();
    const url = `http://localhost:${registry.mock.port}`;
    using dir = workspace(
      registry.mock,
      { scoped: { name: "@rec/scoped", version: "1.0.0" } },
      {
        "bunfig.toml": Bun.TOML.stringify({
          install: { cache: false, registry: { url, token: registryToken }, scopes: { "@rec": { url } } },
        }),
      },
    );

    const { out, err, exitCode } = await publish(env, String(dir), "-r");
    expect(lines(err).at(-1)).toBe("error: missing authentication (run `bunx npm login`)");
    expect(registry.asked.filter(request => !request.startsWith("GET rec-"))).toEqual([]);
    expect(published(out)).toEqual([]);
    expect(exitCode).toBe(1);
  });

  test.each([["-r"], ["--filter", "rec-a"]])("%s with a tarball path is an error", async (...flags) => {
    using registry = workspaceRegistry();
    using dir = workspace(registry.mock);

    const { err, exitCode } = await publish(env, String(dir), ...flags.filter(Boolean), "./some.tgz");
    expect(err).toBe("error: --recursive and --filter cannot be used with a tarball path\n");
    expect(registry.asked).toEqual([]);
    expect(exitCode).toBe(1);
  });

  test.each(["--filter=*", "-F=*", "-F*", "-r", "--recursive", "--filter publish"])(
    "`bun %s publish` publishes nothing",
    async flags => {
      using registry = workspaceRegistry();
      using dir = workspace(registry.mock, { named: { name: "publish", version: "1.0.0" } });

      await using proc = spawn({
        cmd: [bunExe(), ...flags.split(" "), "publish"],
        cwd: String(dir),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const [flag] = flags.split(" ");
      expect(err).toBe(
        `error: refusing to publish: ${flag} must come after "publish"\n` +
          `note: use bun publish ${flag}, or bun run --filter='*' publish to run "publish" scripts\n`,
      );
      expect(published(out)).toEqual([]);
      expect(registry.asked).toEqual([]);
      expect(exitCode).toBe(1);
    },
  );

  test("--filter publishes only the matching packages", async () => {
    using registry = workspaceRegistry();
    using dir = workspace(registry.mock);

    const { out, exitCode } = await publish(env, String(dir), "--filter", "rec-b", "--filter", "./packages/a");
    expect(registry.asked).toEqual(["GET rec-a", "GET rec-b", "PUT rec-a", "PUT rec-b"]);
    expect(published(out)).toEqual([" + rec-a@1.0.0", " + rec-b@1.0.0"]);
    expect(exitCode).toBe(0);
  });

  test("--filter that matches nothing is an error", async () => {
    using registry = workspaceRegistry();
    using dir = workspace(registry.mock);

    const { err, exitCode } = await publish(env, String(dir), "--filter", "does-not-exist");
    expect(err).toContain('No workspace packages matched the filter "does-not-exist"');
    expect(registry.asked).toEqual([]);
    expect(exitCode).toBe(1);
  });

  test("--dry-run publishes nothing", async () => {
    using registry = workspaceRegistry();
    using dir = workspace(registry.mock);

    const { out, exitCode } = await publish(env, String(dir), "-r", "--dry-run");
    expect(registry.asked).toEqual(["GET rec-a", "GET rec-b", "GET rec-c"]);
    expect(published(out)).toEqual([
      " + rec-a@1.0.0 (dry-run)",
      " + rec-b@1.0.0 (dry-run)",
      " + rec-c@1.0.0 (dry-run)",
    ]);
    expect(exitCode).toBe(0);
  });

  // What one package.json pins must not affect the next package: not the tag, not the registry, and no registry gets
  // the other's token.
  test.each([
    {
      what: "registry and tag",
      members: (pinned: string) => ({ a: { publishConfig: { registry: pinned, tag: "next" } } }),
      filters: ["rec-a", "rec-b"],
      first: "rec-a",
      second: "rec-b",
      tag: "next",
    },
    {
      what: "@scope:registry",
      members: (pinned: string) => ({
        one: { name: "@rec/one", version: "1.0.0", publishConfig: { "@rec:registry": pinned } },
        two: { name: "@rec/two", version: "1.0.0" },
      }),
      filters: ["@rec/*"],
      first: "@rec/one",
      second: "@rec/two",
      tag: "latest",
    },
  ])(
    "the publishConfig of one package only applies to that package: $what",
    async ({ members, filters, first, second, tag }) => {
      using configured = workspaceRegistry();
      // https: a `.npmrc` line does not follow a URL that a package.json names into cleartext.
      using pinned = workspaceRegistry(true);
      using dir = workspace(configured.mock, members(`https://localhost:${pinned.mock.port}/`), {
        ".npmrc": `//localhost:${pinned.mock.port}/:_authToken=token-of-pinned\n`,
      });

      const { out, exitCode } = await publish(
        env,
        String(dir),
        "--ca",
        tls.cert,
        ...filters.flatMap(filter => ["--filter", filter]),
      );
      expect(published(out)).toEqual([` + ${first}@1.0.0`, ` + ${second}@1.0.0`]);
      expect(pinned.asked).toEqual([`GET ${first}`, `PUT ${first}`]);
      expect(configured.asked).toEqual([`GET ${second}`, `PUT ${second}`]);
      expect(new Set(pinned.mock.requests.map(request => request.authorization))).toEqual(
        new Set(["Bearer token-of-pinned"]),
      );
      expect(new Set(configured.mock.requests.map(request => request.authorization))).toEqual(
        new Set([`Bearer ${registryToken}`]),
      );
      expect(pinned.manifests[first]["dist-tags"]).toEqual({ [tag]: "1.0.0" });
      expect(configured.manifests[second]["dist-tags"]).toEqual({ latest: "1.0.0" });
      expect(pinned.manifests[first].versions["1.0.0"].dist.tarball).toStartWith(
        `http://localhost:${pinned.mock.port}/`,
      );
      expect(configured.manifests[second].versions["1.0.0"].dist.tarball).toStartWith(
        `http://localhost:${configured.mock.port}/`,
      );
      expect(exitCode).toBe(0);
    },
  );

  test("bin, directories.bin and the README are those of the member", async () => {
    using registry = workspaceRegistry();
    using dir = workspace(
      registry.mock,
      {
        tool: { name: "rec-tool", version: "1.0.0", directories: { bin: "bins" } },
        cli: { name: "rec-cli", version: "1.0.0", bin: "cli.js" },
      },
      {
        // must not leak into a member's manifest
        "bins/root.js": "#!/usr/bin/env bun\n",
        "README.md": "# the root",
        "packages/tool/bins/tool.js": "#!/usr/bin/env bun\n",
        "packages/tool/README.md": "# rec-tool",
        "packages/cli/cli.js": "#!/usr/bin/env bun\n",
      },
    );

    const { err, exitCode } = await publish(env, String(dir), "--filter", "rec-tool", "--filter", "rec-cli");
    expect(err).toBe("");
    expect(registry.manifests["rec-tool"].versions["1.0.0"]).toMatchObject({
      bin: { "tool.js": "bins/tool.js" },
      readme: "# rec-tool",
    });
    expect(registry.manifests["rec-cli"].versions["1.0.0"].bin).toEqual({ "rec-cli": "cli.js" });
    expect(registry.manifests["rec-cli"].versions["1.0.0"].readme).toBeUndefined();
    expect((await attachedTarball(registry.manifests["rec-tool"])).files).toEqual([
      "package/README.md",
      "package/bins/tool.js",
      "package/package.json",
    ]);
    expect(exitCode).toBe(0);
  });

  test("the published packages can be installed", async () => {
    for (const name of ["publish-recursive-a", "publish-recursive-b"]) registry.packages.delete(name);
    using dir = tempDir("publish-recursive-install", {
      "bunfig.toml": registryBunfig,
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
      "packages/a/package.json": JSON.stringify({ name: "publish-recursive-a", version: "1.0.0" }),
      "packages/b/package.json": JSON.stringify({
        name: "publish-recursive-b",
        version: "1.0.0",
        dependencies: { "publish-recursive-a": "workspace:*" },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir), "-r");
    expect(err).toBe("");
    expect(published(out)).toEqual([" + publish-recursive-a@1.0.0", " + publish-recursive-b@1.0.0"]);
    expect(exitCode).toBe(0);

    using consumer = tempDir("publish-recursive-consumer", {
      "bunfig.toml": registryBunfig,
      "package.json": JSON.stringify({ name: "consumer", dependencies: { "publish-recursive-b": "1.0.0" } }),
    });
    await runBunInstall(env, String(consumer));
    expect(await file(join(consumer, "node_modules", "publish-recursive-b", "package.json")).json()).toEqual({
      name: "publish-recursive-b",
      version: "1.0.0",
      dependencies: { "publish-recursive-a": "1.0.0" },
    });
    expect(await exists(join(consumer, "node_modules", "publish-recursive-a", "package.json"))).toBeTrue();
  });

  // rec-a is logged in without ENTER. The login of rec-c lasts until ENTER, pressed there, has opened a page.
  test.skipIf(!isLinux).each([
    ["rec-b is logged in without ENTER too", { authUrl: undefined, enterAt: ["/done/rec-c"] }],
    [
      "ENTER at rec-b, whose page bun cannot open",
      { authUrl: "customapp://b", enterAt: ["/done/rec-b", "/done/rec-c"] },
    ],
  ])("ENTER opens the web login page of the package that is being published: %s", async (_, recB) => {
    using mock = mockRegistry((req, { pathname, otp }, mock) => {
      const url = `http://localhost:${mock.port}`;
      if (req.method === "PUT") {
        if (otp !== null) return new Response("OK");
        return Response.json(
          {
            authUrl: (pathname === "/rec-b" && recB.authUrl) || `${url}/auth${pathname}`,
            doneUrl: `${url}/done${pathname}`,
          },
          { status: 401, headers: { "www-authenticate": "OTP" } },
        );
      }
      if (!pathname.startsWith("/done/")) return new Response("not found", { status: 404 });
      if (recB.enterAt.includes(pathname) && mock.requests.filter(r => r.pathname === pathname).length === 1) {
        proc.stdin.write("\n");
        proc.stdin.flush();
      }
      if (pathname === "/done/rec-c" && opened() === "") {
        return new Response("{}", { status: 202, headers: { "retry-after": "0" } });
      }
      return Response.json({ token: "otp" });
    });
    using dir = workspace(mock, {}, { "opener/xdg-open": `#!/bin/sh\necho "$1" >> "$OPENED"\n` });
    chmodSync(join(dir, "opener", "xdg-open"), 0o755);
    const opened = () => (existsSync(join(dir, "opened")) ? readFileSync(join(dir, "opened"), "utf8") : "");

    await using proc = spawn({
      cmd: [bunExe(), "publish", "-r"],
      cwd: String(dir),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...env, OPENED: join(dir, "opened"), PATH: [join(dir, "opener"), env.PATH ?? ""].join(delimiter) },
    });
    const [out, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(opened()).toBe(`http://localhost:${mock.port}/auth/rec-c\n`);
    expect(published(out)).toEqual([" + rec-a@1.0.0", " + rec-b@1.0.0", " + rec-c@1.0.0"]);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("NODE_TLS_REJECT_UNAUTHORIZED=0", () => {
  const rejectUnauthorizedOff = { ...env, NODE_TLS_REJECT_UNAUTHORIZED: "0" };
  const rejectUnauthorizedOn = { ...env, NODE_TLS_REJECT_UNAUTHORIZED: undefined };

  // The harness certificate is self-signed, so every request to this registry
  // fails verification unless the client has turned it off.
  function selfSignedRegistry(name: string, opts: { otp?: string } = {}) {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      tls,
      fetch(req) {
        const { pathname } = new URL(req.url);
        requests.push(`${req.method} ${pathname}`);
        if (req.method === "PUT") {
          if (opts.otp !== undefined && req.headers.get("npm-otp") !== opts.otp) {
            return Response.json(
              { authUrl: "customapp://login", doneUrl: `https://localhost:${server.port}/-/done` },
              { status: 401, headers: { "www-authenticate": "OTP" } },
            );
          }
          return new Response("OK");
        }
        if (pathname === "/-/done") {
          return Response.json({ token: opts.otp });
        }
        // the --tolerate-republish manifest GET
        return Response.json({ name, versions: { "1.0.0": {} } });
      },
    });
    const dir = tempDir(`publish-self-signed-${name}`, {
      "package.json": JSON.stringify({ name, version: "1.0.0" }),
      "bunfig.toml": Bun.TOML.stringify({
        install: {
          cache: false,
          registry: { url: `https://localhost:${server.port}`, token: "self-signed-token" },
        },
      }),
    });
    return {
      requests,
      packageDir: String(dir),
      [Symbol.dispose]() {
        server.stop(true);
        dir[Symbol.dispose]();
      },
    };
  }

  test("publishes to a registry with a self-signed certificate", async () => {
    using registry = selfSignedRegistry("tls-publish");

    const { out, err, exitCode } = await publish(rejectUnauthorizedOff, registry.packageDir);

    expect(err).not.toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(out).toContain(" + tls-publish@1.0.0");
    expect(registry.requests).toEqual(["PUT /tls-publish"]);
    expect(exitCode).toBe(0);
  });

  test("--tolerate-republish reads the manifest from a registry with a self-signed certificate", async () => {
    using registry = selfSignedRegistry("tls-republish");

    const { err, exitCode } = await publish(rejectUnauthorizedOff, registry.packageDir, "--tolerate-republish");

    expect(err).toBe("warn: Registry already knows about version 1.0.0; skipping.\n");
    expect(registry.requests).toEqual(["GET /tls-republish"]);
    expect(exitCode).toBe(0);
  });

  test("web login polls the done url and retries with the OTP on a registry with a self-signed certificate", async () => {
    using registry = selfSignedRegistry("tls-web-login", { otp: "123456" });

    const { out, err, exitCode } = await publish(rejectUnauthorizedOff, registry.packageDir);

    expect(err).not.toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(out).toContain("Authenticate your account at:");
    expect(out).toContain(" + tls-web-login@1.0.0");
    expect(registry.requests).toEqual(["PUT /tls-web-login", "GET /-/done", "PUT /tls-web-login"]);
    expect(exitCode).toBe(0);
  });

  test("certificate verification stays on when the variable is unset", async () => {
    using registry = selfSignedRegistry("tls-verified");

    const { err, exitCode } = await publish(rejectUnauthorizedOn, registry.packageDir);

    expect(err).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(registry.requests).toEqual([]);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent.each(unprintable)("%s is printed escaped", (_, raw, spelled) => {
  const dryRunEnv = { ...env, npm_config_registry: "http://someuser:hunter2@127.0.0.1:1/" };
  const anyUnprintable = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;

  test.skipIf(isWindows)("in a file name of the directory", async () => {
    using dir = tempDir("publish-file-name", {
      "package.json": JSON.stringify({ name: "publish-file-name", version: "1.0.0" }),
      [`a${raw}b.js`]: "x",
    });
    const { out, err, exitCode } = await publish(dryRunEnv, String(dir), "--dry-run");
    expect(out).toContain(`packed 1B a${spelled}b.js\n`);
    expect(out + err).not.toMatch(anyUnprintable);
    expect(exitCode).toBe(0);
  });

  test("in a tarball", async () => {
    using dir = tempDir("publish-tarball-names", { "package.json": "{}" });
    await Bun.Archive.write(
      join(dir, "it.tgz"),
      {
        "package/package.json": JSON.stringify({
          name: `a${raw}b`,
          version: "1.0.0",
          publishConfig: { tag: `c${raw}d` },
        }),
        [`package/e${raw}f.js`]: "x",
      },
      { compress: "gzip" },
    );
    const { out, err, exitCode } = await publish(dryRunEnv, String(dir), "./it.tgz", "--dry-run");
    expect(out).toContain(`packed 1B e${spelled}f.js\n`);
    expect(out).toContain(`\nTag: c${spelled}d\n`);
    expect(out).toEndWith(`\n + a${spelled}b@1.0.0 (dry-run)\n`);
    expect(out + err).not.toMatch(anyUnprintable);
    expect(exitCode).toBe(0);
  });
});
