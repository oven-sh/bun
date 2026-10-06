// The blocking HTTP path (`AsyncHTTP::send_sync`) sends only http:// and https:// URLs. These commands used to send
// every other URL as plain HTTP, the registry commands with the registry credentials.
// Every run has its own plain HTTP listener. It is also the proxy, so a request that goes out shows up in `requests`.
import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import { copyFile } from "node:fs/promises";
import { basename, join } from "node:path";

const token = "secret-token";

type Setup = {
  cmd: string[];
  // Arguments, files and environment variables can name the port of the listener.
  args?: (port: number) => string[];
  files?: (port: number) => Record<string, string>;
  env?: (port: number) => Record<string, string>;
  // The listener answers 404 with `{}` unless this gives another answer.
  respond?: (req: Request, port: number) => Response;
  // The `name` in package.json.
  name?: string;
};

async function run({ cmd, args, files, env, respond, name = "pkg" }: Setup) {
  const requests: string[] = [];
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      // Through a proxy the request target can be a string that `new URL()` refuses.
      requests.push(`${req.method} ${URL.parse(req.url)?.pathname ?? req.url} ${req.headers.get("authorization")}`);
      return respond?.(req, server.port) ?? new Response("{}", { status: 404 });
    },
  });
  using dir = tempDir("registry-url-scheme", {
    "package.json": JSON.stringify({ name, version: "1.0.0" }),
    ...files?.(server.port),
  });
  await using proc = spawn({
    cmd: [bunExe(), ...cmd, ...(args?.(server.port) ?? [])],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...bunEnv, NO_COLOR: "1", ...env?.(server.port) },
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { port: server.port, stdout, stderr, requests, exitCode };
}

// The error names the registry and the scheme. It has no other text of the URL, so a password in it is not printed.
const refused = (registry: string, problem: string) =>
  `error: Registry URL must be http:// or https://\nnote: the URL for ${registry} ${problem}\n`;
const theDefault = "the default registry";
const startsWith = (scheme: string) => `starts with "${scheme}://"`;
const notHttp = 'does not start with "http://" or "https://"';

const registry = (url: string) => `{ url = "${url}", token = "${token}" }`;
const bunfig = (url: string) => ({ "bunfig.toml": `[install]\nregistry = ${registry(url)}\n` });
const bunfigString = (url: string) => ({ "bunfig.toml": `[install]\nregistry = "${url}"\n` });
const proxy = (port: number) => ({ http_proxy: `http://localhost:${port}`, https_proxy: `http://localhost:${port}` });

describe.concurrent("bun pm view and bun info", () => {
  const view = (setup: Partial<Setup> & { pkg?: string }) =>
    run({ ...setup, cmd: [...(setup.cmd ?? ["pm", "view"]), setup.pkg ?? "left"] });
  const corp = 'the "@corp" registry';

  // [name, setup, the registry the error names, what it says about the URL]
  const refusedCases: [string, Parameters<typeof view>[0], string, string][] = [
    ["bunfig registry", { files: port => bunfig(`htps://localhost:${port}/`) }, theDefault, startsWith("htps")],
    [
      "bunfig registry, bun info",
      { cmd: ["info"], files: port => bunfig(`htps://localhost:${port}/`) },
      theDefault,
      startsWith("htps"),
    ],
    ["bunfig registry with no scheme", { files: port => bunfig(`localhost:${port}/npm/`) }, theDefault, notHttp],
    [
      "bunfig scope",
      {
        pkg: "@corp/left",
        files: port => ({ "bunfig.toml": `[install.scopes]\ncorp = ${registry(`htp://localhost:${port}/`)}\n` }),
      },
      corp,
      startsWith("htp"),
    ],
    [
      ".npmrc registry",
      {
        files: port => ({ ".npmrc": `registry=ftp://localhost:${port}/\n//localhost:${port}/:_authToken=${token}\n` }),
      },
      theDefault,
      startsWith("ftp"),
    ],
    [
      ".npmrc scope",
      {
        pkg: "@corp/left",
        files: port => ({
          ".npmrc": `@corp:registry=htps://localhost:${port}/\n//localhost:${port}/:_authToken=${token}\n`,
        }),
      },
      corp,
      startsWith("htps"),
    ],
    [
      "token from BUN_CONFIG_TOKEN",
      { files: port => bunfigString(`htps://localhost:${port}/`), env: () => ({ BUN_CONFIG_TOKEN: token }) },
      theDefault,
      startsWith("htps"),
    ],
    [
      "--registry",
      { args: port => ["--registry", `htps://user:hunter2@localhost:${port}/?token=hunter2`] },
      "--registry",
      startsWith("htps"),
    ],
    // A scheme with one slash or none is not `<scheme>://`.
    ["--registry https:/", { args: port => ["--registry", `https:/localhost:${port}/`] }, "--registry", notHttp],
    ["--registry http:", { args: port => ["--registry", `http:localhost:${port}/`] }, "--registry", notHttp],
    // The request URL is `https:/left`: no scheme, host `https`. A proxy would receive it as plain HTTP.
    [
      "https:// with no host, behind a proxy",
      { files: () => bunfig("https://"), env: proxy },
      theDefault,
      "has no host",
    ],
    // A variable that is not set stays `$NAME` in the URL. A proxy would receive the request as plain HTTP.
    [
      "url from an unset variable, behind a proxy",
      { files: () => bunfig("$UNSET_REGISTRY_URL"), env: proxy },
      theDefault,
      notHttp,
    ],
    // A password in the URL is not printed, wherever it sits. The proxy would receive what the client dials.
    [
      "userinfo",
      { files: port => bunfig(`htps://user:hun/ter2@localhost:${port}/`), env: proxy },
      theDefault,
      startsWith("htps"),
    ],
    [
      "userinfo, https//",
      { files: port => bunfig(`https//user:hunter2@localhost:${port}/`), env: proxy },
      theDefault,
      notHttp,
    ],
    [
      "userinfo before https://",
      { files: port => bunfig(`user:hunter2@https://localhost:${port}/`), env: proxy },
      theDefault,
      notHttp,
    ],
  ];
  test.each(refusedCases)("is refused before any request: %s", async (_, setup, registry, problem) => {
    const { stdout, stderr, requests, exitCode } = await view(setup);
    expect({ stdout, stderr, requests, exitCode }).toEqual({
      stdout: "",
      stderr: refused(registry, problem),
      requests: [],
      exitCode: 1,
    });
  });

  test("does not stop a registry the request can use", async () => {
    // The listener answers 404, so an accepted URL shows one authenticated request and the registry's answer.
    const accepted: [Parameters<typeof view>[0], path?: string][] = [
      [{ files: port => bunfig(`HTTP://localhost:${port}/`) }],
      [{ files: port => bunfig(`Http://localhost:${port}/`) }],
      [{ files: port => bunfig(`http:/localhost:${port}/`) }],
      [{ files: port => bunfig(`http:localhost:${port}/`) }],
      [{ files: port => bunfigString(`http://localhost:${port}/npm/_authToken=${token}`) }, "/npm/left"],
      // The refused registry belongs to a scope this package is not in.
      [
        {
          files: port => ({
            "bunfig.toml": `[install]\nregistry = ${registry(`http://localhost:${port}/`)}\n[install.scopes]\ncorp = ${registry(`htps://localhost:${port}/`)}\n`,
          }),
        },
      ],
    ];
    const [typo, ...results] = await Promise.all([
      view({ files: port => bunfig(`htps://localhost:${port}/`) }),
      ...accepted.map(([setup]) => view(setup)),
    ]);
    expect(typo.stderr).toBe(refused(theDefault, startsWith("htps")));
    expect(results.map(({ stderr, requests, exitCode }) => ({ stderr, requests, exitCode }))).toEqual(
      results.map(({ port }, i) => {
        const path = accepted[i][1] ?? "/left";
        return {
          stderr: `\n404 Not Found: http://localhost:${port}${path}\n\n - 'left@latest' does not exist in this registry\n`,
          requests: [`GET ${path} Bearer ${token}`],
          exitCode: 1,
        };
      }),
    );
  });
});

describe.concurrent("bun pm whoami", () => {
  const whoami = (files: Setup["files"], cmd = ["pm", "whoami"]) =>
    run({ cmd, files, respond: () => Response.json({ username: "from-registry" }) });

  test.each([
    ["pm whoami", "htps://user:hunter2@localhost:PORT/", startsWith("htps")],
    ["whoami", "htps://localhost:PORT/", startsWith("htps")],
    ["pm whoami", "localhost:PORT/npm/", notHttp],
  ])("bun %s refuses the registry url %s before any request", async (cmd, url, problem) => {
    const { stdout, stderr, requests, exitCode } = await whoami(
      port => bunfig(url.replace("PORT", String(port))),
      cmd.split(" "),
    );
    expect({ stdout, stderr, requests, exitCode }).toEqual({
      stdout: "",
      stderr: refused(theDefault, problem),
      requests: [],
      exitCode: 1,
    });
  });

  test("still answers when it sends no refused request", async () => {
    const [typo, upperCase, localUser] = await Promise.all([
      whoami(port => bunfig(`htps://localhost:${port}/`)),
      whoami(port => bunfig(`HTTP://localhost:${port}/`)),
      // A username in the URL is the answer. No request is needed, so there is nothing to refuse.
      whoami(port => bunfigString(`htps://local-user:hunter2@localhost:${port}/`)),
    ]);
    expect(typo.stderr).toBe(refused(theDefault, startsWith("htps")));
    expect(upperCase).toMatchObject({
      stdout: "from-registry\n",
      stderr: "",
      requests: [`GET /-/whoami Bearer ${token}`],
      exitCode: 0,
    });
    expect(localUser).toMatchObject({ stdout: "local-user\n", stderr: "", requests: [], exitCode: 0 });
  });
});

describe.concurrent("bun publish", () => {
  async function publish(setup: Partial<Setup>) {
    const result = await run({ ...setup, cmd: ["publish"], respond: () => new Response("OK") });
    // The line of the summary that names the registry, or null when the run stops before it.
    return { ...result, shown: result.stdout.match(/^Registry: (.*)$/m)?.[1] ?? null };
  }

  // [name, setup, the registry the error names, what it says about the URL, whether the summary was printed]
  const refusedCases: [string, Partial<Setup>, string, string, boolean][] = [
    ["bunfig registry", { files: port => bunfig(`htps://localhost:${port}/`) }, theDefault, startsWith("htps"), true],
    [
      ".npmrc scope",
      {
        name: "@corp/pkg",
        files: port => ({
          ".npmrc": `@corp:registry=ftp://localhost:${port}/\n//localhost:${port}/:_authToken=${token}\n`,
        }),
      },
      'the "@corp" registry',
      startsWith("ftp"),
      true,
    ],
    [
      "token from BUN_CONFIG_TOKEN, no scheme",
      { files: port => bunfigString(`localhost:${port}/npm/`), env: () => ({ BUN_CONFIG_TOKEN: token }) },
      theDefault,
      notHttp,
      true,
    ],
    // `--tolerate-republish` asks the registry first, also with `--dry-run`.
    [
      "--tolerate-republish --dry-run",
      { files: port => bunfig(`htps://localhost:${port}/`), args: () => ["--tolerate-republish", "--dry-run"] },
      theDefault,
      startsWith("htps"),
      false,
    ],
    // A password in the URL reaches neither the summary nor the error.
    [
      "userinfo",
      { files: port => bunfig(`htps://pubuser:hun/ter2@localhost:${port}/?token=hunter2`) },
      theDefault,
      startsWith("htps"),
      true,
    ],
  ];
  test.each(refusedCases)("is refused before any request: %s", async (_, setup, registry, problem, summary) => {
    const { stdout, stderr, requests, shown, exitCode } = await publish(setup);
    expect(stdout).not.toContain("ter2");
    expect({ stderr, requests, shown, exitCode }).toEqual({
      stderr: refused(registry, problem),
      requests: [],
      shown: summary ? `a URL that ${problem}` : null,
      exitCode: 1,
    });
  });

  test("--registry is refused without printing its password", async () => {
    const { stdout, stderr, requests, exitCode } = await publish({
      env: () => ({ BUN_CONFIG_TOKEN: token }),
      args: port => ["--registry", `htps://pubuser:hunter2@localhost:${port}/`],
    });
    expect(stdout).not.toContain("hunter2");
    expect({ stderr, requests, exitCode }).toEqual({
      stderr: refused("--registry", startsWith("htps")),
      requests: [],
      exitCode: 1,
    });
  });

  test("does not change a publish that sends no refused request", async () => {
    const [typo, upperCase, dryRun, noHostDryRun, noCredentials] = await Promise.all(
      [
        { files: port => bunfig(`htps://localhost:${port}/`) },
        { files: port => bunfig(`HTTP://localhost:${port}/`) },
        { files: port => bunfig(`htps://localhost:${port}/`), args: () => ["--dry-run"] },
        { files: () => bunfig("https://"), args: () => ["--dry-run"] },
        { files: port => bunfigString(`htps://localhost:${port}/`) },
      ].map(publish),
    );
    expect(typo.stderr).toBe(refused(theDefault, startsWith("htps")));
    expect(upperCase).toMatchObject({
      stderr: "",
      requests: [`PUT /pkg Bearer ${token}`],
      shown: `http://localhost:${upperCase.port}/`,
      exitCode: 0,
    });
    // `--dry-run` sends nothing, so it has nothing to refuse. Its summary says the same as the error.
    expect(dryRun).toMatchObject({ stderr: "", requests: [], shown: `a URL that ${startsWith("htps")}`, exitCode: 0 });
    expect(noHostDryRun).toMatchObject({ stderr: "", requests: [], shown: "a URL that has no host", exitCode: 0 });
    expect(noCredentials).toMatchObject({
      stderr: "error: missing authentication (run `bunx npm login`)\n",
      requests: [],
      exitCode: 1,
    });
  });
});

describe.concurrent("bun pm diff", () => {
  // `tarball` is the origin of the `dist.tarball` that the listener's manifest names.
  const diff = (pkg: string, files: Setup["files"], tarball = "http://localhost:PORT/") =>
    run({
      cmd: ["pm", "diff", `${pkg}@1.0.0`, "2.0.0", "--name-only"],
      files,
      respond(_, port) {
        const version = (v: string) => ({
          name: pkg,
          version: v,
          dist: { tarball: `${tarball.replace("PORT", String(port))}${pkg}-${v}.tgz` },
        });
        return Response.json({
          name: pkg,
          "dist-tags": { latest: "2.0.0" },
          versions: { "1.0.0": version("1.0.0"), "2.0.0": version("2.0.0") },
        });
      },
    });

  test.each([
    [
      "registry",
      "diffme",
      "[install]\nregistry = ",
      "htps://user:hunter2@localhost:PORT/",
      theDefault,
      startsWith("htps"),
    ],
    [
      "scoped registry",
      "@corp/diffme",
      "[install.scopes]\ncorp = ",
      "localhost:PORT/npm/",
      'the "@corp" registry',
      notHttp,
    ],
  ])("the %s is refused before any request", async (_, pkg, section, url, name, problem) => {
    const { stdout, stderr, requests, exitCode } = await diff(pkg, port => ({
      "bunfig.toml": `${section}${registry(url.replace("PORT", String(port)))}\n`,
    }));
    expect({ stdout, stderr, requests, exitCode }).toEqual({
      stdout: "",
      stderr: refused(name, problem),
      requests: [],
      exitCode: 1,
    });
  });

  // The registry is fine, so the manifest request goes out with the token. The tarball it names is refused.
  test.each([
    ["ftp://user:hunter2@localhost:PORT/", startsWith("ftp")],
    ["https:/localhost:PORT/", notHttp],
  ])("a dist.tarball at %s is not fetched", async (tarball, problem) => {
    const { stdout, stderr, requests, exitCode } = await diff(
      "diffme",
      port => bunfig(`http://localhost:${port}/`),
      tarball,
    );
    expect({ stdout, stderr, requests, exitCode }).toEqual({
      stdout: "",
      stderr: `error: Tarball URL must be http:// or https://\nnote: the URL for package "diffme" ${problem}\n`,
      requests: [`GET /diffme Bearer ${token}`],
      exitCode: 1,
    });
  });
});

describe.concurrent("bun audit", () => {
  const bulk = "/-/npm/v1/security/advisories/bulk";
  const integrity = "sha512-V8E0l1jyyeSSS9R+J9oljx5eq2rqzClInuwaPcyuv0Mm3ViI/3/rcc4rCEO8i4eQ4I0O0FAGYDA2i5xWHHPhzg==";
  const dependencies = { "@foo/bar": "1.0.0", "left": "1.0.0" };
  const audit = (cmd: string, bunfig: string) =>
    run({
      cmd: cmd.split(" "),
      respond: () => Response.json({}),
      files: port => ({
        "package.json": JSON.stringify({ name: "pkg", version: "1.0.0", dependencies }),
        "bun.lock": JSON.stringify({
          lockfileVersion: 1,
          workspaces: { "": { name: "pkg", dependencies } },
          packages: {
            "@foo/bar": ["@foo/bar@1.0.0", "", {}, integrity],
            "left": ["left@1.0.0", "", {}, integrity],
          },
        }),
        "bunfig.toml": bunfig.replaceAll("PORT", String(port)),
      }),
    });

  test.each([
    ["audit", registry("htps://user:hunter2@localhost:PORT/"), startsWith("htps")],
    ["audit --json", registry("htps://localhost:PORT/"), startsWith("htps")],
    ["audit fix", registry("localhost:PORT/npm/"), notHttp],
    // With no credential the request still carries the dependency list, and its answer is the audit result.
    ["audit", '"htps://localhost:PORT/"', startsWith("htps")],
  ])("bun %s refuses the default registry %s before any request", async (cmd, url, problem) => {
    const { stdout, stderr, requests, exitCode } = await audit(cmd, `[install]\nregistry = ${url}\n`);
    // Neither the password nor an audit result is printed.
    expect(stdout).not.toMatch(/hunter2|vulnerabilit/);
    expect({ stderr, requests, exitCode }).toEqual({
      stderr: refused(theDefault, problem),
      requests: [],
      exitCode: 1,
    });
  });

  // No retry makes the URL http(s), so a scoped registry is not skipped with a warning as for other send errors.
  test.each([
    ["audit", "htps://localhost:PORT/", startsWith("htps")],
    ["audit --json", "htps://localhost:PORT/", startsWith("htps")],
    ["audit --silent", "htps://localhost:PORT/", startsWith("htps")],
    ["audit fix --json", "htps://localhost:PORT/", startsWith("htps")],
    ["audit", "user:hunter2@localhost:PORT/", notHttp],
  ])("bun %s refuses the scoped registry %s", async (cmd, url, problem) => {
    const { stdout, stderr, requests, exitCode } = await audit(
      cmd,
      `[install]\nregistry = "http://localhost:PORT/"\n[install.scopes]\nfoo = ${registry(url)}\n`,
    );
    expect(stdout).not.toMatch(/hunter2|vulnerabilit/);
    expect({ stderr, requests, exitCode }).toEqual({
      stderr: refused('the "@foo" registry', problem),
      // The default registry is asked first. It has no token.
      requests: [`POST ${bulk} null`],
      exitCode: 1,
    });
  });
});

describe("bun upgrade", () => {
  // Every os, arch, abi and cpu, so the release has an archive for the machine that runs the test.
  const assetNames = ["windows", "linux", "darwin"].flatMap(os =>
    ["x64", "aarch64"].flatMap(arch =>
      ["", "-musl"].flatMap(abi => ["", "-baseline"].map(cpu => `bun-${os}-${arch}${abi}${cpu}.zip`)),
    ),
  );

  test("does not fetch a release archive whose URL is not http:// or https://", async () => {
    const requests: string[] = [];
    using plain = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push((URL.parse(req.url)?.pathname ?? req.url).split("/")[1]);
        return new Response("this is not a real zip archive");
      },
    });
    // `bun upgrade` replaces the binary that runs it, so it runs from a copy.
    using dir = tempDir("upgrade-url-scheme", {});
    const execPath = join(String(dir), basename(bunExe()));
    await copyFile(bunExe(), execPath);

    // `id` is the first path segment, so `requests` shows which upgrade fetched the archive.
    const upgrade = async (id: string, scheme: string) => {
      // The release comes from a TLS server. Its archive URL points at the plain listener.
      using releases = Bun.serve({
        tls,
        port: 0,
        fetch: () =>
          Response.json({
            tag_name: "bun-v9.9.6",
            assets: assetNames.map(name => ({
              url: "foo",
              content_type: "application/zip",
              name,
              browser_download_url: `${scheme}localhost:${plain.port}/${id}/${name}`,
            })),
          }),
      });
      await using proc = spawn({
        cmd: [execPath, "upgrade", "--stable"],
        cwd: String(dir),
        stdout: "ignore",
        stdin: "ignore",
        stderr: "pipe",
        env: {
          ...bunEnv,
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
          GITHUB_API_DOMAIN: `${releases.hostname}:${releases.port}`,
          // A failed upgrade exits with buffers it never frees. LeakSanitizer would turn that exit into an abort.
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
        },
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const failure = /Bun upgrade failed with error: (\w+)\r?\n\r?\nPlease upgrade manually:/.exec(stderr);
      return { id, failure: failure?.[1] ?? null, exitCode };
    };

    expect(
      await Promise.all([
        upgrade("ftp", "ftp://"),
        upgrade("htps", "htps://"),
        upgrade("none", ""),
        upgrade("http", "http://"),
      ]),
    ).toEqual([
      { id: "ftp", failure: "UnsupportedProtocol", exitCode: 1 },
      { id: "htps", failure: "UnsupportedProtocol", exitCode: 1 },
      { id: "none", failure: "UnsupportedProtocol", exitCode: 1 },
      // The archive is not a zip file, so this upgrade fails after the download, with another message.
      { id: "http", failure: null, exitCode: 1 },
    ]);
    expect(requests).toEqual(["http"]);
  });
});
