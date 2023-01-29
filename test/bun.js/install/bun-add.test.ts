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
import {
  access,
  mkdir,
  mkdtemp,
  readlink,
  rm,
  writeFile,
} from "fs/promises";
import { join, relative } from "path";
import { tmpdir } from "os";
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

let add_dir;

beforeEach(async () => {
  add_dir = await mkdtemp(join(tmpdir(), "bun-add.test"));
  await dummyBeforeEach();
});
afterEach(async () => {
  await rm(add_dir, { force: true, recursive: true });
  await dummyAfterEach();
});

it("should add existing package", async () => {
  await writeFile(join(add_dir, "package.json"), JSON.stringify({
    name: "foo",
    version: "0.0.1",
  }));
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "bar",
    version: "0.0.2",
  }));
  const add_path = relative(package_dir, add_dir);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", `file:${add_path}`],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual([
    "bun add",
    " Saved lockfile",
    "",
  ]);
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    ` + foo@${add_path}`,
    "",
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
    dependencies: {
      foo: `file:${add_path}`,
    },
  });
});

it("should reject missing package", async () => {
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "bar",
    version: "0.0.2",
  }));
  const add_path = relative(package_dir, add_dir);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", `file:${add_path}`],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual([
    "bun add",
    `error: file:${add_path}@file:${add_path} failed to resolve`,
    "",
  ]);
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toBe("");
  expect(await exited).toBe(1);
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
});

it("should reject invalid path without segfault", async () => {
  await writeFile(join(add_dir, "package.json"), JSON.stringify({
    name: "foo",
    version: "0.0.1",
  }));
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "bar",
    version: "0.0.2",
  }));
  const add_path = relative(package_dir, add_dir);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", `file://${add_path}`],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual([
    "bun add",
    `error: file://${add_path}@file://${add_path} failed to resolve`,
    "",
  ]);
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toBe("");
  expect(await exited).toBe(1);
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
});

it("should handle semver-like names", async() => {
  const urls: string[] = [];
  setHandler(async (request) => {
    expect(request.method).toBe("GET");
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    expect(request.headers.get("npm-auth-type")).toBe(null);
    expect(await request.text()).toBe("");
    urls.push(request.url);
    return new Response("not to be found", { status: 404 });
  });
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "foo",
    version: "0.0.1",
  }));
  const { stdout, stderr, exited } = spawn({
    cmd: [
      bunExe(),
      "add",
      "1.2.3",
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
    'error: package "1.2.3" not found localhost/1.2.3 404',
  );
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(await exited).toBe(1);
  expect(urls).toEqual([`${root_url}/1.2.3`]);
  expect(requested).toBe(1);
  try {
    await access(join(package_dir, "bun.lockb"));
    expect(() => {}).toThrow();
  } catch (err: any) {
    expect(err.code).toBe("ENOENT");
  }
});

it("should handle @scoped names", async() => {
  const urls: string[] = [];
  setHandler(async (request) => {
    expect(request.method).toBe("GET");
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    expect(request.headers.get("npm-auth-type")).toBe(null);
    expect(await request.text()).toBe("");
    urls.push(request.url);
    return new Response("not to be found", { status: 404 });
  });
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "foo",
    version: "0.0.1",
  }));
  const { stdout, stderr, exited } = spawn({
    cmd: [
      bunExe(),
      "add",
      "@bar/baz",
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
    'error: package "@bar/baz" not found localhost/@bar/baz 404',
  );
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(await exited).toBe(1);
  expect(urls).toEqual([`${root_url}/@bar/baz`]);
  expect(requested).toBe(1);
  try {
    await access(join(package_dir, "bun.lockb"));
    expect(() => {}).toThrow();
  } catch (err: any) {
    expect(err.code).toBe("ENOENT");
  }
});

it("should add dependency with specified semver", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, "0.0.3", {
    bin: {
      "baz-run": "index.js",
    },
  }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "baz@~0.0.2", "--config", import.meta.dir + "/basic.toml"],
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
    "",
    " installed baz@0.0.3 with binaries:",
    "  - baz-run",
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([
    `${root_url}/baz`,
    `${root_url}/baz.tgz`,
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bin",
    ".cache",
    "baz",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual([
    "baz-run",
  ]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(
    join("..", "baz", "index.js"),
  );
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual([
    "index.js",
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    version: "0.0.1",
    dependencies: {
      baz: "~0.0.2",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should add dependency alongside workspaces", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, "0.0.3", {
    bin: {
      "baz-run": "index.js",
    },
  }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      workspaces: ["packages/bar"],
    }),
  );
  await mkdir(join(package_dir, "packages", "bar"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "bar", "package.json"),
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "baz", "--config", import.meta.dir + "/basic.toml"],
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
    " + bar@workspace:packages/bar",
    "",
    " installed baz@0.0.3 with binaries:",
    "  - baz-run",
    "",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([
    `${root_url}/baz`,
    `${root_url}/baz.tgz`,
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bin",
    ".cache",
    "bar",
    "baz",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual([
    "baz-run",
  ]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(
    join("..", "baz", "index.js"),
  );
  expect(await readlink(join(package_dir, "node_modules", "bar"))).toBe(
    join("..", "packages", "bar"),
  );
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual([
    "index.js",
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    version: "0.0.1",
    workspaces: [ "packages/bar" ],
    dependencies: {
      baz: "^0.0.3",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should add aliased dependency (npm)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, "0.0.3", {
    bin: {
      "baz-run": "index.js",
    },
  }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "bar@npm:baz@~0.0.2", "--config", import.meta.dir + "/basic.toml"],
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
    " + bar@0.0.3",
    "",
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([
    `${root_url}/baz`,
    `${root_url}/baz.tgz`,
  ]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bin",
    ".cache",
    "bar",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual([
    "baz-run",
  ]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(
    join("..", "bar", "index.js"),
  );
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual([
    "index.js",
    "package.json",
  ]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    version: "0.0.1",
    dependencies: {
      bar: "npm:baz@~0.0.2",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should add aliased dependency (GitHub)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "uglify@mishoo/UglifyJS#v3.14.1", "--config", import.meta.dir + "/basic.toml"],
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
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toEqual([]);
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bin",
    ".cache",
    "uglify",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual([
    "uglifyjs",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual([
    "@GH@mishoo-UglifyJS-e219a9a",
    "uglify",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache", "uglify"))).toEqual([
    "mishoo-UglifyJS-e219a9a",
  ]);
  expect(await readlink(join(
    package_dir,
    "node_modules",
    ".cache",
    "uglify",
    "mishoo-UglifyJS-e219a9a",
  ))).toBe(
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
  const package_json = await file(join(
    package_dir,
    "node_modules",
    "uglify",
    "package.json",
  )).json();
  expect(package_json.name).toBe("uglify-js");
  expect(package_json.version).toBe("3.14.1");
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    version: "0.0.1",
    dependencies: {
      uglify: "mishoo/UglifyJS#v3.14.1",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});
