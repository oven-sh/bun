import { file, spawn } from "bun";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
} from "bun:test";
import { bunExe } from "bunExe";
import { bunEnv as env } from "bunEnv";
import { access, mkdir, mkdtemp, readdir, readlink, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let handler, package_dir, requested, server;

async function readdirSorted(path: PathLike): Promise<string[]> {
  const results = await readdir(path);
  results.sort();
  return results;
}

function resetHanlder() {
  handler = () => new Response("Tea Break~", { status: 418 });
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
  handler = async (request) => {
    expect(request.method).toBe("GET");
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    expect(request.headers.get("npm-auth-type")).toBe(null);
    expect(await request.text()).toBe("");
    urls.push(request.url);
    return new Response("bar", { status: 404 });
  };
  const { stdout, stderr, exited } = spawn({
    cmd: [
      bunExe(),
      "install",
      "foo",
      "--config",
      import.meta.dir + "/basic.toml",
    ],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain(
    'error: package "foo" not found localhost/foo 404',
  );
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(await exited).toBe(1);
  expect(urls).toEqual([
    "http://localhost:54321/foo",
  ]);
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
  const url = "http://localhost:54321/@foo/bar";
  const urls: string[] = [];
  handler = async (request) => {
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
  };
  const { stdout, stderr, exited } = spawn({
    cmd: [
      bunExe(),
      "install",
      "@foo/bar",
      "--config",
      import.meta.dir + "/basic.toml",
    ],
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
  expect(urls).toEqual([
    url,
  ]);
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
  handler = dummyRegistry(urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "bar": "",
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2", "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([
    "http://localhost:54321/bar",
    "http://localhost:54321/bar.tgz",
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "bar",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual([
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "baz",
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Bar@workspace:bar",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "Bar",
  ]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(
    join("..", "bar"),
  );
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Bar@workspace:bar",
    " + Baz@workspace:packages/baz",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "Bar",
    "Baz",
  ]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(
    join("..", "bar"),
  );
  expect(await readlink(join(package_dir, "node_modules", "Baz"))).toBe(
    join("..", "packages", "baz"),
  );
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Bar@workspace:bar",
    " + Baz@workspace:packages/baz",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "Bar",
    "Baz",
  ]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(
    join("..", "bar"),
  );
  expect(await readlink(join(package_dir, "node_modules", "Baz"))).toBe(
    join("..", "packages", "baz"),
  );
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Bar@workspace:bar",
    " + Baz@workspace:packages/baz",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "Bar",
    "Baz",
  ]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(
    join("..", "bar"),
  );
  expect(await readlink(join(package_dir, "node_modules", "Baz"))).toBe(
    join("..", "packages", "baz"),
  );
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + Baz@workspace:packages/baz",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "Baz",
  ]);
  expect(await readlink(join(package_dir, "node_modules", "Baz"))).toBe(
    join("..", "packages", "baz"),
  );
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
  await writeFile(
    join(package_dir, "index.js"),
    'console.log("[scripts:run] Foo");',
  );
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
  await writeFile(
    join(package_dir, "bar", "index.js"),
    'console.log("[scripts:run] Bar");',
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    "[scripts:run] Bar",
    " + Bar@workspace:bar",
    "[scripts:run] Foo",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "Bar",
  ]);
  expect(await readlink(join(package_dir, "node_modules", "Bar"))).toBe(
    join("..", "bar"),
  );
  await access(join(package_dir, "bun.lockb"));
});

function dummyRegistry(urls, version = "0.0.2") {
  return async (request) => {
    urls.push(request.url);
    expect(request.method).toBe("GET");
    if (request.url.endsWith(".tgz")) {
      return new Response(file(join(import.meta.dir, "tarball.tgz")));
    }
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    expect(request.headers.get("npm-auth-type")).toBe(null);
    expect(await request.text()).toBe("");
    const name = request.url.slice(request.url.lastIndexOf("/") + 1);
    return new Response(JSON.stringify({
      name,
      versions: {
        [version]: {
          name,
          version,
          dist: {
            tarball: `${request.url}.tgz`,
          },
        },
      },
      "dist-tags": {
        latest: version,
      },
    }));
  };
}

it("should handle ^0 in dependencies", async () => {
  const urls: string[] = [];
  handler = dummyRegistry(urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "bar": "^0",
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2", "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([
    "http://localhost:54321/bar",
    "http://localhost:54321/bar.tgz",
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "bar",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual([
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle ^1 in dependencies", async () => {
  const urls: string[] = [];
  handler = dummyRegistry(urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "bar": "^1",
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
  expect(urls).toEqual([
    "http://localhost:54321/bar",
  ]);
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
  handler = dummyRegistry(urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "bar": "^0.0",
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2", "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([
    "http://localhost:54321/bar",
    "http://localhost:54321/bar.tgz",
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "bar",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual([
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle ^0.1 in dependencies", async () => {
  const urls: string[] = [];
  handler = dummyRegistry(urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "bar": "^0.1",
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
  expect(urls).toEqual([
    "http://localhost:54321/bar",
  ]);
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
  handler = dummyRegistry(urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "bar": "^0.0.0",
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
  expect(urls).toEqual([
    "http://localhost:54321/bar",
  ]);
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
  handler = dummyRegistry(urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "bar": "^0.0.2",
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2", "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([
    "http://localhost:54321/bar",
    "http://localhost:54321/bar.tgz",
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "bar",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual([
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle ^0.0.2-rc in dependencies", async () => {
  const urls: string[] = [];
  handler = dummyRegistry(urls, "0.0.2-rc");
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "bar": "^0.0.2-rc",
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2-rc", "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([
    "http://localhost:54321/bar",
    "http://localhost:54321/bar.tgz",
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "bar",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual([
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle ^0.0.2-alpha.3+b4d in dependencies", async () => {
  const urls: string[] = [];
  handler = dummyRegistry(urls, "0.0.2-alpha.3");
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        "bar": "^0.0.2-alpha.3+b4d",
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + bar@0.0.2-alpha.3", "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([
    "http://localhost:54321/bar",
    "http://localhost:54321/bar.tgz",
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "bar",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual([
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle dependency aliasing", async () => {
  const urls = [];
  handler = dummyRegistry(urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        "Bar": "npm:baz",
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + baz@0.0.2",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([
    "http://localhost:54321/baz",
    "http://localhost:54321/baz.tgz",
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "Bar",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "Bar"))).toEqual([
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle dependency aliasing (versioned)", async () => {
  const urls: string[] = [];
  handler = dummyRegistry(urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        "Bar": "npm:baz@0.0.2",
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + baz@0.0.2",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([
    "http://localhost:54321/baz",
    "http://localhost:54321/baz.tgz",
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "Bar",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "Bar"))).toEqual([
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle dependency aliasing (dist-tagged)", async () => {
  const urls: string[] = [];
  handler = dummyRegistry(urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        "Bar": "npm:baz@latest",
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
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + baz@0.0.2",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([
    "http://localhost:54321/baz",
    "http://localhost:54321/baz.tgz",
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "Bar",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "Bar"))).toEqual([
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should not reinstall aliased dependencies", async () => {
  const urls = [];
  handler = dummyRegistry(urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {
        "Bar": "npm:baz",
      },
    }),
  );
  const { stdout: stdout1, stderr: stderr1, exited: exited1 } = spawn({
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
  expect(out1.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + baz@0.0.2",
    "",
    " 1 packages installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls).toEqual([
    "http://localhost:54321/baz",
    "http://localhost:54321/baz.tgz",
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "Bar",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "Bar"))).toEqual([
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
  // Performs `bun install` again, expects no-op
  urls.length = 0;
  const { stdout: stdout2, stderr: stderr2, exited: exited2 } = spawn({
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
  expect(out2.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "Checked 1 installs across 2 packages (no changes)",
  ]);
  expect(await exited2).toBe(0);
  expect(urls).toEqual([]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".cache",
    "Bar",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", "Bar"))).toEqual([
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "Bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.2",
  });
  await access(join(package_dir, "bun.lockb"));
});
