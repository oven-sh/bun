import { beforeEach, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

let package_dir: string;
let env: typeof bunEnv;

beforeEach(() => {
  package_dir = tmpdirSync();
  env = {
    ...bunEnv,
    BUN_INSTALL_CACHE_DIR: join(package_dir, ".bun-cache"),
  };
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
    `
[install]
cache = false
registry = "http://${hostname}:${port}/prefixed-route/"
`,
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

// https://github.com/oven-sh/bun/issues/20593
// npm appends the package name to the configured registry URL as a new path
// segment regardless of whether the URL ends in "/". Previously bun resolved
// the package name as a relative URL against the registry (WHATWG semantics),
// which dropped the last path segment when there was no trailing slash.
for (const [configFile, contents] of [
  [".npmrc", (url: string) => `registry=${url}\n`],
  ["bunfig.toml", (url: string) => `[install]\nregistry = "${url}"\n`],
] as const) {
  test(`registry path without trailing slash is preserved (${configFile})`, async () => {
    const paths: string[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        paths.push(new URL(req.url).pathname);
        return new Response("not found", { status: 404 });
      },
    });
    const { port, hostname } = server;

    await Bun.write(
      join(package_dir, configFile),
      contents(`http://${hostname}:${port}/artifactory/api/npm/npm-stuff`),
    );
    await Bun.write(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "test", version: "0.0.0", dependencies: { react: "1.0.0" } }),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-cache"],
      env,
      cwd: package_dir,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(paths).toEqual(["/artifactory/api/npm/npm-stuff/react"]);
    expect(stderr).toContain("/artifactory/api/npm/npm-stuff/react");
    expect(exitCode).toBe(1);
  });
}

test("registry path without trailing slash is preserved (--registry)", async () => {
  const paths: string[] = [];
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      paths.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });
  const { port, hostname } = server;

  await Bun.write(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "test", version: "0.0.0", dependencies: { react: "1.0.0" } }),
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--no-cache", "--registry", `http://${hostname}:${port}/artifactory/api/npm/npm-stuff`],
    env,
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(paths).toEqual(["/artifactory/api/npm/npm-stuff/react"]);
  expect(exitCode).toBe(1);
});

// https://github.com/oven-sh/bun/issues/20593
// bunfig.toml should take precedence over .npmrc for the default registry.
test("bunfig.toml registry takes precedence over .npmrc registry", async () => {
  const bunfigPaths: string[] = [];
  using bunfigServer = Bun.serve({
    port: 0,
    fetch(req) {
      bunfigPaths.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });
  const npmrcPaths: string[] = [];
  using npmrcServer = Bun.serve({
    port: 0,
    fetch(req) {
      npmrcPaths.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });

  await Bun.write(
    join(package_dir, "bunfig.toml"),
    `[install]\nregistry = "http://${bunfigServer.hostname}:${bunfigServer.port}/from-bunfig/"\n`,
  );
  await Bun.write(
    join(package_dir, ".npmrc"),
    `registry=http://${npmrcServer.hostname}:${npmrcServer.port}/from-npmrc/\n`,
  );
  await Bun.write(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "test", version: "0.0.0", dependencies: { react: "1.0.0" } }),
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--no-cache"],
    env,
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(bunfigPaths).toEqual(["/from-bunfig/react"]);
  expect(npmrcPaths).toEqual([]);
  expect(stderr).toContain("/from-bunfig/react");
  expect(exitCode).toBe(1);
});

test("bunfig.toml scoped registry takes precedence over .npmrc @scope:registry", async () => {
  const bunfigPaths: string[] = [];
  using bunfigServer = Bun.serve({
    port: 0,
    fetch(req) {
      bunfigPaths.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });
  const npmrcPaths: string[] = [];
  using npmrcServer = Bun.serve({
    port: 0,
    fetch(req) {
      npmrcPaths.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });

  await Bun.write(
    join(package_dir, "bunfig.toml"),
    `[install.scopes]\nmyorg = "http://${bunfigServer.hostname}:${bunfigServer.port}/from-bunfig/"\n`,
  );
  await Bun.write(
    join(package_dir, ".npmrc"),
    `@myorg:registry=http://${npmrcServer.hostname}:${npmrcServer.port}/from-npmrc/\n` +
      `@other:registry=http://${npmrcServer.hostname}:${npmrcServer.port}/other-from-npmrc/\n`,
  );
  await Bun.write(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test",
      version: "0.0.0",
      dependencies: { "@myorg/pkg": "1.0.0", "@other/pkg": "1.0.0" },
    }),
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--no-cache"],
    env,
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // @myorg configured in bunfig.toml wins; @other only in .npmrc still applies.
  expect(bunfigPaths).toEqual(["/from-bunfig/@myorg%2fpkg"]);
  expect(npmrcPaths).toEqual(["/other-from-npmrc/@other%2fpkg"]);
  expect(exitCode).toBe(1);
});

test("bunfig.toml registry token takes precedence over .npmrc //host/:_authToken", async () => {
  let auth: string | null = "unset";
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      auth = req.headers.get("authorization");
      return new Response("not found", { status: 404 });
    },
  });

  await Bun.write(
    join(package_dir, "bunfig.toml"),
    `[install]\nregistry = { url = "http://${server.hostname}:${server.port}/", token = "bunfig-token" }\n`,
  );
  await Bun.write(join(package_dir, ".npmrc"), `//${server.hostname}:${server.port}/:_authToken=npmrc-token\n`);
  await Bun.write(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "test", version: "0.0.0", dependencies: { react: "1.0.0" } }),
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--no-cache"],
    env,
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(auth).toBe("Bearer bunfig-token");
  expect(exitCode).toBe(1);
});

test(".npmrc //host/:_authToken still fills in when bunfig.toml sets only the registry url", async () => {
  let auth: string | null = "unset";
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      auth = req.headers.get("authorization");
      return new Response("not found", { status: 404 });
    },
  });

  await Bun.write(
    join(package_dir, "bunfig.toml"),
    `[install]\nregistry = "http://${server.hostname}:${server.port}/"\n`,
  );
  await Bun.write(join(package_dir, ".npmrc"), `//${server.hostname}:${server.port}/:_authToken=npmrc-token\n`);
  await Bun.write(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "test", version: "0.0.0", dependencies: { react: "1.0.0" } }),
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--no-cache"],
    env,
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(auth).toBe("Bearer npmrc-token");
  expect(exitCode).toBe(1);
});

// A `registry=` line in the project .npmrc should still take precedence over
// the user ~/.npmrc when bunfig.toml does not configure a registry.
test("project .npmrc registry takes precedence over user .npmrc", async () => {
  const localPaths: string[] = [];
  using localServer = Bun.serve({
    port: 0,
    fetch(req) {
      localPaths.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });
  const userPaths: string[] = [];
  using userServer = Bun.serve({
    port: 0,
    fetch(req) {
      userPaths.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });

  const fakeHome = join(package_dir, "home");
  await Bun.write(join(fakeHome, ".npmrc"), `registry=http://${userServer.hostname}:${userServer.port}/from-user/\n`);
  await Bun.write(
    join(package_dir, ".npmrc"),
    `registry=http://${localServer.hostname}:${localServer.port}/from-local/\n`,
  );
  await Bun.write(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "test", version: "0.0.0", dependencies: { react: "1.0.0" } }),
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--no-cache"],
    env: { ...env, XDG_CONFIG_HOME: fakeHome, HOME: fakeHome, USERPROFILE: fakeHome },
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(localPaths).toEqual(["/from-local/react"]);
  expect(userPaths).toEqual([]);
  expect(exitCode).toBe(1);
});

// https://github.com/oven-sh/bun/issues/20390
test("bunfig.toml install.cache takes precedence over .npmrc cache", async () => {
  const bunfigCache = join(package_dir, "bunfig-cache");
  const npmrcCache = join(package_dir, "npmrc-cache");

  await Bun.write(join(package_dir, "bunfig.toml"), `[install.cache]\ndir = "${bunfigCache.replaceAll("\\", "/")}"\n`);
  await Bun.write(join(package_dir, ".npmrc"), `cache=${npmrcCache.replaceAll("\\", "/")}\n`);
  await Bun.write(join(package_dir, "package.json"), JSON.stringify({ name: "test", version: "0.0.0" }));

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "cache"],
    env: { ...env, BUN_INSTALL_CACHE_DIR: undefined },
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim().replaceAll("\\", "/")).toBe(bunfigCache.replaceAll("\\", "/"));
  expect(exitCode).toBe(0);
});
