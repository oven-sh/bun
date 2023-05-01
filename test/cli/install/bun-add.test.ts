import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv as env } from "harness";
import { access, mkdir, mkdtemp, readlink, realpath, rm, writeFile } from "fs/promises";
import { basename, join, relative } from "path";
import { tmpdir } from "os";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  makeBasicPackageJSON,
  package_dir,
  readdirSorted,
  requested,
  root_url,
  setHandler,
  external_command,
  command,
  getYarnLockContents,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

let add_dir: string;

beforeEach(async () => {
  add_dir = await mkdtemp(join(await realpath(tmpdir()), "bun-add.test"));
  await dummyBeforeEach();
});
afterEach(async () => {
  await rm(add_dir, { force: true, recursive: true });
  await dummyAfterEach();
});

it("should add existing package", async () => {
  await writeFile(
    join(add_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );
  const add_path = relative(package_dir, add_dir);
  const { out, err, exited } = await command("add", `file:${add_path}`, "-y");
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual(["bun add", " Saved lockfile", " Saved yarn.lock", ""]);
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    ` installed foo@${add_path}`,
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

  expect((await getYarnLockContents()).replace(basename(add_dir), "")).toMatchSnapshot();
});

it("should reject missing package", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );
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
    `error: file:${add_path} failed to resolve`,
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
  await writeFile(
    join(add_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );
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
    `error: file://${add_path} failed to resolve`,
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

it("should handle semver-like names", async () => {
  const urls: string[] = [];
  setHandler(async request => {
    expect(request.method).toBe("GET");
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    expect(request.headers.get("npm-auth-type")).toBe(null);
    expect(await request.text()).toBe("");
    urls.push(request.url);
    return new Response("not to be found", { status: 404 });
  });
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const { out, err, exited } = await command("add", "1.2.3");
  expect(err.split(/\r?\n/)).toContain('error: package "1.2.3" not found localhost/1.2.3 404');
  expect(out).toBe("");
  expect(await exited).toBe(1);
  expect(urls.sort()).toEqual([`${root_url}/1.2.3`]);
  expect(requested).toBe(1);
  try {
    await access(join(package_dir, "bun.lockb"));
    expect(() => {}).toThrow();
  } catch (err: any) {
    expect(err.code).toBe("ENOENT");
  }
});

it("should handle @scoped names", async () => {
  const urls: string[] = [];
  setHandler(async request => {
    expect(request.method).toBe("GET");
    expect(request.headers.get("accept")).toBe(
      "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
    );
    expect(request.headers.get("npm-auth-type")).toBe(null);
    expect(await request.text()).toBe("");
    urls.push(request.url);
    return new Response("not to be found", { status: 404 });
  });
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "@bar/baz"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain('error: package "@bar/baz" not found localhost/@bar/baz 404');
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(await exited).toBe(1);
  expect(urls.sort()).toEqual([`${root_url}/@bar/baz`]);
  expect(requested).toBe(1);
  try {
    await access(join(package_dir, "bun.lockb"));
    expect(() => {}).toThrow();
  } catch (err: any) {
    expect(err.code).toBe("ENOENT");
  }
});

it("should add dependency with capital letters", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const { out, err, exited } = await command("add", "BaR", "-y");
  expect(err).toContain("Saved lockfile");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed BaR@0.0.2",
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/BaR`, `${root_url}/BaR-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "BaR"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "BaR"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "BaR", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    version: "0.0.1",
    dependencies: {
      BaR: "^0.0.2",
    },
  });
  await access(join(package_dir, "bun.lockb"));
  expect(await getYarnLockContents()).toMatchSnapshot();
});

it("should add dependency with specified semver", async () => {
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
    }),
  );
  const { out, err, exited } = await command("add", "baz@~0.0.2", "-y");
  expect(err).toContain("Saved lockfile");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed baz@0.0.3 with binaries:",
    "  - baz-run",
    "",
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
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    version: "0.0.1",
    dependencies: {
      baz: "~0.0.2",
    },
  });
  await access(join(package_dir, "bun.lockb"));
  expect(await getYarnLockContents()).toMatchSnapshot();
});

it("should add dependency alongside workspaces", async () => {
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
      workspaces: ["packages/*"],
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
  const { out, err, exited } = await command("add", "baz", "-y");
  expect(err).toContain("Saved lockfile");
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
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["baz-run"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "baz-run"))).toBe(join("..", "baz", "index.js"));
  expect(await readlink(join(package_dir, "node_modules", "bar"))).toBe(join("..", "packages", "bar"));
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
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
    workspaces: ["packages/*"],
    dependencies: {
      baz: "^0.0.3",
    },
  });
  await access(join(package_dir, "bun.lockb"));
  expect(await getYarnLockContents()).toMatchSnapshot();
});

it("should add aliased dependency (npm)", async () => {
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
    }),
  );
  const { out, err, exited } = await command("add", "bar@npm:baz@~0.0.2");
  expect(err).toContain("Saved lockfile");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed bar@0.0.3 with binaries:",
    "  - baz-run",
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
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
  const { out, err, exited } = await command ("add", "uglify@mishoo/UglifyJS#v3.14.1", "-y");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed uglify@github:mishoo/UglifyJS#e219a9a with binaries:",
    "  - uglifyjs",
    "",
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
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    version: "0.0.1",
    dependencies: {
      uglify: "mishoo/UglifyJS#v3.14.1",
    },
  });
  await access(join(package_dir, "bun.lockb"));
  expect(await getYarnLockContents()).toMatchSnapshot();
});

it("should let you add the same package twice", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {} }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "Foo",
      version: "0.0.1",
      dependencies: {},
    }),
  );
  // add as non-dev
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "add", "baz@0.0.3"],
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
    "",
    " installed baz@0.0.3",
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "baz"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "Foo",
    version: "0.0.1",
    dependencies: {
      baz: "0.0.3",
    },
  });
  await access(join(package_dir, "bun.lockb"));
  // re-add as dev
  urls.length = 0;
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "add", "baz", "-d"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).toContain("Saved lockfile");
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\[[0-9\.]+m?s\]/, "[]").split(/\r?\n/)).toEqual(["", " installed baz@0.0.3", "", "[] done", ""]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`]);
  expect(requested).toBe(3);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "baz"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "Foo",
    version: "0.0.1",
    dependencies: {
      baz: "^0.0.3",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should install version tagged with `latest` by default", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.3": {},
      "0.0.5": {},
      latest: "0.0.3",
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  // add `latest` version
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "add", "baz"],
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
    "",
    " installed baz@0.0.3",
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "baz"]);
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
      baz: "^0.0.3",
    },
  });
  await access(join(package_dir, "bun.lockb"));
  // re-install with updated `package.json`
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
  expect(err2).toContain("Saved lockfile");
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    " + baz@0.0.3",
    "",
    " 1 packages installed",
  ]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(4);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "baz"]);
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
      baz: "^0.0.3",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should handle Git URL in dependencies (SCP-style)", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "add", "bun@github.com:mishoo/UglifyJS.git"],
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
  let out1 = await new Response(stdout1).text();
  out1 = out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
  out1 = out1.replace(/(\.git)#[a-f0-9]+/, "$1");
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed uglify-js@git+ssh://bun@github.com:mishoo/UglifyJS.git with binaries:",
    "  - uglifyjs",
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toEqual([]);
  expect(requested).toBe(0);
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    version: "0.0.1",
    dependencies: {
      "uglify-js": "bun@github.com:mishoo/UglifyJS.git",
    },
  });
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify-js"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toEqual(["uglifyjs"]);
  expect(await readlink(join(package_dir, "node_modules", ".bin", "uglifyjs"))).toBe(
    join("..", "uglify-js", "bin", "uglifyjs"),
  );
  expect((await readdirSorted(join(package_dir, "node_modules", ".cache")))[0]).toBe("9d05c118f06c3b4c.git");
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
  expect(requested).toBe(0);
});

it("should prefer optionalDependencies over dependencies of the same name", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.2": {
        dependencies: {
          baz: "0.0.3",
        },
        optionalDependencies: {
          baz: "0.0.5",
        },
      },
      "0.0.3": {},
      "0.0.5": {},
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "bar@0.0.2"],
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
    " installed bar@0.0.2",
    "",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/bar`,
    `${root_url}/bar-0.0.2.tgz`,
    `${root_url}/baz`,
    `${root_url}/baz-0.0.5.tgz`,
  ]);
  expect(requested).toBe(4);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.5",
    bin: {
      "baz-exec": "index.js",
    },
  });
});

it("should prefer dependencies over peerDependencies of the same name", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.0.2": {
        dependencies: {
          baz: "0.0.3",
        },
        peerDependencies: {
          baz: "0.0.5",
        },
      },
      "0.0.3": {},
      "0.0.5": {},
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "bar@0.0.2"],
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
    " installed bar@0.0.2",
    "",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/bar`,
    `${root_url}/bar-0.0.2.tgz`,
    `${root_url}/baz`,
    `${root_url}/baz-0.0.3.tgz`,
  ]);
  expect(requested).toBe(4);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
});
