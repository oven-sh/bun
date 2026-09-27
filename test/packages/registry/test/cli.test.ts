import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { TestRegistry, toml } from "../test-registry.ts";
import { abbreviatedAccept, jsonHeaders, pack, publishBody, request, type Manifest } from "./helpers.ts";

/** A project that installs from and publishes to the registry, as `user` when one is given. */
function project(registry: TestRegistry, manifest: Record<string, unknown>, user?: string) {
  const token = user === undefined ? undefined : registry.auth.createToken(registry.auth.users.get(user)!).token;
  return tempDir("registry-cli-", {
    "package.json": JSON.stringify(manifest),
    "bunfig.toml": toml({
      install: { cache: false, registry: token === undefined ? registry.url : { url: registry.url, token } },
    }),
  });
}

/** Puts a package into the registry over HTTP, for a test that is about what bun does with it afterwards. */
async function seed(registry: TestRegistry, manifest: Manifest, user: string) {
  const { token } = registry.auth.createToken(registry.auth.users.get(user)!);
  const reply = await request(registry.url + manifest.name.replace("/", "%2f"), {
    method: "PUT",
    headers: jsonHeaders(token),
    body: JSON.stringify(publishBody(manifest, await pack(manifest), { access: "public" })),
  });
  expect(reply.status).toBe(200);
}

async function bun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("bun against the registry", () => {
  test("install", async () => {
    using registry = new TestRegistry({ recordRequests: true }).start();
    using dir = project(registry, {
      name: "app",
      dependencies: { "no-deps": "^1.0.0", "@types/is-number": "1.0.0" },
    });

    const { stderr, exitCode } = await bun(String(dir), "install", "--save-text-lockfile");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(await Bun.file(join(String(dir), "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.1.0",
    });
    const lockfile = await Bun.file(join(String(dir), "bun.lock")).text();
    expect(lockfile).toContain(`"@types/is-number": ["@types/is-number@1.0.0", "`);

    expect(registry.requests.map(({ method, path, status }) => `${status} ${method} ${path}`).sort()).toEqual([
      "200 GET /@types%2fis-number",
      "200 GET /@types/is-number/-/is-number-1.0.0.tgz",
      "200 GET /no-deps",
      "200 GET /no-deps/-/no-deps-1.1.0.tgz",
    ]);
    for (const { path, headers } of registry.requests) {
      if (!path.endsWith(".tgz")) expect(headers.accept).toBe(abbreviatedAccept);
    }
  });

  test("install a restricted package without a user", async () => {
    using registry = new TestRegistry().start();
    using dir = project(registry, { name: "app", dependencies: { "@needs-auth/test-pkg": "1.0.0" } });

    const refused = await bun(String(dir), "install");
    expect(refused.stderr).toContain(`GET ${registry.url}@needs-auth%2ftest-pkg - 404`);
    expect(refused.exitCode).toBe(1);
  });

  test("install a restricted package as a user", async () => {
    using registry = new TestRegistry().start();
    registry.auth.addUser("reader", "secret");
    using dir = project(registry, { name: "app", dependencies: { "@needs-auth/test-pkg": "1.0.0" } }, "reader");

    const installed = await bun(String(dir), "install");
    expect(installed.stderr).not.toContain("error:");
    expect(installed.exitCode).toBe(0);
    expect(
      await Bun.file(join(String(dir), "node_modules", "@needs-auth", "test-pkg", "package.json")).json(),
    ).toMatchObject({ name: "@needs-auth/test-pkg", version: "1.0.0" });
  });

  test("publish", async () => {
    using registry = new TestRegistry().start();
    registry.auth.addUser("author", "secret", { email: "author@example.com" });
    using dir = project(
      registry,
      {
        name: "@author/published",
        version: "1.2.3",
        description: "published by a test",
        dependencies: { "no-deps": "1.0.0" },
        scripts: { postinstall: "echo installed" },
      },
      "author",
    );
    await Bun.write(join(String(dir), "README.md"), "# published\n");

    const published = await bun(String(dir), "publish", "--access", "public", "--tag", "beta");
    expect(published.stderr).not.toContain("error:");
    expect(published.stdout).toContain("+ @author/published@1.2.3");
    expect(published.exitCode).toBe(0);

    const document = (await request(`${registry.url}@author%2fpublished`)).json;
    expect(document["dist-tags"]).toEqual({ beta: "1.2.3", latest: "1.2.3" });
    expect(document.maintainers).toEqual([{ name: "author", email: "author@example.com" }]);
    expect(document.readme).toBe("# published\n");
    expect(document.versions["1.2.3"].dist.tarball).toBe(`${registry.url}@author/published/-/published-1.2.3.tgz`);
    const abbreviated = (
      await request(`${registry.url}@author%2fpublished`, { headers: { accept: abbreviatedAccept } })
    ).json;
    expect(abbreviated.versions["1.2.3"]).toEqual({
      name: "@author/published",
      version: "1.2.3",
      dependencies: { "no-deps": "1.0.0" },
      dist: document.versions["1.2.3"].dist,
      hasInstallScript: true,
    });
  });

  test("publish a version with build metadata", async () => {
    using registry = new TestRegistry().start();
    registry.auth.addUser("author", "secret");
    using dir = project(registry, { name: "built-by-bun", version: "1.0.0+build.5" }, "author");

    const published = await bun(String(dir), "publish");
    expect(published.stderr).not.toContain("error:");
    expect(published.exitCode).toBe(0);

    const document = (await request(`${registry.url}built-by-bun`)).json;
    expect(Object.keys(document.versions)).toEqual(["1.0.0"]);
    expect(document["dist-tags"]).toEqual({ latest: "1.0.0" });
  });

  test("pm view", async () => {
    using registry = new TestRegistry().start();
    registry.auth.addUser("author", "secret", { email: "author@example.com" });
    await seed(registry, { name: "viewed", version: "1.2.3", description: "seen by a test" }, "author");
    using dir = project(registry, { name: "app" });

    const view = await bun(String(dir), "pm", "view", "viewed", "--json");
    expect(view.stderr).not.toContain("error:");
    expect(JSON.parse(view.stdout)).toMatchObject({
      name: "viewed",
      version: "1.2.3",
      description: "seen by a test",
      dist: { tarball: `${registry.url}viewed/-/viewed-1.2.3.tgz` },
      maintainers: [{ name: "author", email: "author@example.com" }],
      versions: ["1.2.3"],
    });
    expect(view.exitCode).toBe(0);
  });

  test("install what was published", async () => {
    using registry = new TestRegistry().start();
    registry.auth.addUser("author", "secret");
    const manifest = { name: "@author/installed", version: "1.2.3", dependencies: { "no-deps": "1.0.0" } };
    await seed(registry, manifest, "author");
    await seed(registry, { ...manifest, version: "2.0.0-rc.1" }, "author");

    using consumer = project(registry, { name: "app", dependencies: { "@author/installed": "^1.0.0" } });
    const installed = await bun(String(consumer), "install");
    expect(installed.stderr).not.toContain("error:");
    expect(installed.exitCode).toBe(0);
    const modules = join(String(consumer), "node_modules");
    expect(await Bun.file(join(modules, "@author", "installed", "package.json")).json()).toEqual(manifest);
    expect(await Bun.file(join(modules, "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
  });

  test("publish a version that is there", async () => {
    using registry = new TestRegistry().start();
    registry.auth.addUser("author", "secret");
    const manifest = { name: "published-twice", version: "1.2.3" };
    await seed(registry, manifest, "author");
    using dir = project(registry, manifest, "author");

    const again = await bun(String(dir), "publish");
    expect(again.stderr).toContain("403 Forbidden");
    expect(again.stderr).toContain("You cannot publish over the previously published versions: 1.2.3.");
    expect(again.exitCode).toBe(1);
  });

  test("publish --tolerate-republish of a version that is there", async () => {
    using registry = new TestRegistry().start();
    registry.auth.addUser("author", "secret");
    const manifest = { name: "tolerated", version: "1.2.3" };
    await seed(registry, manifest, "author");
    using dir = project(registry, manifest, "author");

    const tolerated = await bun(String(dir), "publish", "--tolerate-republish");
    expect(tolerated.stderr).toBe("warn: Registry already knows about version 1.2.3; skipping.\n");
    expect(tolerated.exitCode).toBe(0);
  });

  test("whoami", async () => {
    using registry = new TestRegistry({ notice: "This registry is for tests." }).start();
    registry.auth.addUser("somebody", "secret");
    using dir = project(registry, { name: "app" }, "somebody");

    const known = await bun(String(dir), "pm", "whoami");
    expect(known.stdout).toBe("somebody\n");
    expect(known.stderr).toContain("This registry is for tests.");
    expect(known.exitCode).toBe(0);
  });

  test("whoami with a token that the registry does not know", async () => {
    using registry = new TestRegistry().start();
    using dir = tempDir("registry-cli-", {
      "package.json": JSON.stringify({ name: "app" }),
      "bunfig.toml": toml({
        install: { cache: false, registry: { url: registry.url, token: "npm_notATokenHere" } },
      }),
    });

    const unknown = await bun(String(dir), "pm", "whoami");
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr).toBe(`\n401 Unauthorized: ${registry.url}-/whoami\n`);
    expect(unknown.exitCode).toBe(1);
  });

  test("publish with --otp", async () => {
    using registry = new TestRegistry().start();
    registry.auth.addUser("careful", "secret", { tfa: "auth-and-writes", otp: ["246810"] });
    using dir = project(registry, { name: "with-otp", version: "1.0.0" }, "careful");

    const right = await bun(String(dir), "publish", "--otp", "246810");
    expect(right.stderr).not.toContain("error:");
    expect(right.stdout).toContain("+ with-otp@1.0.0");
    expect(right.exitCode).toBe(0);
    expect(await registry.packages.has("with-otp")).toBe(true);
  });

  test("publish with an --otp that is wrong", async () => {
    using registry = new TestRegistry().start();
    registry.auth.addUser("careful", "secret", { tfa: "auth-and-writes", otp: ["246810"] });
    using dir = project(registry, { name: "with-wrong-otp", version: "1.0.0" }, "careful");

    // bun asks for another code when the registry refuses the one it sent. Nobody is there to type it.
    const wrong = await bun(String(dir), "publish", "--otp", "000000");
    expect(wrong.stderr).toContain("failed to read OTP input");
    expect(wrong.exitCode).toBe(1);
    expect(await registry.packages.has("with-wrong-otp")).toBe(false);
  });

  test("publish waits for the user to approve in the browser", async () => {
    const opened = Promise.withResolvers<string>();
    using registry = new TestRegistry({
      intercept(request, registry) {
        // The first poll of doneUrl tells the test that bun has the session.
        const url = new URL(request.url);
        if (url.pathname !== "/-/v1/done") return;
        const id = url.searchParams.get("authId")!;
        if (registry.auth.sessions.get(id)?.result === null) opened.resolve(id);
      },
    }).start();
    registry.auth.addUser("browser", "secret", { tfa: "auth-and-writes" });
    using dir = project(registry, { name: "with-web-auth", version: "1.0.0" }, "browser");

    const publishing = bun(String(dir), "publish", "--auth-type", "web");
    const exitedEarly = publishing.then(({ stderr, exitCode }) => {
      throw new Error(`bun publish exited with code ${exitCode} before it asked for the session:\n${stderr}`);
    });
    registry.auth.approveSession(await Promise.race([opened.promise, exitedEarly]));
    const { stdout, stderr, exitCode } = await publishing;
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain(`${registry.url}auth/cli/`);
    expect(stdout).toContain("+ with-web-auth@1.0.0");
    expect(exitCode).toBe(0);
    expect(await registry.packages.has("with-web-auth")).toBe(true);
  });

  test("audit reports an advisory", async () => {
    using registry = new TestRegistry().start();
    registry.advisories.add("no-deps", { vulnerable_versions: "<1.1.0", severity: "high", title: "no-deps is unsafe" });
    using dir = project(registry, { name: "app", dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.1" } });
    expect((await bun(String(dir), "install")).exitCode).toBe(0);

    const { stdout, exitCode } = await bun(String(dir), "audit");
    expect(stdout).toContain("no-deps@1.0.0\n");
    expect(stdout).toContain("high: no-deps is unsafe (<1.1.0) - https://github.com/advisories/GHSA-1000000");
    expect(stdout).toContain("1 vulnerability (1 high)");
    expect(exitCode).toBe(1);
  });
});

describe("cli.ts", () => {
  test("serves a directory", async () => {
    using registry = new TestRegistry();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "..", "cli.ts"),
        "--port=0",
        `--storage=${registry.packagesPath}`,
        "--user=someone:secret",
        "--restricted=@needs-auth/*",
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    let output = "";
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      output += decoder.decode(chunk, { stream: true });
      if (/^registry: .+\n/m.test(output)) break;
    }
    const token = output.match(/^token for someone: (npm_[0-9A-Za-z]{36})$/m)![1];
    const url = output.match(/^registry: (http:\/\/localhost:\d+\/)$/m)![1];

    expect((await request(`${url}no-deps`)).status).toBe(200);
    expect((await request(`${url}@needs-auth%2ftest-pkg`)).status).toBe(404);
    const authorized = await request(`${url}@needs-auth%2ftest-pkg`, { headers: { authorization: `Bearer ${token}` } });
    expect(authorized.status).toBe(200);
  });
});
