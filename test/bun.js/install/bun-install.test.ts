import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { bunExe } from "bunExe";
import { bunEnv as env } from "bunEnv";
import { access, mkdir, readlink, writeFile } from "fs/promises";
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
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(dummyBeforeEach);
afterEach(dummyAfterEach);

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
    cmd: [bunExe(), "install", "foo", "--config", import.meta.dir + "/basic.toml"],
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
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "@foo/bar", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
      workspaces: ["bar"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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

it("should handle dependency aliasing", async () => {
  const urls = [];
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
  const urls = [];
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
  const urls = [];
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
  const urls = [];
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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

it("should consider peerDependencies during hoisting", async () => {
  const urls = [];
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml", "--peer"],
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
    join("..", "bar", "node_modules", "baz", "index.js"),
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
    cmd: [bunExe(), "install", "--config", import.meta.dir + "/basic.toml"],
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
