import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
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
describe.concurrent("registry path without trailing slash is preserved", () => {
  const registryPath = "/artifactory/api/npm/npm-stuff";
  const expectedPaths = [`${registryPath}/@scope%2fpkg`, `${registryPath}/react`];

  async function install(configure: (dir: string, registry: string) => Promise<string[]>) {
    const paths: string[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        paths.push(new URL(req.url).pathname);
        return new Response("not found", { status: 404 });
      },
    });
    const dir = tmpdirSync();
    const args = await configure(dir, `http://${server.hostname}:${server.port}${registryPath}`);
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ name: "test", version: "0.0.0", dependencies: { "react": "1.0.0", "@scope/pkg": "1.0.0" } }),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-cache", ...args],
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") },
      cwd: dir,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { paths: paths.sort(), stderr, exitCode };
  }

  test(".npmrc registry=", async () => {
    const { paths, stderr, exitCode } = await install(async (dir, registry) => {
      await Bun.write(join(dir, ".npmrc"), `registry=${registry}\n`);
      return [];
    });
    expect(paths).toEqual(expectedPaths);
    expect(stderr).toContain(`${registryPath}/react`);
    expect(exitCode).toBe(1);
  });

  test("bunfig.toml install.registry", async () => {
    const { paths, exitCode } = await install(async (dir, registry) => {
      await Bun.write(join(dir, "bunfig.toml"), Bun.TOML.stringify({ install: { registry } }));
      return [];
    });
    expect(paths).toEqual(expectedPaths);
    expect(exitCode).toBe(1);
  });

  test("bunfig.toml install.scopes", async () => {
    const { paths, exitCode } = await install(async (dir, registry) => {
      await Bun.write(
        join(dir, "bunfig.toml"),
        Bun.TOML.stringify({ install: { registry, scopes: { scope: registry } } }),
      );
      return [];
    });
    expect(paths).toEqual(expectedPaths);
    expect(exitCode).toBe(1);
  });

  test("--registry", async () => {
    const { paths, exitCode } = await install(async (_dir, registry) => ["--registry", registry]);
    expect(paths).toEqual(expectedPaths);
    expect(exitCode).toBe(1);
  });
});
