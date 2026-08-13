import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

let package_dir: string;

beforeEach(() => {
  package_dir = tmpdirSync();
});

// https://github.com/oven-sh/bun/issues/2462
test("custom registry doesn't have multiple trailing slashes in pathname", async () => {
  const urls: string[] = [];

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      urls.push(req.url);
      return Response.json({ broken: true, message: "This is a test response" });
    },
  });
  const { port, hostname } = server;
  await Bun.write(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: false,
        registry: `http://${hostname}:${port}/prefixed-route/`,
      },
    }),
  );
  await Bun.write(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test",
      version: "0.0.0",
      dependencies: {
        "react": "my-custom-tag",
      },
    }),
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--force"],
    env: bunEnv,
    cwd: package_dir,
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });

  // The install should fail, but we're just testing the request goes to the right route.
  expect(await proc.exited).toBe(1);

  expect(urls.length).toBe(1);
  expect(urls).toEqual([`http://${hostname}:${port}/prefixed-route/react`]);
});

// https://github.com/oven-sh/bun/issues/5368
// npm appends the package name to the registry URL as a new path segment
// whether or not the URL ends in "/". Bun resolved it as a relative URL, which
// replaced the last segment of a registry path that had no trailing slash.
//
// Every registry below lives on one local server under a distinct path, so the
// paths the server receives show which registry each request was built from.
// Scoped registries let one `bun install` exercise several URL shapes at once;
// each spawn is expensive under ASAN, so the cases are packed rather than split.
describe.concurrent("registry path without trailing slash is preserved", () => {
  function serve() {
    const paths: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        paths.push(new URL(req.url).pathname);
        return new Response("not found", { status: 404 });
      },
    });
    return {
      paths,
      origin: `http://${server.hostname}:${server.port}`,
      [Symbol.dispose]: () => server.stop(true),
    };
  }

  function packageJson(...names: string[]) {
    return JSON.stringify({
      name: "test",
      version: "0.0.0",
      dependencies: Object.fromEntries(names.map(name => [name, "1.0.0"])),
    });
  }

  async function install(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-cache", ...args],
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
      cwd,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stderr, exitCode };
  }

  test(".npmrc registry= and @scope:registry=", async () => {
    using registry = serve();
    using dir = tempDir("no-trailing-slash-npmrc", {
      ".npmrc": `registry=${registry.origin}/r/default\n@scoped:registry=${registry.origin}/r/scoped\n`,
      "package.json": packageJson("react", "@scoped/pkg"),
    });

    const { stderr, exitCode } = await install(String(dir));

    expect(registry.paths.sort()).toEqual(["/r/default/react", "/r/scoped/@scoped%2fpkg"]);
    expect(stderr).toContain("/r/default/react");
    expect(exitCode).toBe(1);
  });

  // The scheme is case-insensitive, the registry directory ends where the path
  // does (a "/" inside the query is not a separator), and any number of
  // trailing slashes collapses to one.
  test("bunfig.toml install.registry and install.scopes, in several URL shapes", async () => {
    using registry = serve();
    const { origin } = registry;
    using dir = tempDir("no-trailing-slash-bunfig", {
      "bunfig.toml": Bun.TOML.stringify({
        install: {
          registry: `${origin}/r/default`,
          scopes: {
            plain: `${origin}/r/plain`,
            upper: `${origin.replace("http://", "HTTP://")}/r/upper`,
            query: `${origin}/r/query?path=a/b`,
            fragment: `${origin}/r/fragment#npm`,
            slashes: `${origin}/r/slashes//`,
          },
        },
      }),
      "package.json": packageJson("react", "@plain/pkg", "@upper/pkg", "@query/pkg", "@fragment/pkg", "@slashes/pkg"),
    });

    const { exitCode } = await install(String(dir));

    expect(registry.paths.sort()).toEqual([
      "/r/default/react",
      "/r/fragment/@fragment%2fpkg",
      "/r/plain/@plain%2fpkg",
      "/r/query/@query%2fpkg",
      "/r/slashes/@slashes%2fpkg",
      "/r/upper/@upper%2fpkg",
    ]);
    expect(exitCode).toBe(1);
  });

  test("--registry", async () => {
    using registry = serve();
    using dir = tempDir("no-trailing-slash-flag", { "package.json": packageJson("react", "@scoped/pkg") });

    const { exitCode } = await install(String(dir), "--registry", `${registry.origin}/r/default`);

    expect(registry.paths.sort()).toEqual(["/r/default/@scoped%2fpkg", "/r/default/react"]);
    expect(exitCode).toBe(1);
  });

  // The manifest URL must stay under the registry path, and that check has to
  // measure against the same slash-terminated base as the join: measured against
  // the URL as written, the directory of ".../r/default" is ".../r/", which is
  // exactly where ".." lands.
  test("dependency name that resolves above the registry path is rejected", async () => {
    using registry = serve();
    const { origin } = registry;
    using dir = tempDir("no-trailing-slash-dotdot", {
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: `${origin}/r/default` } }),
      "package.json": packageJson(".."),
    });

    const { stderr, exitCode } = await install(String(dir));

    expect(registry.paths).toEqual([]);
    expect(stderr).toContain(`manifest URL "${origin}/r/" is not on registry "${origin}/r/default"`);
    expect(exitCode).toBe(1);
  });
});
