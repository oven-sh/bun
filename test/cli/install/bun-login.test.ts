import { describe, expect, test } from "bun:test";
import { lstatSync, readFileSync, statSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// A registry that speaks npm's web login protocol:
//   POST /-/v1/login            -> { loginUrl, doneUrl }
//   GET  /-/v1/done/<id>        -> 202 until `pending` polls passed, then { token }
//   GET  /-/whoami              -> { username } for the issued token
//   DELETE /-/user/token/<tok>  -> `deleteStatus`
function mockRegistry(
  opts: {
    token?: string;
    loginStatus?: number;
    deleteStatus?: number;
    whoamiStatus?: number;
    pending?: number;
    doneOrigin?: string;
  } = {},
) {
  const { token = "npm_test_token", loginStatus = 200, deleteStatus = 200, whoamiStatus = 200, pending = 2 } = opts;
  const requests: { method: string; path: string; authorization: string | null; host: string | null; body: string }[] =
    [];
  let polls = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      requests.push({
        method: req.method,
        path: url.pathname,
        authorization: req.headers.get("authorization"),
        host: req.headers.get("host"),
        body: await req.text(),
      });

      if (req.method === "POST" && url.pathname === "/-/v1/login") {
        if (loginStatus !== 200) return new Response("", { status: loginStatus });
        return Response.json({
          loginUrl: `${server.url.href}login/abc`,
          doneUrl: `${opts.doneOrigin ?? server.url.href}-/v1/done/abc`,
        });
      }
      if (url.pathname === "/-/v1/done/abc") {
        polls++;
        if (polls <= pending) return new Response(null, { status: 202, headers: { "retry-after": "0" } });
        return Response.json({ token });
      }
      if (url.pathname === "/-/whoami") {
        if (whoamiStatus !== 200) return new Response("", { status: whoamiStatus });
        if (req.headers.get("authorization") === `Bearer ${token}`) return Response.json({ username: "alice" });
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/-/user/token/")) {
        return new Response(null, { status: deleteStatus });
      }
      return new Response("unexpected url", { status: 500 });
    },
  });
  return { server, requests, url: server.url.href };
}

// bunEnv spreads process.env. CI runners commonly export XDG_CONFIG_HOME, so it is
// removed here and each test passes back exactly the value it is testing.
async function runBun(dir: string, args: string[], envOverride: Record<string, string> = {}) {
  const spawnEnv: Record<string, string | undefined> = {
    ...bunEnv,
    HOME: join(dir, "home"),
    USERPROFILE: join(dir, "home"),
  };
  delete spawnEnv.XDG_CONFIG_HOME;

  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: join(dir, "pkg"),
    env: { ...spawnEnv, ...envOverride },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const pkg = { "pkg/package.json": JSON.stringify({ name: "login-test", version: "0.0.1" }) };
const readNpmrc = (dir: string, rel = "home/.npmrc") => readFileSync(join(dir, rel), "utf8");

describe("bun login", () => {
  test.concurrent("web login writes the token to $HOME/.npmrc and keeps the other lines", async () => {
    using registry = mockRegistry({ token: "tok-home" }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-home", {
      ...pkg,
      "home/.npmrc": `# keep me\nregistry=${registry.url.href}\n\n@other:registry=https://other.example/\n`,
    });

    const result = await runBun(String(dir), ["login"]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Authenticate your account at (press ENTER to open in browser):");
    expect(result.stdout).toContain(`${registry.url.href}login/abc`);
    expect(result.stdout).toContain(`Saved the token to ${join(String(dir), "home", ".npmrc")}`);
    expect(result.stdout).toContain(`Logged in as alice on ${registry.url.href}`);
    expect(result.stdout).not.toContain("tok-home");
    expect(result.exitCode).toBe(0);

    expect(readNpmrc(String(dir))).toBe(
      `# keep me\nregistry=${registry.url.href}\n\n@other:registry=https://other.example/\n//${host}/:_authToken=tok-home\n`,
    );
    if (!isWindows) {
      expect(statSync(join(String(dir), "home", ".npmrc")).mode & 0o777).toBe(0o600);
    }

    // the token bun login wrote is the token bun reads back
    const whoami = await runBun(String(dir), ["pm", "whoami"]);
    expect(whoami.stdout).toBe("alice\n");
    expect(whoami.exitCode).toBe(0);
  });

  test.concurrent("quotes a token the ini reader would otherwise cut at ; or #", async () => {
    using registry = mockRegistry({ token: "ab#c;d=e" }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-quoted", { ...pkg, "home/.npmrc": `registry=${registry.url.href}\n` });

    const result = await runBun(String(dir), ["login"]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Logged in as alice");
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe(`registry=${registry.url.href}\n//${host}/:_authToken="ab#c;d=e"\n`);

    // the reader gets the whole token back
    const whoami = await runBun(String(dir), ["pm", "whoami"]);
    expect(whoami.stdout).toBe("alice\n");

    const logout = await runBun(String(dir), ["logout"]);
    expect(logout.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe(`registry=${registry.url.href}\n`);
  });

  test.concurrent("inserts the token before an ini [section], where the reader looks for it", async () => {
    using registry = mockRegistry({ token: "tok-root" }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-section", {
      ...pkg,
      "home/.npmrc": `registry=${registry.url.href}\n[other]\n//${host}/:_authToken=not-root\n`,
    });

    const result = await runBun(String(dir), ["login"]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe(
      `registry=${registry.url.href}\n//${host}/:_authToken=tok-root\n[other]\n//${host}/:_authToken=not-root\n`,
    );

    const whoami = await runBun(String(dir), ["pm", "whoami"]);
    expect(whoami.stdout).toBe("alice\n");
  });

  test.concurrent("replaces an existing token line for the same registry in place", async () => {
    using registry = mockRegistry({ token: "tok-new" }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-replace", {
      ...pkg,
      "home/.npmrc": `//${host}/:_authToken=tok-old\nregistry=${registry.url.href}\n`,
    });

    const result = await runBun(String(dir), ["login"]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe(`//${host}/:_authToken=tok-new\nregistry=${registry.url.href}\n`);
  });

  test.concurrent("with duplicate token lines, updates the last one (the one the reader uses)", async () => {
    using registry = mockRegistry({ token: "tok-new" }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-duplicates", {
      ...pkg,
      "home/.npmrc": `//${host}/:_authToken=tok-first\n//${host}/:_authToken=tok-last\n`,
    });

    const result = await runBun(String(dir), ["login", "--registry", registry.url.href]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe(`//${host}/:_authToken=tok-first\n//${host}/:_authToken=tok-new\n`);
  });

  test.concurrent("writes to $XDG_CONFIG_HOME/.npmrc when that file exists", async () => {
    using registry = mockRegistry({ token: "tok-xdg" }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-xdg", {
      ...pkg,
      "home/.npmrc": "# home\n",
      "xdg/.npmrc": "# xdg\n",
    });

    const result = await runBun(String(dir), ["login", "--registry", registry.url.href], {
      XDG_CONFIG_HOME: join(String(dir), "xdg"),
    });
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Saved the token to ${join(String(dir), "xdg", ".npmrc")}`);
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir), "xdg/.npmrc")).toBe(`# xdg\n//${host}/:_authToken=tok-xdg\n`);
    expect(readNpmrc(String(dir), "home/.npmrc")).toBe("# home\n");
  });

  test.concurrent("creates $HOME/.npmrc when it does not exist", async () => {
    using registry = mockRegistry({ token: "tok-fresh" }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-fresh", { ...pkg, "home/.keep": "" });

    const result = await runBun(String(dir), ["login", "--registry", registry.url.href]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe(`//${host}/:_authToken=tok-fresh\n`);
  });

  test.concurrent("--scope also writes the @scope:registry line", async () => {
    using registry = mockRegistry({ token: "tok-scope" }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-scope", { ...pkg, "home/.npmrc": "" });

    const result = await runBun(String(dir), ["login", "--registry", registry.url.href, "--scope", "@acme"]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe(`//${host}/:_authToken=tok-scope\n@acme:registry=${registry.url.href}\n`);
  });

  test.concurrent("--scope without --registry logs in to the registry configured for that scope", async () => {
    const { server: registry } = mockRegistry({ token: "tok-scoped" });
    using _registry = registry;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-scope-configured", {
      ...pkg,
      "home/.npmrc": `@acme:registry=${registry.url.href}\n`,
    });

    const result = await runBun(String(dir), ["login", "--scope", "@acme"]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Logged in as alice on ${registry.url.href}`);
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe(`@acme:registry=${registry.url.href}\n//${host}/:_authToken=tok-scoped\n`);
  });

  test.concurrent("sends the hostname and no credentials to /-/v1/login", async () => {
    const { server: registry, requests } = mockRegistry();
    using _registry = registry;
    using dir = tempDir("login-request", { ...pkg, "home/.npmrc": "" });

    const result = await runBun(String(dir), ["login", "--registry", registry.url.href]);
    expect(result.exitCode).toBe(0);

    const login = requests.find(r => r.path === "/-/v1/login");
    expect(login).toEqual({
      method: "POST",
      path: "/-/v1/login",
      authorization: null,
      host: new URL(registry.url).host,
      body: expect.stringMatching(/^\{"hostname":".+"\}$/),
    });
    expect(requests.filter(r => r.path === "/-/v1/done/abc").map(r => r.authorization)).toEqual([null, null, null]);
  });

  test.concurrent("polls a doneUrl on another host with that host's Host header", async () => {
    const done = mockRegistry({ token: "tok-cross" });
    using _done = done.server;
    using registry = mockRegistry({ token: "tok-cross", doneOrigin: done.url }).server;
    using dir = tempDir("login-cross-done", { ...pkg, "home/.npmrc": "" });

    const result = await runBun(String(dir), ["login", "--registry", registry.url.href]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const polls = done.requests.filter(r => r.path === "/-/v1/done/abc");
    expect(polls.length).toBeGreaterThan(0);
    expect(new Set(polls.map(r => r.host))).toEqual(new Set([new URL(done.url).host]));
  });

  test.concurrent("still reports success when the registry has no /-/whoami", async () => {
    using registry = mockRegistry({ token: "tok-nowhoami", whoamiStatus: 404 }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-no-whoami", { ...pkg, "home/.npmrc": "" });

    const result = await runBun(String(dir), ["login", "--registry", registry.url.href]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Saved the token to");
    expect(result.stdout).toContain(`Logged in on ${registry.url.href}`);
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe(`//${host}/:_authToken=tok-nowhoami\n`);
  });

  test.skipIf(isWindows).concurrent("follows a dangling .npmrc symlink and creates its target", async () => {
    using registry = mockRegistry({ token: "tok-dangling" }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-dangling", { ...pkg, "dotfiles/.keep": "", "home/.keep": "" });
    symlinkSync(join(String(dir), "dotfiles", "npmrc"), join(String(dir), "home", ".npmrc"));

    const result = await runBun(String(dir), ["login", "--registry", registry.url.href]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(lstatSync(join(String(dir), "home", ".npmrc")).isSymbolicLink()).toBe(true);
    expect(readNpmrc(String(dir), "dotfiles/npmrc")).toBe(`//${host}/:_authToken=tok-dangling\n`);
  });

  test.skipIf(isWindows).concurrent("follows a chain of dangling symlinks to the final target", async () => {
    using registry = mockRegistry({ token: "tok-chain" }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-chain", { ...pkg, "dotfiles/.keep": "", "home/.keep": "" });
    symlinkSync(join(String(dir), "dotfiles", "npmrc"), join(String(dir), "home", ".npmrc"));
    symlinkSync(join(String(dir), "dotfiles", "real-npmrc"), join(String(dir), "dotfiles", "npmrc"));

    const result = await runBun(String(dir), ["login", "--registry", registry.url.href]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(lstatSync(join(String(dir), "home", ".npmrc")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(String(dir), "dotfiles", "npmrc")).isSymbolicLink()).toBe(true);
    expect(readNpmrc(String(dir), "dotfiles/real-npmrc")).toBe(`//${host}/:_authToken=tok-chain\n`);
  });

  test.skipIf(isWindows).concurrent("refuses to write through a symlink loop", async () => {
    using registry = mockRegistry({ token: "tok-loop" }).server;
    using dir = tempDir("login-loop", { ...pkg, "home/.keep": "" });
    symlinkSync(join(String(dir), "home", ".npmrc"), join(String(dir), "home", ".npmrc"));

    const result = await runBun(String(dir), ["login", "--registry", registry.url.href]);
    expect(result.stderr).toContain("ELOOP");
    expect(result.exitCode).toBe(1);
    expect(lstatSync(join(String(dir), "home", ".npmrc")).isSymbolicLink()).toBe(true);
  });

  test.skipIf(isWindows).concurrent("writes through a symlinked .npmrc instead of replacing the link", async () => {
    using registry = mockRegistry({ token: "tok-link" }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("login-symlink", { ...pkg, "dotfiles/npmrc": "# managed\n", "home/.keep": "" });
    symlinkSync(join(String(dir), "dotfiles", "npmrc"), join(String(dir), "home", ".npmrc"));

    const result = await runBun(String(dir), ["login", "--registry", registry.url.href]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(lstatSync(join(String(dir), "home", ".npmrc")).isSymbolicLink()).toBe(true);
    expect(readNpmrc(String(dir), "dotfiles/npmrc")).toBe(`# managed\n//${host}/:_authToken=tok-link\n`);
  });

  test.concurrent.each([404, 401, 500])(
    "a registry without web login (HTTP %i) fails and names the line to add by hand",
    async status => {
      using registry = mockRegistry({ loginStatus: status }).server;
      const host = new URL(registry.url).host;
      using dir = tempDir("login-unsupported", { ...pkg, "home/.npmrc": "# untouched\n" });

      const result = await runBun(String(dir), ["login", "--registry", registry.url.href]);
      expect(result.stderr).toContain(
        `${registry.url.href} did not offer a web login (HTTP ${status} from /-/v1/login)`,
      );
      expect(result.stderr).toContain(`//${host}/:_authToken=<token>`);
      expect(result.exitCode).toBe(1);
      expect(readNpmrc(String(dir))).toBe("# untouched\n");
    },
  );

  test.concurrent("rejects positional arguments and a scope without @", async () => {
    using dir = tempDir("login-args", { ...pkg, "home/.npmrc": "" });

    const extra = await runBun(String(dir), ["login", "somebody"]);
    expect(extra.stderr).toContain("bun login does not take arguments");
    expect(extra.exitCode).toBe(1);

    const badScope = await runBun(String(dir), ["login", "--scope", "acme"]);
    expect(badScope.stderr).toContain("invalid `--scope` value");
    expect(badScope.exitCode).toBe(1);
  });
});

describe("bun logout", () => {
  test.concurrent("revokes the token and removes only its line", async () => {
    const { server: registry, requests } = mockRegistry();
    using _registry = registry;
    const host = new URL(registry.url).host;
    using dir = tempDir("logout-ok", {
      ...pkg,
      "home/.npmrc": `# keep me\nregistry=${registry.url.href}\n//${host}/:_authToken=tok-gone\n@other:registry=https://other.example/\n`,
    });

    const result = await runBun(String(dir), ["logout"]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Logged out of ${registry.url.href}`);
    expect(result.stdout).not.toContain("tok-gone");
    expect(result.exitCode).toBe(0);

    expect(requests).toEqual([
      { method: "DELETE", path: "/-/user/token/tok-gone", authorization: "Bearer tok-gone", host, body: "" },
    ]);
    expect(readNpmrc(String(dir))).toBe(
      `# keep me\nregistry=${registry.url.href}\n@other:registry=https://other.example/\n`,
    );
  });

  test.concurrent("--scope also removes the @scope:registry line", async () => {
    using registry = mockRegistry().server;
    const host = new URL(registry.url).host;
    using dir = tempDir("logout-scope", {
      ...pkg,
      "home/.npmrc": `@acme:registry=${registry.url.href}\n//${host}/:_authToken=tok-scope\n`,
    });

    const result = await runBun(String(dir), ["logout", "--scope", "@acme"]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe("");
  });

  test.concurrent("warns before sending the token over plain http to a remote host", async () => {
    using registry = mockRegistry().server;
    // 0.0.0.0 reaches the mock on every platform but is not in the loopback allow-list
    const remote = `http://0.0.0.0:${registry.port}/`;
    using dir = tempDir("logout-http-warn", {
      ...pkg,
      "home/.npmrc": `//0.0.0.0:${registry.port}/:_authToken=tok\n`,
    });

    const result = await runBun(String(dir), ["logout", "--registry", remote]);
    expect(result.stderr).toContain(`warn: ${remote} uses plain http`);
  });

  test.concurrent("fails when there is no token for the registry", async () => {
    using registry = mockRegistry().server;
    using dir = tempDir("logout-none", { ...pkg, "home/.npmrc": "# nothing here\n" });

    const result = await runBun(String(dir), ["logout", "--registry", registry.url.href]);
    expect(result.stderr).toContain(`not logged in to ${registry.url.href}`);
    expect(result.exitCode).toBe(1);
    expect(readNpmrc(String(dir))).toBe("# nothing here\n");
  });

  test.concurrent("points at the other source when the token does not come from the user .npmrc", async () => {
    using registry = mockRegistry().server;
    const host = new URL(registry.url).host;
    using dir = tempDir("logout-elsewhere", {
      ...pkg,
      "home/.npmrc": "",
      "pkg/.npmrc": `registry=${registry.url.href}\n//${host}/:_authToken=project-token\n`,
    });

    const result = await runBun(String(dir), ["logout"]);
    expect(result.stderr).toContain(`not logged in to ${registry.url.href}`);
    expect(result.stderr).toContain("come from bunfig.toml, a project .npmrc, or an environment variable");
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("leaves the file alone when the registry refuses to revoke the token", async () => {
    using registry = mockRegistry({ deleteStatus: 500 }).server;
    const host = new URL(registry.url).host;
    const npmrc = `//${host}/:_authToken=tok-stuck\n`;
    using dir = tempDir("logout-fail", { ...pkg, "home/.npmrc": npmrc });

    const result = await runBun(String(dir), ["logout", "--registry", registry.url.href]);
    expect(result.stderr).toContain(`failed to revoke the token on ${registry.url.href} (HTTP 500)`);
    expect(result.stderr).not.toContain("tok-stuck");
    expect(result.exitCode).toBe(1);
    expect(readNpmrc(String(dir))).toBe(npmrc);
  });

  test.concurrent.each([401, 404])("still removes a token the registry no longer accepts (HTTP %i)", async status => {
    using registry = mockRegistry({ deleteStatus: status }).server;
    const host = new URL(registry.url).host;
    using dir = tempDir("logout-expired", { ...pkg, "home/.npmrc": `//${host}/:_authToken=tok-expired\n` });

    const result = await runBun(String(dir), ["logout", "--registry", registry.url.href]);
    expect(result.stderr).toContain(`the token is already invalid (HTTP ${status})`);
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe("");
  });

  test.concurrent("revokes the last of duplicate token lines and removes all of them", async () => {
    const { server: registry, requests } = mockRegistry();
    using _registry = registry;
    const host = new URL(registry.url).host;
    using dir = tempDir("logout-duplicates", {
      ...pkg,
      "home/.npmrc": `//${host}/:_authToken=tok-stale\nregistry=${registry.url.href}\n//${host}/:_authToken=tok-live\n`,
    });

    const result = await runBun(String(dir), ["logout"]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(requests.map(r => r.path)).toEqual(["/-/user/token/tok-live"]);
    expect(readNpmrc(String(dir))).toBe(`registry=${registry.url.href}\n`);
  });

  test.concurrent.each([
    ['"AKCp5abc=="', "AKCp5abc=="],
    ['"a\\"b\\\\c\\u0041"', 'a"b\\cA'],
    ["'single=quoted'", "single=quoted"],
  ])("reads a token npm wrote in quotes (%s)", async (written, expected) => {
    const { server: registry, requests } = mockRegistry();
    using _registry = registry;
    const host = new URL(registry.url).host;
    using dir = tempDir("logout-quoted", { ...pkg, "home/.npmrc": `//${host}/:_authToken=${written}\n` });

    const result = await runBun(String(dir), ["logout", "--registry", registry.url.href]);
    expect(result.exitCode).toBe(0);
    expect(requests.map(r => r.authorization)).toEqual([`Bearer ${expected}`]);
    expect(readNpmrc(String(dir))).toBe("");
  });

  test.concurrent("sends the token as one percent-encoded path segment", async () => {
    const { server: registry, requests } = mockRegistry();
    using _registry = registry;
    const host = new URL(registry.url).host;
    using dir = tempDir("logout-encode", { ...pkg, "home/.npmrc": `//${host}/:_authToken=a/b?c#d%e f\n` });

    const result = await runBun(String(dir), ["logout", "--registry", registry.url.href]);
    expect(result.exitCode).toBe(0);
    expect(requests.map(r => r.path)).toEqual(["/-/user/token/a%2Fb%3Fc%23d%25e%20f"]);
    expect(readNpmrc(String(dir))).toBe("");
  });

  test.concurrent("expands ${VAR} in the saved token before revoking it", async () => {
    const { server: registry, requests } = mockRegistry();
    using _registry = registry;
    const host = new URL(registry.url).host;
    using dir = tempDir("logout-env", { ...pkg, "home/.npmrc": `//${host}/:_authToken=pre-\${LOGIN_TEST_TOKEN}\n` });

    const result = await runBun(String(dir), ["logout", "--registry", registry.url.href], {
      LOGIN_TEST_TOKEN: "from-env",
    });
    expect(result.exitCode).toBe(0);
    expect(requests.map(r => r.authorization)).toEqual(["Bearer pre-from-env"]);
    expect(readNpmrc(String(dir))).toBe("");
  });

  test.concurrent("--scope removes a scope mapping whose ${VAR} expands to this registry", async () => {
    using registry = mockRegistry().server;
    const host = new URL(registry.url).host;
    using dir = tempDir("logout-scope-env", {
      ...pkg,
      "home/.npmrc": `@acme:registry=\${LOGIN_TEST_REGISTRY}\n//${host}/:_authToken=tok-scope\n`,
    });

    const result = await runBun(String(dir), ["logout", "--registry", registry.url.href, "--scope", "@acme"], {
      LOGIN_TEST_REGISTRY: registry.url.href,
    });
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe("");
  });

  test.concurrent("--scope keeps a scope mapping that points at another registry", async () => {
    using registry = mockRegistry().server;
    const host = new URL(registry.url).host;
    using dir = tempDir("logout-scope-other", {
      ...pkg,
      "home/.npmrc": `@acme:registry=https://other.example/\n//${host}/:_authToken=tok-scope\n`,
    });

    const result = await runBun(String(dir), ["logout", "--registry", registry.url.href, "--scope", "@acme"]);
    expect(result.exitCode).toBe(0);
    expect(readNpmrc(String(dir))).toBe("@acme:registry=https://other.example/\n");
  });
});
