import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { bunExe } from "bunExe";
import { mkdir, mkdtemp, readdir, readlink, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let handler, package_dir, requested, server;

function resetHanlder() {
  handler = function() {
    return new Response("Tea Break~", { status: 418 });
  };
}

beforeAll(() => {
  server = Bun.serve({
    async fetch(request) {
      requested++;
      return await handler(request);
    },
    port: 54321,
  });
});
afterAll(() => {
  server.stop();
});
beforeEach(async () => {
  resetHanlder();
  requested = 0;
  package_dir = await mkdtemp(join(tmpdir(), "bun-install.test"));
});
afterEach(async () => {
  resetHanlder();
  await rm(package_dir, { force: true, recursive: true });
});

it("should handle missing package", async () => {
  const urls: string[] = [];
  handler = async(request) => {
    expect(request.method).toBe("GET");
    expect(request.headers.get("accept")).toBe("application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*");
    expect(request.headers.get("npm-auth-type")).toBe(null);
    expect(await request.text()).toBe("");
    urls.push(request.url);
    return new Response("bar", { status: 404 });
  };
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "foo", "--config", import.meta.dir + "/basic.toml"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });
  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain('error: package "foo" not found localhost/foo 404');
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(urls).toContain("http://localhost:54321/foo");
  expect(await exited).toBe(1);
  expect(requested).toBe(1);
});

it("should handle @scoped authentication", async () => {
  let seen_token = false;
  const url = "http://localhost:54321/@foo/bar";
  const urls: string[] = [];
  handler = async(request) => {
    expect(request.method).toBe("GET");
    expect(request.headers.get("accept")).toBe("application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*");
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
  };
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "@foo/bar", "--config", import.meta.dir + "/basic.toml"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });
  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain(`GET ${url} - 555`);
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(urls).toContain(url);
  expect(seen_token).toBe(true);
  expect(await exited).toBe(1);
  expect(requested).toBe(1);
});

it("should handle workspaces", async () => {
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "Foo",
    version: "0.0.1",
    workspaces: [
      "bar",
    ],
  }));
  await mkdir(join(package_dir, "bar"));
  await writeFile(join(package_dir, "bar", "package.json"), JSON.stringify({
    name: "Bar",
    version: "0.0.2",
  }));
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });
  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  var out = await new Response(stdout).text();
  expect(out).toContain("+ Bar@workspace://bar");
  expect(out).toContain("1 packages installed");
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdir(join(package_dir, "node_modules"))).toEqual(["Bar"]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(join("..", "bar"));
});

it("should handle inter-dependency between workspaces", async () => {
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "Foo",
    version: "0.0.1",
    workspaces: [
      "bar",
      "packages/baz",
    ],
  }));
  await mkdir(join(package_dir, "bar"));
  await writeFile(join(package_dir, "bar", "package.json"), JSON.stringify({
    name: "Bar",
    version: "0.0.2",
    dependencies: {
      "Baz": "0.0.3",
    },
  }));
  await mkdir(join(package_dir, "packages", "baz"), { recursive: true });
  await writeFile(join(package_dir, "packages", "baz", "package.json"), JSON.stringify({
    name: "Baz",
    version: "0.0.3",
    dependencies: {
      "Bar": "0.0.2",
    },
  }));
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });
  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  var out = await new Response(stdout).text();
  expect(out).toContain("+ Bar@workspace://bar");
  expect(out).toContain("+ Baz@workspace://packages/baz");
  expect(out).toContain("2 packages installed");
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdir(join(package_dir, "node_modules"))).toEqual(["Bar", "Baz"]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(join("..", "bar"));
  expect(await readlink(join(package_dir, "node_modules", "Baz"))).toBe(join("..", "packages", "baz"));
});

it("should handle inter-dependency between workspaces (devDependencies)", async () => {
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "Foo",
    version: "0.0.1",
    workspaces: [
      "bar",
      "packages/baz",
    ],
  }));
  await mkdir(join(package_dir, "bar"));
  await writeFile(join(package_dir, "bar", "package.json"), JSON.stringify({
    name: "Bar",
    version: "0.0.2",
    devDependencies: {
      "Baz": "0.0.3",
    },
  }));
  await mkdir(join(package_dir, "packages", "baz"), { recursive: true });
  await writeFile(join(package_dir, "packages", "baz", "package.json"), JSON.stringify({
    name: "Baz",
    version: "0.0.3",
    devDependencies: {
      "Bar": "0.0.2",
    },
  }));
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });
  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  var out = await new Response(stdout).text();
  expect(out).toContain("+ Bar@workspace://bar");
  expect(out).toContain("+ Baz@workspace://packages/baz");
  expect(out).toContain("2 packages installed");
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdir(join(package_dir, "node_modules"))).toEqual(["Bar", "Baz"]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(join("..", "bar"));
  expect(await readlink(join(package_dir, "node_modules", "Baz"))).toBe(join("..", "packages", "baz"));
});

it("should handle inter-dependency between workspaces (optionalDependencies)", async () => {
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "Foo",
    version: "0.0.1",
    workspaces: [
      "bar",
      "packages/baz",
    ],
  }));
  await mkdir(join(package_dir, "bar"));
  await writeFile(join(package_dir, "bar", "package.json"), JSON.stringify({
    name: "Bar",
    version: "0.0.2",
    optionalDependencies: {
      "Baz": "0.0.3",
    },
  }));
  await mkdir(join(package_dir, "packages", "baz"), { recursive: true });
  await writeFile(join(package_dir, "packages", "baz", "package.json"), JSON.stringify({
    name: "Baz",
    version: "0.0.3",
    optionalDependencies: {
      "Bar": "0.0.2",
    },
  }));
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });
  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  var out = await new Response(stdout).text();
  expect(out).toContain("+ Bar@workspace://bar");
  expect(out).toContain("+ Baz@workspace://packages/baz");
  expect(out).toContain("2 packages installed");
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdir(join(package_dir, "node_modules"))).toEqual(["Bar", "Baz"]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(join("..", "bar"));
  expect(await readlink(join(package_dir, "node_modules", "Baz"))).toBe(join("..", "packages", "baz"));
});

it("should ignore peerDependencies within workspaces", async () => {
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "Foo",
    version: "0.0.1",
    workspaces: [
      "bar",
    ],
  }));
  await mkdir(join(package_dir, "bar"));
  await writeFile(join(package_dir, "bar", "package.json"), JSON.stringify({
    name: "Bar",
    version: "0.0.2",
    peerDependencies: {
      "Baz": ">=0.0.3",
    },
  }));
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });
  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  var out = await new Response(stdout).text();
  expect(out).toContain("+ Bar@workspace://bar");
  expect(out).toContain("1 packages installed");
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdir(join(package_dir, "node_modules"))).toEqual(["Bar"]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(join("..", "bar"));
});
