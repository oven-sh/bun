import { file, listen, Socket, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv as env } from "harness";
import { access, mkdir, readlink, rm, writeFile } from "fs/promises";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  readdirSorted,
  requested,
  root_url,
  setHandler,
} from "./dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(dummyBeforeEach);
afterEach(dummyAfterEach);

it("should report connection errors", async () => {
  function end(socket: Socket) {
    socket.end();
  }
  const server = listen({
    socket: {
      data: end,
      drain: end,
      open: end,
    },
    hostname: "localhost",
    port: 0,
  });
  await writeFile(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
registry = "http://localhost:${server.port}/"
`,
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "0.0.2",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain("error: ConnectionClosed downloading package manifest bar");
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(await exited).toBe(1);
  try {
    await access(join(package_dir, "bun.lockb"));
    expect(() => {}).toThrow();
  } catch (err: any) {
    expect(err.code).toBe("ENOENT");
  }
});

it("should handle missing package", async () => {
  const urls: string[] = [];
  setHandler(async request => {
    expect(request.method).toBe("GET");
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    expect(request.headers.get("npm-auth-type")).toBe(null);
    expect(await request.text()).toBe("");
    urls.push(request.url);
    return new Response("bar", { status: 404 });
  });
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "foo"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain('error: package "foo" not found localhost/foo 404');
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(await exited).toBe(1);
  expect(urls.sort()).toEqual([`${root_url}/foo`]);
  expect(requested).toBe(1);
  try {
    await access(join(package_dir, "bun.lockb"));
    expect(() => {}).toThrow();
  } catch (err: any) {
    expect(err.code).toBe("ENOENT");
  }
});

it("should handle @scoped authentication", async () => {
  let seen_token = false;
  const url = `${root_url}/@foo/bar`;
  const urls: string[] = [];
  setHandler(async request => {
    expect(request.method).toBe("GET");
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    if (request.url === url) {
      expect(request.headers.get("authorization")).toBe("Bearer bar");
      expect(request.headers.get("npm-auth-type")).toBe("legacy");
      seen_token = true;
    } else {
      expect(request.headers.get("npm-auth-type")).toBe(null);
    }
    expect(await request.text()).toBe("");
    urls.push(request.url);
    return new Response("Feeling lucky?", { status: 555 });
  });
  // workaround against `writeFile(..., { flag: "a" })`
  await writeFile(
    join(package_dir, "bunfig.toml"),
    `${await file(join(package_dir, "bunfig.toml")).text()}
[install.scopes]
foo = { token = "bar" }
`,
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "@foo/bar"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain(`GET ${url} - 555`);
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(await exited).toBe(1);
  expect(urls.sort()).toEqual([url]);
  expect(seen_token).toBe(true);
  expect(requested).toBe(1);
  try {
    await access(join(package_dir, "bun.lockb"));
    expect(() => {}).toThrow();
  } catch (err: any) {
    expect(err.code).toBe("ENOENT");
  }
});

it("should handle empty string in dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle workspaces", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      workspaces: ["bar", "packages/*"],
    }),
  );
  await mkdir(join(package_dir, "bar"));
  await writeFile(
    join(package_dir, "bar", "package.json"),
    JSON.stringify({
      name: "Bar",
      version: "0.0.2",
    }),
  );

  await mkdir(join(package_dir, "packages", "nominally-scoped"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "nominally-scoped", "package.json"),
    JSON.stringify({
      name: "@org/nominally-scoped",
      version: "0.1.4",
    }),
  );

  await mkdir(join(package_dir, "packages", "second-asterisk"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "second-asterisk", "package.json"),
    JSON.stringify({
      name: "AsteriskTheSecond",
      version: "0.1.4",
    }),
  );

  await mkdir(join(package_dir, "packages", "asterisk"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "asterisk", "package.json"),
    JSON.stringify({
      name: "Asterisk",
      version: "0.0.4",
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + @org/nominally-scoped@workspace:packages/nominally-scoped",
    " + Asterisk@workspace:packages/asterisk",
    " + AsteriskTheSecond@workspace:packages/second-asterisk",
    " + Bar@workspace:bar",
    "",
    " 4 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "@org",
    "Asterisk",
    "AsteriskTheSecond",
    "Bar",
  ]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(join("..", "bar"));
  expect(await readlink(join(package_dir, "node_modules", "Asterisk"))).toBe(join("..", "packages", "asterisk"));
  expect(await readlink(join(package_dir, "node_modules", "AsteriskTheSecond"))).toBe(
    join("..", "packages", "second-asterisk"),
  );
  expect(await readlink(join(package_dir, "node_modules", "@org", "nominally-scoped"))).toBe(
    join("..", "..", "packages", "nominally-scoped"),
  );
  await access(join(package_dir, "bun.lockb"));
});

it("should handle workspaces with packages array", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      workspaces: { packages: ["bar"] },
    }),
  );
  await mkdir(join(package_dir, "bar"));
  await writeFile(
    join(package_dir, "bar", "package.json"),
    JSON.stringify({
      name: "Bar",
      version: "0.0.2",
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");

  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();

  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Bar@workspace:bar",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "Bar"]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(join("..", "bar"));
  await access(join(package_dir, "bun.lockb"));
});

it("should handle inter-dependency between workspaces", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      workspaces: ["bar", "packages/baz"],
    }),
  );
  await mkdir(join(package_dir, "bar"));
  await writeFile(
    join(package_dir, "bar", "package.json"),
    JSON.stringify({
      name: "Bar",
      version: "0.0.2",
      dependencies: {
        Baz: "0.0.3",
      },
    }),
  );
  await mkdir(join(package_dir, "packages", "baz"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "baz", "package.json"),
    JSON.stringify({
      name: "Baz",
      version: "0.0.3",
      dependencies: {
        Bar: "0.0.2",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Bar@workspace:bar",
    " + Baz@workspace:packages/baz",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "Bar", "Baz"]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(join("..", "bar"));
  expect(await readlink(join(package_dir, "node_modules", "Baz"))).toBe(join("..", "packages", "baz"));
  await access(join(package_dir, "bun.lockb"));
});

it("should handle inter-dependency between workspaces (devDependencies)", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      workspaces: ["bar", "packages/baz"],
    }),
  );
  await mkdir(join(package_dir, "bar"));
  await writeFile(
    join(package_dir, "bar", "package.json"),
    JSON.stringify({
      name: "Bar",
      version: "0.0.2",
      devDependencies: {
        Baz: "0.0.3",
      },
    }),
  );
  await mkdir(join(package_dir, "packages", "baz"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "baz", "package.json"),
    JSON.stringify({
      name: "Baz",
      version: "0.0.3",
      devDependencies: {
        Bar: "0.0.2",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Bar@workspace:bar",
    " + Baz@workspace:packages/baz",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "Bar", "Baz"]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(join("..", "bar"));
  expect(await readlink(join(package_dir, "node_modules", "Baz"))).toBe(join("..", "packages", "baz"));
  await access(join(package_dir, "bun.lockb"));
});

it("should handle inter-dependency between workspaces (optionalDependencies)", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      workspaces: ["bar", "packages/baz"],
    }),
  );
  await mkdir(join(package_dir, "bar"));
  await writeFile(
    join(package_dir, "bar", "package.json"),
    JSON.stringify({
      name: "Bar",
      version: "0.0.2",
      optionalDependencies: {
        Baz: "0.0.3",
      },
    }),
  );
  await mkdir(join(package_dir, "packages", "baz"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "baz", "package.json"),
    JSON.stringify({
      name: "Baz",
      version: "0.0.3",
      optionalDependencies: {
        Bar: "0.0.2",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Bar@workspace:bar",
    " + Baz@workspace:packages/baz",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "Bar", "Baz"]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(join("..", "bar"));
  expect(await readlink(join(package_dir, "node_modules", "Baz"))).toBe(join("..", "packages", "baz"));
  await access(join(package_dir, "bun.lockb"));
});

it("should ignore peerDependencies within workspaces", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      workspaces: ["packages/baz"],
      peerDependencies: {
        Bar: ">=0.0.2",
      },
    }),
  );
  await mkdir(join(package_dir, "packages", "baz"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "baz", "package.json"),
    JSON.stringify({
      name: "Baz",
      version: "0.0.3",
      peerDependencies: {
        Moo: ">=0.0.4",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Baz@workspace:packages/baz",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "Baz"]);
  expect(await readlink(join(package_dir, "node_modules", "Baz"))).toBe(join("..", "packages", "baz"));
  await access(join(package_dir, "bun.lockb"));
});

it("should handle life-cycle scripts within workspaces", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      scripts: {
        install: [bunExe(), "index.js"].join(" "),
      },
      workspaces: ["bar"],
    }),
  );
  await writeFile(join(package_dir, "index.js"), 'console.log("[scripts:run] Foo");');
  await mkdir(join(package_dir, "bar"));
  await writeFile(
    join(package_dir, "bar", "package.json"),
    JSON.stringify({
      name: "Bar",
      version: "0.0.2",
      scripts: {
        preinstall: [bunExe(), "index.js"].join(" "),
      },
    }),
  );
  await writeFile(join(package_dir, "bar", "index.js"), 'console.log("[scripts:run] Bar");');
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "[scripts:run] Bar",
    " + Bar@workspace:bar",
    "[scripts:run] Foo",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "Bar"]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(join("..", "bar"));
  await access(join(package_dir, "bun.lockb"));
});

it("should ignore workspaces within workspaces", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      workspaces: ["bar"],
    }),
  );
  await mkdir(join(package_dir, "bar"));
  await writeFile(
    join(package_dir, "bar", "package.json"),
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
      workspaces: ["baz"],
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@workspace:bar",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar"]);
  expect(await readlink(join(package_dir, "node_modules", "bar"))).toBe(join("..", "bar"));
  await access(join(package_dir, "bun.lockb"));
});

it("should handle ^0 in dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "^0",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle ^1 in dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "^1",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain('error: No version matching "^1" found for specifier "bar" (but package exists)');
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(await exited).toBe(1);
  expect(urls.sort()).toEqual([`${root_url}/bar`]);
  expect(requested).toBe(1);
  try {
    await access(join(package_dir, "bun.lockb"));
    expect(() => {}).toThrow();
  } catch (err: any) {
    expect(err.code).toBe("ENOENT");
  }
});

it("should handle ^0.0 in dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "^0.0",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle ^0.1 in dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "^0.1",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain('error: No version matching "^0.1" found for specifier "bar" (but package exists)');
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(await exited).toBe(1);
  expect(urls.sort()).toEqual([`${root_url}/bar`]);
  expect(requested).toBe(1);
  try {
    await access(join(package_dir, "bun.lockb"));
    expect(() => {}).toThrow();
  } catch (err: any) {
    expect(err.code).toBe("ENOENT");
  }
});

it("should handle ^0.0.0 in dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "^0.0.0",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain('error: No version matching "^0.0.0" found for specifier "bar" (but package exists)');
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(await exited).toBe(1);
  expect(urls.sort()).toEqual([`${root_url}/bar`]);
  expect(requested).toBe(1);
  try {
    await access(join(package_dir, "bun.lockb"));
    expect(() => {}).toThrow();
  } catch (err: any) {
    expect(err.code).toBe("ENOENT");
  }
});

it("should handle ^0.0.2 in dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "^0.0.2",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle ^0.0.2-rc in dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.2-rc": { as: "0.0.2" } }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "^0.0.2-rc",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2-rc",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle ^0.0.2-alpha.3+b4d in dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.2-alpha.3": { as: "0.0.2" } }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "^0.0.2-alpha.3+b4d",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2-alpha.3",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should prefer latest-tagged dependency", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
      "0.0.5": {
        bin: {
          "baz-exec": "index.js",
        },
      },
      latest: "0.0.3",
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        baz: "~0.0.2",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + baz@0.0.3",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle dependency aliasing", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        Bar: "npm:baz",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Bar@0.0.3",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "Bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "Bar", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "Bar"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle dependency aliasing (versioned)", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        Bar: "npm:baz@0.0.3",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Bar@0.0.3",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "Bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "Bar", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "Bar"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle dependency aliasing (dist-tagged)", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        Bar: "npm:baz@latest",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Bar@0.0.3",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "Bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "Bar", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "Bar"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should not reinstall aliased dependencies", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        Bar: "npm:baz",
      },
    }),
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).toContain("Saved lockfile");
  expect(stdout1).toBeDefined();
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Bar@0.0.3",
    "",
    " 1 packages installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "Bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "Bar", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "Bar"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
  // Performs `bun install` again, expects no-op
  urls.length = 0;
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("Saved lockfile");
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "Checked 1 installs across 2 packages (no changes)",
  ]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "Bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "Bar", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "Bar"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle aliased & direct dependency references", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        baz: "~0.0.2",
      },
      workspaces: ["bar"],
    }),
  );
  await mkdir(join(package_dir, "bar"));
  await writeFile(
    join(package_dir, "bar", "package.json"),
    JSON.stringify({
      name: "bar",
      version: "0.0.4",
      dependencies: {
        moo: "npm:baz",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@workspace:bar",
    " + baz@0.0.3",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readlink(join(package_dir, "node_modules", "bar"))).toBe(join("..", "bar"));
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  expect(await readdirSorted(join(package_dir, "bar"))).toEqual(["node_modules", "package.json"]);
  expect(await readdirSorted(join(package_dir, "bar", "node_modules"))).toEqual(["moo"]);
  expect(await readdirSorted(join(package_dir, "bar", "node_modules", "moo"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "bar", "node_modules", "moo", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should not hoist if name collides with alias", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.2": {},
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "npm:baz",
      },
      workspaces: ["moo"],
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.0.4",
      dependencies: {
        bar: "0.0.2",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + moo@workspace:moo",
    " + bar@0.0.3",
    "",
    " 3 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/bar`,
    `${root_url}/bar-0.0.2.tgz`,
    `${root_url}/baz`,
    `${root_url}/baz-0.0.3.tgz`,
  ]);
  expect(requested).toBe(4);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar", "moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "bar", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  expect(await readlink(join(package_dir, "node_modules", "moo"))).toBe(join("..", "moo"));
  expect(await readdirSorted(join(package_dir, "moo"))).toEqual(["node_modules", "package.json"]);
  expect(await readdirSorted(join(package_dir, "moo", "node_modules"))).toEqual(["bar"]);
  expect(await readdirSorted(join(package_dir, "moo", "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "moo", "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle unscoped alias on scoped dependency", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.1.0": {} }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "@barn/moo": "latest",
        moo: "npm:@barn/moo",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + @barn/moo@0.1.0",
    " + moo@0.1.0",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/@barn/moo`, `${root_url}/@barn/moo-0.1.0.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "@barn", "moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toEqual({
    name: "@barn/moo",
    version: "0.1.0",
    // not installed as these are absent from manifest above
    dependencies: {
      bar: "0.0.2",
      baz: "latest",
    },
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "moo"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "moo", "package.json")).json()).toEqual({
    name: "@barn/moo",
    version: "0.1.0",
    dependencies: {
      bar: "0.0.2",
      baz: "latest",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle scoped alias on unscoped dependency", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "@baz/bar": "npm:bar",
        bar: "latest",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + @baz/bar@0.0.2",
    " + bar@0.0.2",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "@baz", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@baz"))).toEqual(["bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@baz", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "@baz", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle aliased dependency with existing lockfile", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.2": {},
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
      "0.1.0": {
        dependencies: {
          bar: "0.0.2",
          baz: "latest",
        },
      },
      latest: "0.0.3",
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "moz": "npm:@barn/moo@0.1.0",
      },
    }),
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).toContain("Saved lockfile");
  expect(stdout1).toBeDefined();
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + moz@0.1.0",
    "",
    " 3 packages installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/@barn/moo`,
    `${root_url}/@barn/moo-0.1.0.tgz`,
    `${root_url}/bar`,
    `${root_url}/bar-0.0.2.tgz`,
    `${root_url}/baz`,
    `${root_url}/baz-0.0.3.tgz`,
  ]);
  expect(requested).toBe(6);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar", "baz", "moz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "moz"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "moz", "package.json")).json()).toEqual({
    name: "@barn/moo",
    version: "0.1.0",
    dependencies: {
      bar: "0.0.2",
      baz: "latest",
    },
  });
  await access(join(package_dir, "bun.lockb"));
  // Perform `bun install` again but with lockfile from before
  await rm(join(package_dir, "node_modules"), { force: true, recursive: true });
  urls.length = 0;
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("Saved lockfile");
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + moz@0.1.0",
    "",
    " 3 packages installed",
  ]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/@barn/moo-0.1.0.tgz`,
    `${root_url}/bar-0.0.2.tgz`,
    `${root_url}/baz-0.0.3.tgz`,
  ]);
  expect(requested).toBe(9);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar", "baz", "moz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "moz"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "moz", "package.json")).json()).toEqual({
    name: "@barn/moo",
    version: "0.1.0",
    dependencies: {
      bar: "0.0.2",
      baz: "latest",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle GitHub URL in dependencies (user/repo)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        uglify: "mishoo/UglifyJS",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  let out = await new Response(stdout).text();
  out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
  out = out.replace(/(github:[^#]+)#[a-f0-9]+/, "$1");
  expect(out.split(/\r?\n/)).toEqual([" + uglify@github:mishoo/UglifyJS", "", " 1 packages installed"]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["uglifyjs"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "uglify"))).toEqual([
    ".bun-tag",
    ".gitattributes",
    ".github",
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "bin",
    "lib",
    "package.json",
    "test",
    "tools",
  ]);
  const package_json = await file(join(package_dir, "node_modules", "uglify", "package.json")).json();
  expect(package_json.name).toBe("uglify-js");
  await access(join(package_dir, "bun.lockb"));
});

it("should handle GitHub URL in dependencies (user/repo#commit-id)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        uglify: "mishoo/UglifyJS#e219a9a",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + uglify@github:mishoo/UglifyJS#e219a9a",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["uglifyjs"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual([
    "@GH@mishoo-UglifyJS-e219a9a",
    "uglify",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache", "uglify"))).toEqual([
    "mishoo-UglifyJS-e219a9a",
  ]);
  expect(await readlink(join(package_dir, "node_modules", ".cache", "uglify", "mishoo-UglifyJS-e219a9a"))).toBe(
    join(package_dir, "node_modules", ".cache", "@GH@mishoo-UglifyJS-e219a9a"),
  );
  expect(await readdirSorted(join(package_dir, "node_modules", "uglify"))).toEqual([
    ".bun-tag",
    ".gitattributes",
    ".github",
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "bin",
    "lib",
    "package.json",
    "test",
    "tools",
  ]);
  const package_json = await file(join(package_dir, "node_modules", "uglify", "package.json")).json();
  expect(package_json.name).toBe("uglify-js");
  expect(package_json.version).toBe("3.14.1");
  await access(join(package_dir, "bun.lockb"));
});

it("should handle GitHub URL in dependencies (user/repo#tag)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        uglify: "mishoo/UglifyJS#v3.14.1",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + uglify@github:mishoo/UglifyJS#e219a9a",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["uglifyjs"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual([
    "@GH@mishoo-UglifyJS-e219a9a",
    "uglify",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache", "uglify"))).toEqual([
    "mishoo-UglifyJS-e219a9a",
  ]);
  expect(await readlink(join(package_dir, "node_modules", ".cache", "uglify", "mishoo-UglifyJS-e219a9a"))).toBe(
    join(package_dir, "node_modules", ".cache", "@GH@mishoo-UglifyJS-e219a9a"),
  );
  expect(await readdirSorted(join(package_dir, "node_modules", "uglify"))).toEqual([
    ".bun-tag",
    ".gitattributes",
    ".github",
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "bin",
    "lib",
    "package.json",
    "test",
    "tools",
  ]);
  const package_json = await file(join(package_dir, "node_modules", "uglify", "package.json")).json();
  expect(package_json.name).toBe("uglify-js");
  expect(package_json.version).toBe("3.14.1");
  await access(join(package_dir, "bun.lockb"));
});

it("should handle GitHub URL in dependencies (github:user/repo#tag)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        uglify: "github:mishoo/UglifyJS#v3.14.1",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + uglify@github:mishoo/UglifyJS#e219a9a",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["uglifyjs"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "uglifyjs"))).toBe(
    join("..", "uglify", "bin", "uglifyjs"),
  );
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual([
    "@GH@mishoo-UglifyJS-e219a9a",
    "uglify",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache", "uglify"))).toEqual([
    "mishoo-UglifyJS-e219a9a",
  ]);
  expect(await readlink(join(package_dir, "node_modules", ".cache", "uglify", "mishoo-UglifyJS-e219a9a"))).toBe(
    join(package_dir, "node_modules", ".cache", "@GH@mishoo-UglifyJS-e219a9a"),
  );
  expect(await readdirSorted(join(package_dir, "node_modules", "uglify"))).toEqual([
    ".bun-tag",
    ".gitattributes",
    ".github",
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "bin",
    "lib",
    "package.json",
    "test",
    "tools",
  ]);
  const package_json = await file(join(package_dir, "node_modules", "uglify", "package.json")).json();
  expect(package_json.name).toBe("uglify-js");
  expect(package_json.version).toBe("3.14.1");
  await access(join(package_dir, "bun.lockb"));
});

it("should handle GitHub URL in dependencies (https://github.com/user/repo.git)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        uglify: "https://github.com/mishoo/UglifyJS.git",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  let out = await new Response(stdout).text();
  out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
  out = out.replace(/(github:[^#]+)#[a-f0-9]+/, "$1");
  expect(out.split(/\r?\n/)).toEqual([" + uglify@github:mishoo/UglifyJS", "", " 1 packages installed"]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["uglifyjs"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "uglify"))).toEqual([
    ".bun-tag",
    ".gitattributes",
    ".github",
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "bin",
    "lib",
    "package.json",
    "test",
    "tools",
  ]);
  const package_json = await file(join(package_dir, "node_modules", "uglify", "package.json")).json();
  expect(package_json.name).toBe("uglify-js");
  await access(join(package_dir, "bun.lockb"));
});

it("should handle GitHub URL in dependencies (git://github.com/user/repo.git#commit)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        uglify: "git://github.com/mishoo/UglifyJS.git#e219a9a",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + uglify@github:mishoo/UglifyJS#e219a9a",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["uglifyjs"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "uglifyjs"))).toBe(
    join("..", "uglify", "bin", "uglifyjs"),
  );
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual([
    "@GH@mishoo-UglifyJS-e219a9a",
    "uglify",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache", "uglify"))).toEqual([
    "mishoo-UglifyJS-e219a9a",
  ]);
  expect(await readlink(join(package_dir, "node_modules", ".cache", "uglify", "mishoo-UglifyJS-e219a9a"))).toBe(
    join(package_dir, "node_modules", ".cache", "@GH@mishoo-UglifyJS-e219a9a"),
  );
  expect(await readdirSorted(join(package_dir, "node_modules", "uglify"))).toEqual([
    ".bun-tag",
    ".gitattributes",
    ".github",
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "bin",
    "lib",
    "package.json",
    "test",
    "tools",
  ]);
  const package_json = await file(join(package_dir, "node_modules", "uglify", "package.json")).json();
  expect(package_json.name).toBe("uglify-js");
  expect(package_json.version).toBe("3.14.1");
  await access(join(package_dir, "bun.lockb"));
});

it("should handle GitHub URL in dependencies (git+https://github.com/user/repo.git)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        uglify: "git+https://github.com/mishoo/UglifyJS.git",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  let out = await new Response(stdout).text();
  out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
  out = out.replace(/(github:[^#]+)#[a-f0-9]+/, "$1");
  expect(out.split(/\r?\n/)).toEqual([" + uglify@github:mishoo/UglifyJS", "", " 1 packages installed"]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["uglifyjs"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "uglify"))).toEqual([
    ".bun-tag",
    ".gitattributes",
    ".github",
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "bin",
    "lib",
    "package.json",
    "test",
    "tools",
  ]);
  const package_json = await file(join(package_dir, "node_modules", "uglify", "package.json")).json();
  expect(package_json.name).toBe("uglify-js");
  await access(join(package_dir, "bun.lockb"));
});

it("should handle GitHub URL with existing lockfile", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
`,
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "html-minifier": "kangax/html-minifier#v4.0.0",
      },
    }),
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).toContain("Saved lockfile");
  expect(stdout1).toBeDefined();
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + html-minifier@github:kangax/html-minifier#4beb325",
    "",
    " 12 packages installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bin",
    ".cache",
    "camel-case",
    "clean-css",
    "commander",
    "he",
    "html-minifier",
    "lower-case",
    "no-case",
    "param-case",
    "relateurl",
    "source-map",
    "uglify-js",
    "upper-case",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["he", "html-minifier", "uglifyjs"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "he"))).toBe(join("..", "he", "bin", "he"));
  expect(await readlink(join(package_dir, "node_modules", ".bin", "html-minifier"))).toBe(
    join("..", "html-minifier", "cli.js"),
  );
  expect(await readlink(join(package_dir, "node_modules", ".bin", "uglifyjs"))).toBe(
    join("..", "uglify-js", "bin", "uglifyjs"),
  );
  await access(join(package_dir, "bun.lockb"));
  // Perform `bun install` again but with lockfile from before
  await rm(join(package_dir, "node_modules"), { force: true, recursive: true });
  urls.length = 0;
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("Saved lockfile");
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + html-minifier@github:kangax/html-minifier#4beb325",
    "",
    " 12 packages installed",
  ]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bin",
    ".cache",
    "camel-case",
    "clean-css",
    "commander",
    "he",
    "html-minifier",
    "lower-case",
    "no-case",
    "param-case",
    "relateurl",
    "source-map",
    "uglify-js",
    "upper-case",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["he", "html-minifier", "uglifyjs"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "he"))).toBe(join("..", "he", "bin", "he"));
  expect(await readlink(join(package_dir, "node_modules", ".bin", "html-minifier"))).toBe(
    join("..", "html-minifier", "cli.js"),
  );
  expect(await readlink(join(package_dir, "node_modules", ".bin", "uglifyjs"))).toBe(
    join("..", "uglify-js", "bin", "uglifyjs"),
  );
  await access(join(package_dir, "bun.lockb"));
});

it("should consider peerDependencies during hoisting", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
      "0.0.5": {
        bin: {
          "baz-exec": "index.js",
        },
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      peerDependencies: {
        baz: ">0.0.3",
      },
      workspaces: ["bar", "moo"],
    }),
  );
  await mkdir(join(package_dir, "bar"));
  await writeFile(
    join(package_dir, "bar", "package.json"),
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
      dependencies: {
        baz: "0.0.3",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.0.4",
      dependencies: {
        baz: "0.0.5",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--peer"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@workspace:bar",
    " + moo@workspace:moo",
    "",
    " 4 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`, `${root_url}/baz-0.0.5.tgz`]);
  expect(requested).toBe(3);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar", "baz", "moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-exec", "baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-exec"))).toBe(join("..", "baz", "index.js"));
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(
    join("..", "..", "bar", "node_modules", "baz", "index.js"),
  );
  expect(await readlink(join(package_dir, "node_modules", "bar"))).toBe(join("..", "bar"));
  expect(await readdirSorted(join(package_dir, "bar"))).toEqual(["node_modules", "package.json"]);
  expect(await readdirSorted(join(package_dir, "bar", "node_modules"))).toEqual(["baz"]);
  expect(await readdirSorted(join(package_dir, "bar", "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "bar", "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.5",
    bin: {
      "baz-exec": "index.js",
    },
  });
  expect(await readlink(join(package_dir, "node_modules", "moo"))).toBe(join("..", "moo"));
  expect(await readdirSorted(join(package_dir, "moo"))).toEqual(["package.json"]);
  await access(join(package_dir, "bun.lockb"));
});

it("should not regard peerDependencies declarations as duplicates", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "*",
      },
      peerDependencies: {
        bar: "^0.0.2",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should report error on invalid format for package.json", async () => {
  await writeFile(join(package_dir, "package.json"), "foo");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.replace(/^bun install v.+\n/, "bun install\n").split(/\r?\n/)).toEqual([
    "bun install",
    "",
    "",
    "error: Unexpected foo",
    "foo",
    "^",
    `${package_dir}/package.json:1:1 0`,
    `ParserError parsing package.json in "${package_dir}/"`,
    "",
  ]);
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toEqual("");
  expect(await exited).toBe(1);
});

it("should report error on invalid format for dependencies", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: [],
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.replace(/^bun install v.+\n/, "bun install\n").split(/\r?\n/)).toEqual([
    "bun install",
    "",
    "",
    "error: dependencies expects a map of specifiers, e.g.",
    '"dependencies": {',
    '  "bun": "latest"',
    "}",
    '{"name":"foo","version":"0.0.1","dependencies":[]}',
    "                                ^",
    `${package_dir}/package.json:1:33 32`,
    "",
  ]);
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toEqual("");
  expect(await exited).toBe(1);
});

it("should report error on invalid format for optionalDependencies", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      optionalDependencies: "bar",
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.replace(/^bun install v.+\n/, "bun install\n").split(/\r?\n/)).toEqual([
    "bun install",
    "",
    "",
    "error: optionalDependencies expects a map of specifiers, e.g.",
    '"optionalDependencies": {',
    '  "bun": "latest"',
    "}",
    '{"name":"foo","version":"0.0.1","optionalDependencies":"bar"}',
    "                                ^",
    `${package_dir}/package.json:1:33 32`,
    "",
  ]);
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toEqual("");
  expect(await exited).toBe(1);
});

it("should report error on invalid format for workspaces", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      workspaces: {
        packages: { bar: true },
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.replace(/^bun install v.+\n/, "bun install\n").split(/\r?\n/)).toEqual([
    "bun install",
    "",
    "",
    "error: Workspaces expects an array of strings, e.g.",
    '"workspaces": [',
    '  "path/to/package"',
    "]",
    '{"name":"foo","version":"0.0.1","workspaces":{"packages":{"bar":true}}}',
    "                                ^",
    `${package_dir}/package.json:1:33 32`,
    "",
  ]);
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toEqual("");
  expect(await exited).toBe(1);
});

it("should report error on duplicated workspace packages", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      workspaces: ["bar", "baz"],
    }),
  );
  await mkdir(join(package_dir, "bar"));
  await writeFile(
    join(package_dir, "bar", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.0.2",
    }),
  );
  await mkdir(join(package_dir, "baz"));
  await writeFile(
    join(package_dir, "baz", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.0.3",
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.replace(/^bun install v.+\n/, "bun install\n").split(/\r?\n/)).toEqual([
    "bun install",
    "",
    "",
    'error: Workspace name "moo" already exists',
    '{"name":"foo","version":"0.0.1","workspaces":["bar","baz"]}',
    // we don't have a name location anymore
    "^",
    `${package_dir}/package.json:1:1 0`,
    "",
  ]);
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toEqual("");
  expect(await exited).toBe(1);
});

it("should handle Git URL in dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        "uglify-js": "git+https://git@github.com/mishoo/UglifyJS.git",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  let out = await new Response(stdout).text();
  out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
  out = out.replace(/(\.git)#[a-f0-9]+/, "$1");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + uglify-js@git+https://git@github.com/mishoo/UglifyJS.git",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify-js"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["uglifyjs"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "uglifyjs"))).toBe(
    join("..", "uglify-js", "bin", "uglifyjs"),
  );
  expect((await readdirSorted(join(package_dir, "node_modules", ".cache")))[0]).toBe("9694c5fe9c41ad51.git");
  expect(await readdirSorted(join(package_dir, "node_modules", "uglify-js"))).toEqual([
    ".bun-tag",
    ".gitattributes",
    ".github",
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "bin",
    "lib",
    "package.json",
    "test",
    "tools",
  ]);
  const package_json = await file(join(package_dir, "node_modules", "uglify-js", "package.json")).json();
  expect(package_json.name).toBe("uglify-js");
  await access(join(package_dir, "bun.lockb"));
}, 20000);

it("should handle Git URL in dependencies (SCP-style)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        uglify: "github.com:mishoo/UglifyJS.git",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  let out = await new Response(stdout).text();
  out = out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
  out = out.replace(/(\.git)#[a-f0-9]+/, "$1");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + uglify@git+ssh://github.com:mishoo/UglifyJS.git",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["uglifyjs"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "uglifyjs"))).toBe(
    join("..", "uglify", "bin", "uglifyjs"),
  );
  expect((await readdirSorted(join(package_dir, "node_modules", ".cache")))[0]).toBe("87d55589eb4217d2.git");
  expect(await readdirSorted(join(package_dir, "node_modules", "uglify"))).toEqual([
    ".bun-tag",
    ".gitattributes",
    ".github",
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "bin",
    "lib",
    "package.json",
    "test",
    "tools",
  ]);
  const package_json = await file(join(package_dir, "node_modules", "uglify", "package.json")).json();
  expect(package_json.name).toBe("uglify-js");
  await access(join(package_dir, "bun.lockb"));
}, 20000);

it("should handle Git URL with committish in dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        uglify: "git+https://git@github.com/mishoo/UglifyJS.git#v3.14.1",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + uglify@git+https://git@github.com/mishoo/UglifyJS.git#e219a9a78a0d2251e4dcbd4bb9034207eb484fe8",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["uglifyjs"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "uglifyjs"))).toBe(
    join("..", "uglify", "bin", "uglifyjs"),
  );
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual([
    "9694c5fe9c41ad51.git",
    "@G@e219a9a78a0d2251e4dcbd4bb9034207eb484fe8",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "uglify"))).toEqual([
    ".bun-tag",
    ".gitattributes",
    ".github",
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "bin",
    "lib",
    "package.json",
    "test",
    "tools",
  ]);
  const package_json = await file(join(package_dir, "node_modules", "uglify", "package.json")).json();
  expect(package_json.name).toBe("uglify-js");
  expect(package_json.version).toBe("3.14.1");
  await access(join(package_dir, "bun.lockb"));
}, 20000);

it("should fail on invalid Git URL", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        uglify: "git+http://bun.sh/no_such_repo",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain('error: "git clone" for "uglify" failed');
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toBe("");
  expect(await exited).toBe(1);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  try {
    await access(join(package_dir, "bun.lockb"));
    expect(() => {}).toThrow();
  } catch (err: any) {
    expect(err.code).toBe("ENOENT");
  }
});

it("should fail on Git URL with invalid committish", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        uglify: "git+https://git@github.com/mishoo/UglifyJS.git#404-no_such_tag",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain(
    'error: no commit matching "404-no_such_tag" found for "uglify" (but repository exists)',
  );
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toBe("");
  expect(await exited).toBe(1);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  try {
    await access(join(package_dir, "bun.lockb"));
    expect(() => {}).toThrow();
  } catch (err: any) {
    expect(err.code).toBe("ENOENT");
  }
}, 20000);

it("should de-duplicate committish in Git URLs", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        "uglify-ver": "git+https://git@github.com/mishoo/UglifyJS.git#v3.14.1",
        "uglify-hash": "git+https://git@github.com/mishoo/UglifyJS.git#e219a9a",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + uglify-hash@git+https://git@github.com/mishoo/UglifyJS.git#e219a9a78a0d2251e4dcbd4bb9034207eb484fe8",
    " + uglify-ver@git+https://git@github.com/mishoo/UglifyJS.git#e219a9a78a0d2251e4dcbd4bb9034207eb484fe8",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bin",
    ".cache",
    "uglify-hash",
    "uglify-ver",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["uglifyjs"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "uglifyjs"))).toBe(
    join("..", "uglify-hash", "bin", "uglifyjs"),
  );
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual([
    "9694c5fe9c41ad51.git",
    "@G@e219a9a78a0d2251e4dcbd4bb9034207eb484fe8",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "uglify-hash"))).toEqual([
    ".bun-tag",
    ".gitattributes",
    ".github",
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "bin",
    "lib",
    "package.json",
    "test",
    "tools",
  ]);
  const hash_json = await file(join(package_dir, "node_modules", "uglify-hash", "package.json")).json();
  expect(hash_json.name).toBe("uglify-js");
  expect(hash_json.version).toBe("3.14.1");
  expect(await readdirSorted(join(package_dir, "node_modules", "uglify-ver"))).toEqual([
    ".bun-tag",
    ".gitattributes",
    ".github",
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "bin",
    "lib",
    "package.json",
    "test",
    "tools",
  ]);
  const ver_json = await file(join(package_dir, "node_modules", "uglify-ver", "package.json")).json();
  expect(ver_json.name).toBe("uglify-js");
  expect(ver_json.version).toBe("3.14.1");
  await access(join(package_dir, "bun.lockb"));
}, 20000);

it("should handle Git URL with existing lockfile", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
`,
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "html-minifier": "git+https://git@github.com/kangax/html-minifier#v4.0.0",
      },
    }),
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).toContain("Saved lockfile");
  expect(stdout1).toBeDefined();
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + html-minifier@git+https://git@github.com/kangax/html-minifier#4beb325eb01154a40c0cbebff2e5737bbd7071ab",
    "",
    " 12 packages installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bin",
    ".cache",
    "camel-case",
    "clean-css",
    "commander",
    "he",
    "html-minifier",
    "lower-case",
    "no-case",
    "param-case",
    "relateurl",
    "source-map",
    "uglify-js",
    "upper-case",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["he", "html-minifier", "uglifyjs"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "he"))).toBe(join("..", "he", "bin", "he"));
  expect(await readlink(join(package_dir, "node_modules", ".bin", "html-minifier"))).toBe(
    join("..", "html-minifier", "cli.js"),
  );
  expect(await readlink(join(package_dir, "node_modules", ".bin", "uglifyjs"))).toBe(
    join("..", "uglify-js", "bin", "uglifyjs"),
  );
  await access(join(package_dir, "bun.lockb"));
  // Perform `bun install` again but with lockfile from before
  await rm(join(package_dir, "node_modules"), { force: true, recursive: true });
  urls.length = 0;
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("Saved lockfile");
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + html-minifier@git+https://git@github.com/kangax/html-minifier#4beb325eb01154a40c0cbebff2e5737bbd7071ab",
    "",
    " 12 packages installed",
  ]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bin",
    ".cache",
    "camel-case",
    "clean-css",
    "commander",
    "he",
    "html-minifier",
    "lower-case",
    "no-case",
    "param-case",
    "relateurl",
    "source-map",
    "uglify-js",
    "upper-case",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["he", "html-minifier", "uglifyjs"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "he"))).toBe(join("..", "he", "bin", "he"));
  expect(await readlink(join(package_dir, "node_modules", ".bin", "html-minifier"))).toBe(
    join("..", "html-minifier", "cli.js"),
  );
  expect(await readlink(join(package_dir, "node_modules", ".bin", "uglifyjs"))).toBe(
    join("..", "uglify-js", "bin", "uglifyjs"),
  );
  await access(join(package_dir, "bun.lockb"));
  // Perform `bun install` again but with cache & lockfile from before
  await Promise.all(
    [
      ".bin",
      "camel-case",
      "clean-css",
      "commander",
      "he",
      "html-minifier",
      "lower-case",
      "no-case",
      "param-case",
      "relateurl",
      "source-map",
      "uglify-js",
      "upper-case",
    ].map(async dir => await rm(join(package_dir, "node_modules", dir), { force: true, recursive: true })),
  );

  urls.length = 0;
  const {
    stdout: stdout3,
    stderr: stderr3,
    exited: exited3,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr3).toBeDefined();
  const err3 = await new Response(stderr3).text();
  expect(err3).not.toContain("Saved lockfile");
  expect(stdout3).toBeDefined();
  const out3 = await new Response(stdout3).text();
  expect(out3.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + html-minifier@git+https://git@github.com/kangax/html-minifier#4beb325eb01154a40c0cbebff2e5737bbd7071ab",
    "",
    " 12 packages installed",
  ]);
  expect(await exited3).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bin",
    ".cache",
    "camel-case",
    "clean-css",
    "commander",
    "he",
    "html-minifier",
    "lower-case",
    "no-case",
    "param-case",
    "relateurl",
    "source-map",
    "uglify-js",
    "upper-case",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["he", "html-minifier", "uglifyjs"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "he"))).toBe(join("..", "he", "bin", "he"));
  expect(await readlink(join(package_dir, "node_modules", ".bin", "html-minifier"))).toBe(
    join("..", "html-minifier", "cli.js"),
  );
  expect(await readlink(join(package_dir, "node_modules", ".bin", "uglifyjs"))).toBe(
    join("..", "uglify-js", "bin", "uglifyjs"),
  );
  await access(join(package_dir, "bun.lockb"));
}, 20000);

it("should prefer optionalDependencies over dependencies of the same name", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": {},
      "0.0.5": {},
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        baz: "0.0.5",
      },
      optionalDependencies: {
        baz: "0.0.3",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + baz@0.0.3",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
});

it("should prefer dependencies over peerDependencies of the same name", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": {},
      "0.0.5": {},
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        baz: "0.0.5",
      },
      peerDependencies: {
        baz: "0.0.3",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + baz@0.0.5",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.5.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.5",
    bin: {
      "baz-exec": "index.js",
    },
  });
});

it("should handle tarball URL", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        baz: `${root_url}/baz-0.0.3.tgz`,
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    ` + baz@${root_url}/baz-0.0.3.tgz`,
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(1);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle tarball path", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        baz: join(import.meta.dir, "baz-0.0.3.tgz"),
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    ` + baz@${join(import.meta.dir, "baz-0.0.3.tgz")}`,
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle tarball URL with aliasing", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: `${root_url}/baz-0.0.3.tgz`,
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    ` + bar@${root_url}/baz-0.0.3.tgz`,
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(1);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "bar", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle tarball path with aliasing", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: join(import.meta.dir, "baz-0.0.3.tgz"),
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    ` + bar@${join(import.meta.dir, "baz-0.0.3.tgz")}`,
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "bar", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should de-duplicate dependencies alongside tarball URL", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.2": {},
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "@barn/moo": `${root_url}/moo-0.1.0.tgz`,
        bar: "<=0.0.2",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    ` + @barn/moo@${root_url}/moo-0.1.0.tgz`,
    " + bar@0.0.2",
    "",
    " 3 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/bar`,
    `${root_url}/bar-0.0.2.tgz`,
    `${root_url}/baz`,
    `${root_url}/baz-0.0.3.tgz`,
    `${root_url}/moo-0.1.0.tgz`,
  ]);
  expect(requested).toBe(5);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "@barn", "bar", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toEqual({
    name: "@barn/moo",
    version: "0.1.0",
    dependencies: {
      bar: "0.0.2",
      baz: "latest",
    },
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle tarball URL with existing lockfile", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.2": {},
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "@barn/moo": `${root_url}/moo-0.1.0.tgz`,
      },
    }),
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).toContain("Saved lockfile");
  expect(stdout1).toBeDefined();
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    ` + @barn/moo@${root_url}/moo-0.1.0.tgz`,
    "",
    " 3 packages installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/bar`,
    `${root_url}/bar-0.0.2.tgz`,
    `${root_url}/baz`,
    `${root_url}/baz-0.0.3.tgz`,
    `${root_url}/moo-0.1.0.tgz`,
  ]);
  expect(requested).toBe(5);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "@barn", "bar", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toEqual({
    name: "@barn/moo",
    version: "0.1.0",
    dependencies: {
      bar: "0.0.2",
      baz: "latest",
    },
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
  // Perform `bun install` again but with lockfile from before
  await rm(join(package_dir, "node_modules"), { force: true, recursive: true });
  urls.length = 0;
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("Saved lockfile");
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    ` + @barn/moo@${root_url}/moo-0.1.0.tgz`,
    "",
    " 3 packages installed",
  ]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/bar`,
    `${root_url}/bar-0.0.2.tgz`,
    `${root_url}/baz`,
    `${root_url}/baz-0.0.3.tgz`,
    `${root_url}/moo-0.1.0.tgz`,
  ]);
  expect(requested).toBe(10);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "@barn", "bar", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toEqual({
    name: "@barn/moo",
    version: "0.1.0",
    dependencies: {
      bar: "0.0.2",
      baz: "latest",
    },
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle tarball path with existing lockfile", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.2": {},
      "0.0.3": {
        bin: {
          "baz-run": "index.js",
        },
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "@barn/moo": join(import.meta.dir, "moo-0.1.0.tgz"),
      },
    }),
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).toContain("Saved lockfile");
  expect(stdout1).toBeDefined();
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    ` + @barn/moo@${join(import.meta.dir, "moo-0.1.0.tgz")}`,
    "",
    " 3 packages installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/bar`,
    `${root_url}/bar-0.0.2.tgz`,
    `${root_url}/baz`,
    `${root_url}/baz-0.0.3.tgz`,
  ]);
  expect(requested).toBe(4);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "@barn", "bar", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toEqual({
    name: "@barn/moo",
    version: "0.1.0",
    dependencies: {
      bar: "0.0.2",
      baz: "latest",
    },
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
  // Perform `bun install` again but with lockfile from before
  await rm(join(package_dir, "node_modules"), { force: true, recursive: true });
  urls.length = 0;
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("Saved lockfile");
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    ` + @barn/moo@${join(import.meta.dir, "moo-0.1.0.tgz")}`,
    "",
    " 3 packages installed",
  ]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/bar`,
    `${root_url}/bar-0.0.2.tgz`,
    `${root_url}/baz`,
    `${root_url}/baz-0.0.3.tgz`,
  ]);
  expect(requested).toBe(8);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "@barn", "bar", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "@barn", "moo", "package.json")).json()).toEqual({
    name: "@barn/moo",
    version: "0.1.0",
    dependencies: {
      bar: "0.0.2",
      baz: "latest",
    },
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle devDependencies from folder", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.1.0",
      dependencies: {
        moo: "file:./moo",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  const moo_package = JSON.stringify({
    name: "moo",
    version: "0.2.0",
    devDependencies: {
      bar: "^0.0.2",
    },
  });
  await writeFile(join(package_dir, "moo", "package.json"), moo_package);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([" + moo@moo", "", " 2 packages installed"]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar", "moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "moo"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "moo", "package.json")).text()).toEqual(moo_package);
  await access(join(package_dir, "bun.lockb"));
});

it("should deduplicate devDependencies from folder", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.1.0",
      devDependencies: {
        bar: "^0.0.2",
        moo: "file:./moo",
      },
    }),
  );
  await mkdir(join(package_dir, "moo"));
  const moo_package = JSON.stringify({
    name: "moo",
    version: "0.2.0",
    devDependencies: {
      bar: "^0.0.2",
    },
  });
  await writeFile(join(package_dir, "moo", "package.json"), moo_package);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2",
    " + moo@moo",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar", "moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "moo"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "moo", "package.json")).text()).toEqual(moo_package);
  await access(join(package_dir, "bun.lockb"));
});

it("should install dependencies in root package of workspace", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.1.0",
      workspaces: ["moo"],
    }),
  );
  await mkdir(join(package_dir, "moo"));
  const moo_package = JSON.stringify({
    name: "moo",
    version: "0.2.0",
    dependencies: {
      bar: "^0.0.2",
    },
  });
  await writeFile(join(package_dir, "moo", "package.json"), moo_package);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(package_dir, "moo"),
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + moo@workspace:moo",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar", "moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "moo"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "moo", "package.json")).text()).toEqual(moo_package);
  await access(join(package_dir, "bun.lockb"));
});

it("should install dependencies in root package of workspace (*)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.1.0",
      workspaces: ["*"],
    }),
  );
  await mkdir(join(package_dir, "moo"));
  const moo_package = JSON.stringify({
    name: "moo",
    version: "0.2.0",
    dependencies: {
      bar: "^0.0.2",
    },
  });
  await writeFile(join(package_dir, "moo", "package.json"), moo_package);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(package_dir, "moo"),
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + moo@workspace:moo",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar", "moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await readdirSorted(join(package_dir, "node_modules", "moo"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "moo", "package.json")).text()).toEqual(moo_package);
  await access(join(package_dir, "bun.lockb"));
});

it("should ignore invalid workspaces from parent directory", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  const foo_package = JSON.stringify({
    name: "foo",
    version: "0.1.0",
    workspaces: ["moz"],
  });
  await writeFile(join(package_dir, "package.json"), foo_package);
  await mkdir(join(package_dir, "moo"));
  await writeFile(join(package_dir, "moo", "bunfig.toml"), await file(join(package_dir, "bunfig.toml")).text());
  const moo_package = JSON.stringify({
    name: "moo",
    version: "0.2.0",
    dependencies: {
      bar: "^0.0.2",
    },
  });
  await writeFile(join(package_dir, "moo", "package.json"), moo_package);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(package_dir, "moo"),
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(package_dir)).toEqual(["bunfig.toml", "moo", "package.json"]);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(foo_package);
  expect(await readdirSorted(join(package_dir, "moo"))).toEqual([
    "bun.lockb",
    "bunfig.toml",
    "node_modules",
    "package.json",
  ]);
  expect(await file(join(package_dir, "moo", "package.json")).text()).toEqual(moo_package);
  expect(await readdirSorted(join(package_dir, "moo", "node_modules"))).toEqual([".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "moo", "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "moo", "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
});

it("should handle --cwd", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  const foo_package = JSON.stringify({
    name: "foo",
    version: "0.1.0",
  });
  await writeFile(join(package_dir, "package.json"), foo_package);
  await mkdir(join(package_dir, "moo"));
  await writeFile(join(package_dir, "moo", "bunfig.toml"), await file(join(package_dir, "bunfig.toml")).text());
  const moo_package = JSON.stringify({
    name: "moo",
    version: "0.2.0",
    dependencies: {
      bar: "^0.0.2",
    },
  });
  await writeFile(join(package_dir, "moo", "package.json"), moo_package);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--cwd", "moo"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(package_dir)).toEqual(["bunfig.toml", "moo", "package.json"]);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(foo_package);
  expect(await readdirSorted(join(package_dir, "moo"))).toEqual([
    "bun.lockb",
    "bunfig.toml",
    "node_modules",
    "package.json",
  ]);
  expect(await file(join(package_dir, "moo", "package.json")).text()).toEqual(moo_package);
  expect(await readdirSorted(join(package_dir, "moo", "node_modules"))).toEqual([".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "moo", "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "moo", "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
});

it("should perform bin-linking across multiple dependencies", async () => {
  const foo_package = JSON.stringify({
    name: "foo",
    devDependencies: {
      "conditional-type-checks": "1.0.6",
      "prettier": "2.8.8",
      "tsd": "0.22.0",
      "typescript": "5.0.4",
    },
  });
  await writeFile(join(package_dir, "package.json"), foo_package);
  await writeFile(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
`,
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("error:");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + conditional-type-checks@1.0.6",
    " + prettier@2.8.8",
    " + tsd@0.22.0",
    " + typescript@5.0.4",
    "",
    " 119 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(await readdirSorted(package_dir)).toEqual(["bun.lockb", "bunfig.toml", "node_modules", "package.json"]);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(foo_package);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bin",
    ".cache",
    "@babel",
    "@nodelib",
    "@tsd",
    "@types",
    "ansi-escapes",
    "ansi-regex",
    "ansi-styles",
    "array-union",
    "arrify",
    "braces",
    "camelcase",
    "camelcase-keys",
    "chalk",
    "color-convert",
    "color-name",
    "conditional-type-checks",
    "decamelize",
    "decamelize-keys",
    "dir-glob",
    "emoji-regex",
    "error-ex",
    "escape-string-regexp",
    "eslint-formatter-pretty",
    "eslint-rule-docs",
    "fast-glob",
    "fastq",
    "fill-range",
    "find-up",
    "function-bind",
    "glob-parent",
    "globby",
    "hard-rejection",
    "has",
    "has-flag",
    "hosted-git-info",
    "ignore",
    "indent-string",
    "irregular-plurals",
    "is-arrayish",
    "is-core-module",
    "is-extglob",
    "is-fullwidth-code-point",
    "is-glob",
    "is-number",
    "is-plain-obj",
    "is-unicode-supported",
    "js-tokens",
    "json-parse-even-better-errors",
    "kind-of",
    "lines-and-columns",
    "locate-path",
    "log-symbols",
    "lru-cache",
    "map-obj",
    "meow",
    "merge2",
    "micromatch",
    "min-indent",
    "minimist-options",
    "normalize-package-data",
    "p-limit",
    "p-locate",
    "p-try",
    "parse-json",
    "path-exists",
    "path-parse",
    "path-type",
    "picomatch",
    "plur",
    "prettier",
    "queue-microtask",
    "quick-lru",
    "read-pkg",
    "read-pkg-up",
    "redent",
    "resolve",
    "reusify",
    "run-parallel",
    "semver",
    "slash",
    "spdx-correct",
    "spdx-exceptions",
    "spdx-expression-parse",
    "spdx-license-ids",
    "string-width",
    "strip-ansi",
    "strip-indent",
    "supports-color",
    "supports-hyperlinks",
    "supports-preserve-symlinks-flag",
    "to-regex-range",
    "trim-newlines",
    "tsd",
    "type-fest",
    "typescript",
    "validate-npm-package-license",
    "yallist",
    "yargs-parser",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual([
    "prettier",
    "resolve",
    "semver",
    "tsc",
    "tsd",
    "tsserver",
  ]);
}, 10000);
