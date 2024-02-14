// @known-failing-on-windows: 1 failing
import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv as env, toHaveBins, toBeValidBin, toBeWorkspaceLink, ospath } from "harness";
import { access, mkdir, mkdtemp, readlink, realpath, rm, writeFile, copyFile, appendFile } from "fs/promises";
import { join, relative, normalize, win32 } from "path";
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

expect.extend({
  toHaveBins,
  toBeValidBin,
  toBeWorkspaceLink,
});

let port: string;
let add_dir: string;
beforeAll(() => {
  port = new URL(root_url).port;
});

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
  const dep = `file:${add_path}`.replace(/\\/g, "\\\\");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", dep],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("bun add");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    ` installed foo@${add_path}`,
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "bar",
        version: "0.0.2",
        dependencies: {
          foo: dep.replace(/\\\\/g, "\\"),
        },
      },
      null,
      2,
    ),
  );
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
  const dep = `file:${add_path}`.replace(/\\/g, "\\\\");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", dep],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("bun add");
  expect(err).toContain("error: MissingPackageJSON");
  expect(err).toContain(`note: error occured while resolving ${dep}`);

  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toBe("");
  expect(await exited).toBe(1);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );
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
  const dep = `file://${add_path}`.replace(/\\/g, "\\\\");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", dep],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("bun add");
  expect(err).toContain("error: MissingPackageJSON");
  expect(err).toContain(`note: error occured while resolving ${dep}`);

  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toBe("");
  expect(await exited).toBe(1);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );
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
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "1.2.3"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain(`error: package "1.2.3" not found localhost:${port}/1.2.3 404`);
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
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
  expect(err.split(/\r?\n/)).toContain(`error: package "@bar/baz" not found localhost:${port}/@bar%2fbaz 404`);
  expect(stdout).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  expect(await exited).toBe(1);
  expect(urls.sort()).toEqual([`${root_url}/@bar%2fbaz`]);
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
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "BaR"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed BaR@0.0.2",
    "",
    " 1 package installed",
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
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          BaR: "^0.0.2",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
});

it("should add exact version with --exact", async () => {
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
    cmd: [bunExe(), "add", "--exact", "BaR"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed BaR@0.0.2",
    "",
    " 1 package installed",
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
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          BaR: "0.0.2",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
});

it("should add exact version with install.exact", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  await appendFile(join(package_dir, "bunfig.toml"), `exact = true\n`);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "BaR"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed BaR@0.0.2",
    "",
    " 1 package installed",
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
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          BaR: "0.0.2",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
});

it("should add exact version with -E", async () => {
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
    cmd: [bunExe(), "add", "-E", "BaR"],
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
    " installed BaR@0.0.2",
    "",
    " 1 package installed",
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
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          BaR: "0.0.2",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
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
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "baz@~0.0.2"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed baz@0.0.3 with binaries:",
    "  - baz-run",
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
  expect(join(package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          baz: "~0.0.2",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
});

it("should add dependency (GitHub)", async () => {
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
    cmd: [bunExe(), "add", "mishoo/UglifyJS#v3.14.1"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed uglify-js@github:mishoo/UglifyJS#e219a9a with binaries:",
    "  - uglifyjs",
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toBeEmpty();
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify-js"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual(["@GH@mishoo-UglifyJS-e219a9a"]);
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
  expect(package_json.version).toBe("3.14.1");
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "uglify-js": "mishoo/UglifyJS#v3.14.1",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
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
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "baz"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    ospath(" + bar@workspace:packages/bar"),
    "",
    " installed baz@0.0.3 with binaries:",
    "  - baz-run",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
  expect(join(package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
  expect(await readlink(join(package_dir, "node_modules", "bar"))).toBeWorkspaceLink(join("..", "packages", "bar"));
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  //TODO: format array literals in JSON correctly
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        workspaces: ["packages/*"],
        dependencies: {
          baz: "^0.0.3",
        },
      },
      null,
      2,
    ).replace(/(\[)\s+|\s+(\])/g, "$1$2"),
  );
  await access(join(package_dir, "bun.lockb"));
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
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "bar@npm:baz@~0.0.2"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed bar@0.0.3 with binaries:",
    "  - baz-run",
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
  expect(join(package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "bar", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          bar: "npm:baz@~0.0.2",
        },
      },
      null,
      2,
    ),
  );
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
    cmd: [bunExe(), "add", "uglify@mishoo/UglifyJS#v3.14.1"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed uglify@github:mishoo/UglifyJS#e219a9a with binaries:",
    "  - uglifyjs",
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toBeEmpty();
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
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
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          uglify: "mishoo/UglifyJS#v3.14.1",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
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
  expect(err1).not.toContain("error:");
  expect(err1).toContain("Saved lockfile");
  expect(stdout1).toBeDefined();
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed baz@0.0.3",
    "",
    " 1 package installed",
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
  //TODO: fix JSON formatting
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "Foo",
        version: "0.0.1",
        dependencies: {
          baz: "0.0.3",
        },
      },
      null,
      2,
    ).replace(/\r?\n\s*/g, " "),
  );
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
  expect(err2).not.toContain("error:");
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
  //TODO: fix JSON formatting
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "Foo",
        version: "0.0.1",
        dependencies: {
          baz: "^0.0.3",
        },
      },
      null,
      2,
    ).replace(/\r?\n\s*/g, " "),
  );
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
  const out1 = await new Response(stdout1).text();

  expect(err1).not.toContain("error:");
  expect(err1).toContain("Saved lockfile");
  expect(stdout1).toBeDefined();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed baz@0.0.3",
    "",
    " 1 package installed",
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
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          baz: "^0.0.3",
        },
      },
      null,
      2,
    ),
  );
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
  expect(err2).not.toContain("error:");
  expect(err2).toContain("Saved lockfile");
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + baz@0.0.3",
    "",
    " 1 package installed",
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
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          baz: "^0.0.3",
        },
      },
      null,
      2,
    ),
  );
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
  expect(err1).not.toContain("error:");
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
    " 1 package installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toBeEmpty();
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify-js"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
  expect(join(package_dir, "node_modules", ".bin", "uglifyjs")).toBeValidBin(
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
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "uglify-js": "bun@github.com:mishoo/UglifyJS.git",
        },
      },
      null,
      2,
    ),
  );
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
  expect(err2).not.toContain("error:");
  expect(err2).not.toContain("Saved lockfile");
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "Checked 1 install across 2 packages (no changes)",
  ]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toBeEmpty();
  expect(requested).toBe(0);
}, 20000);

it("should not save git urls twice", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const { exited: exited1 } = spawn({
    cmd: [bunExe(), "add", "https://github.com/liz3/empty-bun-repo"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(await exited1).toBe(0);

  const package_json_content = await file(join(package_dir, "package.json")).json();
  expect(package_json_content.dependencies).toEqual({
    "test-repo": "https://github.com/liz3/empty-bun-repo",
  });

  const { exited: exited2 } = spawn({
    cmd: [bunExe(), "add", "https://github.com/liz3/empty-bun-repo"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(await exited2).toBe(0);

  const package_json_content2 = await file(join(package_dir, "package.json")).json();
  expect(package_json_content2.dependencies).toEqual({
    "test-repo": "https://github.com/liz3/empty-bun-repo",
  });
}, 20000);

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
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed bar@0.0.2",
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
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed bar@0.0.2",
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

it("should add dependency without duplication", async () => {
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
    cmd: [bunExe(), "add", "bar"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).not.toContain("error:");
  expect(err1).toContain("Saved lockfile");
  expect(stdout1).toBeDefined();
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed bar@0.0.2",
    "",
    " 1 package installed",
  ]);
  expect(await exited1).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          bar: "^0.0.2",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
  // repeat installation
  urls.length = 0;
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "add", "bar"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  expect(stdout2).toBeDefined();

  const err2 = await new Response(stderr2).text();
  const out2 = await new Response(stdout2).text();

  expect(err2).not.toContain("error:");

  // The meta-hash didn't change, but we do save everytime you do "bun add <package>".
  expect(err2).toContain("Saved lockfile");

  expect(out2.replace(/\s*\[[0-9\.]+m?s\] done\s*$/, "").split(/\r?\n/)).toEqual(["", " installed bar@0.0.2"]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toBeEmpty();
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "bar"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bar"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          bar: "^0.0.2",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
});

it("should add dependency without duplication (GitHub)", async () => {
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
    cmd: [bunExe(), "add", "mishoo/UglifyJS#v3.14.1"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).not.toContain("error:");
  expect(err1).toContain("Saved lockfile");
  expect(stdout1).toBeDefined();
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed uglify-js@github:mishoo/UglifyJS#e219a9a with binaries:",
    "  - uglifyjs",
    "",
    " 1 package installed",
  ]);
  expect(await exited1).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify-js"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual(["@GH@mishoo-UglifyJS-e219a9a"]);
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
  const package_json1 = await file(join(package_dir, "node_modules", "uglify-js", "package.json")).json();
  expect(package_json1.name).toBe("uglify-js");
  expect(package_json1.version).toBe("3.14.1");
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "uglify-js": "mishoo/UglifyJS#v3.14.1",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
  // repeat installation
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "add", "mishoo/UglifyJS#v3.14.1"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("error:");

  // The meta-hash didn't change, but we do save everytime you do "bun add <package>".
  expect(err2).toContain("Saved lockfile");

  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\] done\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed uglify-js@github:mishoo/UglifyJS#e219a9a with binaries:",
    "  - uglifyjs",
  ]);
  expect(await exited2).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify-js"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual(["@GH@mishoo-UglifyJS-e219a9a"]);
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
  const package_json2 = await file(join(package_dir, "node_modules", "uglify-js", "package.json")).json();
  expect(package_json2.name).toBe("uglify-js");
  expect(package_json2.version).toBe("3.14.1");
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "uglify-js": "mishoo/UglifyJS#v3.14.1",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
});

it("should add dependencies to workspaces directly", async () => {
  const foo_package = JSON.stringify({
    name: "foo",
    version: "0.1.0",
    workspaces: ["moo"],
  });
  await writeFile(join(add_dir, "package.json"), foo_package);
  const bar_package = JSON.stringify({
    name: "bar",
    version: "0.2.0",
    workspaces: ["moo"],
  });
  await writeFile(join(package_dir, "package.json"), bar_package);
  await mkdir(join(package_dir, "moo"));
  await writeFile(
    join(package_dir, "moo", "package.json"),
    JSON.stringify({
      name: "moo",
      version: "0.3.0",
    }),
  );
  await writeFile(join(package_dir, "moo", "bunfig.toml"), await file(join(package_dir, "bunfig.toml")).text());
  const add_path = relative(join(package_dir, "moo"), add_dir);
  const dep = `file:${add_path}`.replace(/\\/g, "\\\\");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", dep],
    cwd: join(package_dir, "moo"),
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    ` installed foo@${relative(package_dir, add_dir)}`,
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(await readdirSorted(join(package_dir))).toEqual([
    "bun.lockb",
    "bunfig.toml",
    "moo",
    "node_modules",
    "package.json",
  ]);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(bar_package);
  expect(await readdirSorted(join(package_dir, "moo"))).toEqual(["bunfig.toml", "package.json"]);
  expect(await file(join(package_dir, "moo", "package.json")).json()).toEqual({
    name: "moo",
    version: "0.3.0",
    dependencies: {
      foo: `file:${add_path}`,
    },
  });
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "foo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "foo"))).toEqual(["package.json"]);
  expect(await file(join(package_dir, "node_modules", "foo", "package.json")).text()).toEqual(foo_package);
});

it("should redirect 'install --save X' to 'add'", async () => {
  await installRedirectsToAdd(true);
});

it("should redirect 'install X --save' to 'add'", async () => {
  await installRedirectsToAdd(false);
});

async function installRedirectsToAdd(saveFlagFirst: boolean) {
  await writeFile(
    join(add_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const add_path = relative(package_dir, add_dir);

  const args = [`file:${add_path}`.replace(/\\/g, "\\\\"), "--save"];
  if (saveFlagFirst) args.reverse();

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", ...args],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("bun add");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    ` installed foo@${add_path}`,
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(package_dir, "package.json")).text()).toInclude("bun-add.test");
}

it("should add dependency alongside peerDependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      peerDependencies: {
        bar: "~0.0.1",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "bar"],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " installed bar@0.0.2",
    "",
    " 1 package installed",
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
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    dependencies: {
      bar: "^0.0.2",
    },
    peerDependencies: {
      bar: "~0.0.1",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("should add local tarball dependency", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const tarball = "baz-0.0.3.tgz";
  const absolutePath = join(__dirname, tarball);
  await copyFile(absolutePath, join(package_dir, tarball));
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", tarball],
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
    " installed baz@baz-0.0.3.tgz with binaries:",
    "  - baz-run",
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toBeEmpty();
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  const package_json = await file(join(package_dir, "node_modules", "baz", "package.json")).json();
  expect(package_json.name).toBe("baz");
  expect(package_json.version).toBe("0.0.3");
  expect(await file(join(package_dir, "package.json")).text()).toInclude('"baz-0.0.3.tgz"'),
    await access(join(package_dir, "bun.lockb"));
});
