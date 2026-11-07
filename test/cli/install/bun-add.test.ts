import type { BunLockFile } from "bun";
import { $, file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { randomBytes } from "crypto";
import { access, appendFile, copyFile, mkdir, readlink, rm, writeFile } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  hostedGitRepository,
  isWindows,
  readdirSorted,
  tempDir,
  tmpdirSync,
  toBeValidBin,
  toBeWorkspaceLink,
  toHaveBins,
} from "harness";
import { createServer } from "http";
import type { AddressInfo } from "net";
import { basename, join, relative, resolve } from "path";
import { pathToFileURL } from "url";
import {
  check_npm_auth_type,
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  requested,
  root_url,
  setGithubRepository,
  setHandler,
  setUglifyJsRepository,
  uglifyJsRepositoryFiles,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

// The `owner/repo#ref` dependencies below are downloaded from GITHUB_API_URL. The tests that
// add them run with it set to the dummy registry, which serves these stand-ins for the real
// repositories. Each one has the files and package.json fields the tests look at.
beforeAll(async () => {
  await Promise.all([
    setUglifyJsRepository(),
    setGithubRepository("dylan-conway", "install-test-3", "db5a426", ["v1.0.0"], {
      "index.js": "",
    }),
    setGithubRepository("dylan-conway", "install-test-3", "b67a409", ["v1.0.1"], {
      "index.js": "",
      "package.json": JSON.stringify({ description: "hi" }),
    }),
    setGithubRepository("dylan-conway", "install-test-3", "506300a", ["v1.0.2"], {
      "index.js": "",
      "package.json": JSON.stringify({ name: "", description: "hi" }),
    }),
    setGithubRepository("liz3", "empty-bun-repo", "26049f7", [""], {
      "index.ts": "",
      "package.json": JSON.stringify({ name: "test-repo", module: "index.ts", type: "module" }),
    }),
  ]);
});
function githubEnv() {
  return { ...env, GITHUB_API_URL: root_url };
}

expect.extend({
  toHaveBins,
  toBeValidBin,
  toBeWorkspaceLink,
});

let port: string;
let add_dir: string;
setDefaultTimeout(1000 * 60 * 5);

beforeAll(() => {
  port = new URL(root_url).port;
});

beforeEach(async () => {
  add_dir = tmpdirSync();
  await dummyBeforeEach({ linker: "hoisted" });
});
afterEach(async () => {
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    `installed foo@${add_path.replace(/\\/g, "/")}`,
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "bar",
        version: "0.0.2",
        dependencies: {
          foo: dep.replace(/\\\\/g, "/"),
        },
      },
      null,
      2,
    ),
  );
});

it("should add a folder whose package.json has no name under the folder's name", async () => {
  // Used to be added as `"": "file:..."` and then fail to install anywhere.
  const pkg_dir = join(add_dir, "pkg-without-name");
  await mkdir(pkg_dir);
  await writeFile(join(pkg_dir, "package.json"), JSON.stringify({ version: "0.0.1" }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );
  const add_path = relative(package_dir, pkg_dir).replace(/\\/g, "/");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", `file:${add_path}`],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(err).not.toContain("warn:");
  expect(err).toContain("Saved lockfile");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    `installed pkg-without-name@${add_path}`,
    "",
    "1 package installed",
  ]);
  expect(exitCode).toBe(0);
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
    dependencies: {
      "pkg-without-name": `file:${add_path}`,
    },
  });
  expect(await file(join(package_dir, "node_modules", "pkg-without-name", "package.json")).json()).toEqual({
    version: "0.0.1",
  });
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  // The path is reported the way bun.lock records it: forward slashes on every platform.
  expect(err).toContain(`error: package.json not found for "file:${add_path.replaceAll("\\", "/")}" dependency`);
  expect(err).toContain("failed to resolve");

  const out = await stdout.text();
  expect(out).toEqual(expect.stringContaining("bun add v1."));
  expect(await exited).toBe(1);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );
});

it("bun add --only-missing should not install existing package", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );

  // First time: install succesfully.
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "--only-missing", "bar"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed bar@0.0.2",
    "",
    "1 package installed",
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

  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "bar", "--only-missing"],
      cwd: package_dir,
      env,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).not.toContain("Saved lockfile");
    expect(out).not.toContain("installed");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toStrictEqual([
      expect.stringContaining("bun add v" + Bun.version.replaceAll("-debug", "")),
      "",
      "Checked 1 install across 2 packages (no changes)",
    ]);
    expect(exitCode).toBe(0);
  }
});

// Writes `source` to entry-point.ts and returns what `bun <command> --analyze` adds to package.json. `urls` collects
// its registry requests.
async function analyze(
  command: "add" | "install",
  source: string,
  { packageJson = { name: "foo" }, urls = [] }: { packageJson?: object; urls?: string[] } = {},
) {
  setHandler(dummyRegistry(urls));
  await writeFile(join(package_dir, "package.json"), JSON.stringify({ version: "0.0.1", ...packageJson }));
  await writeFile(join(package_dir, "entry-point.ts"), source);
  // The registry has no tarball for most of these names.
  await using proc = spawn({
    cmd: [bunExe(), command, "--analyze", "--lockfile-only", "./entry-point.ts"],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { dependencies = {} } = await file(join(package_dir, "package.json")).json();
  return {
    added: Object.keys(dependencies).sort(),
    errors: err.split("\n").filter(l => l.includes("error")),
    exitCode,
  };
}

it.each(["add", "install"] as const)(
  "bun %s --analyze adds the package that a subpath is imported from",
  async command => {
    expect(
      await analyze(
        command,
        `
      import "bar";
      import debounce from "lodash/debounce";
      import "deep/a/b.js";
      import "styles/dist/main.css";
      import "@scope/pkg/button";
      export * from "re-exported/sub";
      const { createRoot } = require("react-dom/client");
      import("dynamic/sub");
      import "twice";
      import "twice/sub";
      console.log(debounce, createRoot);
      `,
      ),
    ).toEqual({
      added: ["@scope/pkg", "bar", "deep", "dynamic", "lodash", "re-exported", "react-dom", "styles", "twice"],
      errors: [],
      exitCode: 0,
    });
  },
);

it("bun add --analyze leaves out builtins, paths and aliases, with or without a subpath", async () => {
  expect(
    await analyze(
      "add",
      `
      import "bar/sub";
      import "fs/promises";
      import "fs/not-a-builtin";
      import "node:path/posix";
      import "bun:sqlite";
      import "bun/sub";
      import "@/alias";
      import "@/components/ui/button";
      import "~/alias";
      import "#internal/thing";
      import "./missing/file";
      import "/missing/file";
      import "https://example.com/mod/x.js";
      `,
    ),
  ).toEqual({ added: ["bar"], errors: [], exitCode: 0 });
});

it("bun add --analyze does not add the package that the rest of a bun: specifier names", async () => {
  const urls: string[] = [];
  // "#!/usr/bin/env bun" makes this a file for bun.
  expect(await analyze("add", `#!/usr/bin/env bun\nimport "bun:boba"; import "bar/sub";`, { urls })).toEqual({
    added: ["bar"],
    errors: [],
    exitCode: 0,
  });
  expect(urls).toEqual([`${root_url}/bar`]);
});

it.each([
  ["billing", "billing"],
  ["billing", "billing/sub"],
  ["@corp/billing", "@corp/billing"],
  ["@corp/billing", "@corp/billing/sub"],
])("bun add --analyze in %s neither adds nor looks up %s", async (name, specifier) => {
  const urls: string[] = [];
  const packageJson = { name, exports: { ".": "./index.js", "./sub": "./sub.js" } };
  expect(await analyze("add", `import "${specifier}"; import "bar/sub";`, { packageJson, urls })).toEqual({
    added: ["bar"],
    errors: [],
    exitCode: 0,
  });
  expect(urls).toEqual([`${root_url}/bar`]);
});

it("bun add --analyze uses the nearest package.json with a name above the importing file", async () => {
  const urls: string[] = [];
  const member = join(package_dir, "packages", "member");
  await mkdir(join(member, "nested"), { recursive: true });
  await writeFile(join(member, "package.json"), JSON.stringify({ name: "@corp/member", version: "0.0.1" }));
  await writeFile(join(member, "index.ts"), `import "@corp/member/sub"; import "./nested/index.ts";`);
  await writeFile(join(member, "nested", "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(member, "nested", "index.ts"), `import "@corp/member"; import "bar/sub";`);
  expect(
    await analyze("add", `import "./packages/member/index.ts";`, {
      packageJson: { name: "root", workspaces: ["packages/*"] },
      urls,
    }),
  ).toEqual({ added: ["bar"], errors: [], exitCode: 0 });
  expect(urls).toEqual([`${root_url}/bar`]);
});

it("bun add --analyze should scan dependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  await writeFile(join(package_dir, "entry-point.ts"), `import "./local-file.ts";`);
  await writeFile(join(package_dir, "local-file.ts"), `export * from "bar";`);
  console.log(package_dir);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "./entry-point.ts", "--analyze"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed bar@0.0.2",
    "",
    "1 package installed",
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

  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", "bar", "--only-missing"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).not.toContain("Saved lockfile");
    expect(out).not.toContain("installed");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toStrictEqual([
      expect.stringContaining("bun add v" + Bun.version.replaceAll("-debug", "")),
      "",
      "Checked 1 install across 2 packages (no changes)",
    ]);
    expect(exitCode).toBe(0);
  }
});

for (const pathType of ["absolute", "relative"]) {
  it.each(["file:///", "file://", "file:/", "file:", "", "//////"])(
    `should accept ${pathType} file protocol with prefix "%s"`,
    async protocolPrefix => {
      await writeFile(
        join(add_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
        }),
      );
      await writeFile(
        join(package_dir, "package.json"),
        JSON.stringify({
          name: "bar",
          version: "2.3.4",
        }),
      );

      const add_path_rel = relative(package_dir, add_dir);
      const add_path_abs = add_dir;

      const add_dep = `${protocolPrefix}${pathType == "relative" && protocolPrefix != "//////" ? add_path_rel : add_path_abs}`;

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "add", add_dep],
        cwd: package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun add v1."),
        "",
        `installed foo@${add_path_rel.replace(/\\/g, "/")}`,
        "",
        "1 package installed",
      ]);

      expect(await exited).toBe(0);
    },
  );
}

it.each(["fileblah://"])("should reject invalid path without segfault: %s", async protocolPrefix => {
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
  const add_path = relative(package_dir, add_dir).replace(/\\/g, "\\\\");
  const dep = `${protocolPrefix}${add_path}`;
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", dep],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).toContain(`error: unrecognised dependency format: ${dep}`);

  const out = await stdout.text();
  expect(out).toEqual(expect.stringContaining("bun add v1."));
  expect(await exited).toBe(1);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );
});

it("should reject positionals longer than 2048 bytes without stack overflow", async () => {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );
  // Previously the spec normalizer wrote the full positional into a 2048-byte
  // stack buffer with no bounds check, smashing the stack in ReleaseFast and
  // tripping ASAN in debug builds.
  const dep = Buffer.alloc(8000, "a").toString();
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", dep],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).toContain(`error: unrecognised dependency format: ${dep}`);

  const out = await stdout.text();
  expect(out).toEqual(expect.stringContaining("bun add v1."));
  expect(await exited).toBe(1);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify({
      name: "bar",
      version: "0.0.2",
    }),
  );
});

// PATH_MAX is 4096 on Linux and 1024 on macOS. Windows' path buffer is larger than any command line.
it.skipIf(isWindows)("should fail with ENAMETOOLONG for a local tarball path longer than PATH_MAX", async () => {
  const package_json = JSON.stringify({ name: "foo", version: "0.0.1" });
  using dir = tempDir("bun-add-long-tarball-path", { "package.json": package_json });
  const tarball = `./${Buffer.alloc(5000, "a").toString()}.tgz`;
  await using proc = spawn({
    cmd: [bunExe(), "add", tarball],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toContain(`error: ENAMETOOLONG extracting tarball from ${tarball}`);
  expect(out).not.toContain("installed");
  expect(await file(join(String(dir), "package.json")).text()).toBe(package_json);
  expect(exitCode).toBe(1);
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err.split(/\r?\n/)).toContain(`error: GET http://localhost:${port}/1.2.3 - 404`);
  expect(await stdout.text()).toEqual(expect.stringContaining("bun add v1."));
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err.split(/\r?\n/)).toContain(`error: GET http://localhost:${port}/@bar%2fbaz - 404`);
  expect(await stdout.text()).toEqual(expect.stringContaining("bun add v1."));
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed BaR@0.0.2",
    "",
    "1 package installed",
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed BaR@0.0.2",
    "",
    "1 package installed",
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
it("should add to devDependencies with --dev", async () => {
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
    cmd: [bunExe(), "add", "--dev", "BaR"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed BaR@0.0.2",
    "",
    "1 package installed",
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
        devDependencies: {
          BaR: "^0.0.2",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
});
it("should add to optionalDependencies with --optional", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  console.log(package_dir);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "--optional", "BaR"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed BaR@0.0.2",
    "",
    "1 package installed",
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
        optionalDependencies: {
          BaR: "^0.0.2",
        },
      },
      null,
      2,
    ),
  );
  await access(join(package_dir, "bun.lockb"));
});
it("should add to peerDependencies with --peer", async () => {
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
    cmd: [bunExe(), "add", "--peer", "BaR"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed BaR@0.0.2",
    "",
    "1 package installed",
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
        peerDependencies: {
          BaR: "^0.0.2",
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed BaR@0.0.2",
    "",
    "1 package installed",
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed BaR@0.0.2",
    "",
    "1 package installed",
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

it.each([
  ["-E", "0"],
  ["-E", "^0.0.2"],
  ["-E", "~0.0.1"],
  ["-E", "0.x"],
  ["-E", ">=0.0.1"],
  ["-E", "*"],
  ["install.exact", "^0.0.2"],
])("%s pins the version that BaR@%s resolves to", async (how, range) => {
  setHandler(dummyRegistry([]));
  await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));
  if (how === "install.exact") await appendFile(join(package_dir, "bunfig.toml"), `exact = true\n`);
  await using proc = spawn({
    cmd: [bunExe(), "add", "--save-text-lockfile", ...(how === "-E" ? ["-E"] : []), `BaR@${range}`],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).not.toContain("error:");
  expect(out).toContain("installed BaR@0.0.2\n");
  expect((await file(join(package_dir, "package.json")).json()).dependencies).toEqual({ BaR: "0.0.2" });
  const lockfile = Bun.JSONC.parse(await file(join(package_dir, "bun.lock")).text()) as BunLockFile;
  expect(lockfile.workspaces[""].dependencies).toEqual({ BaR: "0.0.2" });
  expect(exitCode).toBe(0);
});

it("should add dependency with package.json in it and http tarball", async () => {
  const old_check_npm_auth_type = check_npm_auth_type.check;
  check_npm_auth_type.check = false;
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      if (req.headers.get("Authorization")) {
        return new Response("bad request", { status: 400 });
      }

      return new Response(Bun.file(join(__dirname, "baz-0.0.3.tgz")));
    },
  });
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
        booop: `${server.url.href}booop-0.0.1.tgz`,
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "bap@npm:baz@0.0.5"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      "BUN_CONFIG_TOKEN": "npm_******",
    },
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    expect.stringContaining("+ booop@http://"),
    "",
    "installed bap@npm:baz@0.0.5 with binaries:",
    " - baz-run",
    "",
    "2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.5.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "bap", "booop"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "bap"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "bap", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.5",
    bin: {
      "baz-exec": "index.js",
    },
  });
  expect(await file(join(package_dir, "package.json")).json()).toStrictEqual({
    name: "foo",
    version: "0.0.1",
    dependencies: {
      bap: "npm:baz@0.0.5",
      booop: `${server.url.href}booop-0.0.1.tgz`,
    },
  });
  await access(join(package_dir, "bun.lockb"));
  // Reset to old value for other tests
  check_npm_auth_type.check = old_check_npm_auth_type;
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed baz@0.0.3 with binaries:",
    " - baz-run",
    "",
    "1 package installed",
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

// https://github.com/oven-sh/bun/issues/19065
it.each([
  // `2x` used to be the range `2.x`, which no version here satisfies.
  { spec: "2x", resolves: "0.0.3", saved: "^0.0.3" },
  // `0x` used to be `0.x`, which picked 0.0.5 and not the tagged version.
  { spec: "0x", resolves: "0.0.3", saved: "^0.0.3" },
  { spec: "v2x", resolves: "0.0.3", saved: "^0.0.3" },
  // still ranges, which pick the highest match
  { spec: "0.x", resolves: "0.0.5", saved: "0.x" },
  { spec: "v0.x", resolves: "0.0.5", saved: "v0.x" },
  // `||` is always range syntax, also when the first alternative looks like a dist-tag
  { spec: "2x || 0", resolves: "0.0.5", saved: "2x || 0" },
])("should add dependency with digit-prefixed specifier $spec", async ({ spec, resolves, saved }) => {
  setHandler(async request => {
    const url = request.url.replaceAll("%2f", "/");
    if (url.endsWith(".tgz")) {
      return new Response(file(join(import.meta.dir, url.slice(url.lastIndexOf("/") + 1))));
    }
    return Response.json({
      name: "baz",
      versions: {
        "0.0.3": { name: "baz", version: "0.0.3", dist: { tarball: `${root_url}/baz-0.0.3.tgz` } },
        "0.0.5": { name: "baz", version: "0.0.5", dist: { tarball: `${root_url}/baz-0.0.5.tgz` } },
      },
      "dist-tags": { latest: "0.0.5", "2x": "0.0.3", "0x": "0.0.3", "v2x": "0.0.3" },
    });
  });
  await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", `baz@${spec}`],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(out).toContain(`installed baz@${resolves}`);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
    name: "baz",
    version: resolves,
  });
  expect((await file(join(package_dir, "package.json")).json()).dependencies).toEqual({ baz: saved });
  expect(exitCode).toBe(0);
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: githubEnv(),
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed uglify-js@github:mishoo/UglifyJS#e219a9a with binaries:",
    " - uglifyjs",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toBeEmpty();
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify-js"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual(["@GH@mishoo-UglifyJS-e219a9a@@@1"]);
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
      "dependencies": {
        "bar": "workspace:*",
      },
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
    cmd: [bunExe(), "add", "baz", "--linker=isolated"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed baz@0.0.3 with binaries:",
    " - baz-run",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".bun", ".cache", "bar", "baz"]);
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
          bar: "workspace:*",
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed bar@npm:baz@0.0.3 with binaries:",
    " - baz-run",
    "",
    "1 package installed",
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

it("should print the npm: alias for an added aliased dependency without binaries", async () => {
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
    cmd: [bunExe(), "add", "not-bar@npm:bar"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toStrictEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed not-bar@npm:bar@0.0.2",
    "",
    "1 package installed",
  ]);
  expect(exitCode).toBe(0);
  expect(urls.sort()).toStrictEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toStrictEqual([".cache", "not-bar"]);
  expect(await file(join(package_dir, "node_modules", "not-bar", "package.json")).json()).toStrictEqual({
    name: "bar",
    version: "0.0.2",
  });
  expect(await file(join(package_dir, "package.json")).json()).toStrictEqual({
    name: "foo",
    version: "0.0.1",
    dependencies: {
      "not-bar": "npm:bar@^0.0.2",
    },
  });
});

describe("npm aliases", () => {
  type TestCase = {
    args: string[];
    resolved: { name: string; version: string; tarballVersion?: string; binaries?: boolean };
    expected: Omit<BunLockFile["workspaces"][string], "name">;
  };
  const packageJSON = { name: "foo", version: "0.0.1" };
  const registryVersions = {
    "0.0.3": { bin: { "baz-run": "index.js" } },
    "0.0.5-rc.123456789": { as: "0.0.5" },
    latest: "0.0.3",
  };
  let urls: string[];

  beforeEach(async () => {
    urls = [];
    const registry = dummyRegistry(urls, registryVersions);
    setHandler(async request => {
      const response = await registry(request);
      if (request.url.endsWith(".tgz")) return response;
      const manifest: any = await response.json();
      manifest["dist-tags"].rc = "0.0.5-rc.123456789";
      return Response.json(manifest);
    });
    await writeFile(join(package_dir, "package.json"), JSON.stringify(packageJSON));
  });

  const scoped = { name: "@scope/baz", version: "0.0.3", binaries: true };
  const testCases: TestCase[] = [
    {
      args: ["format@npm:baz"],
      resolved: { name: "baz", version: "0.0.3", binaries: true },
      expected: { dependencies: { format: "npm:baz@^0.0.3" } },
    },
    {
      args: ["bar@npm:@scope/baz"],
      resolved: scoped,
      expected: { dependencies: { bar: "npm:@scope/baz@^0.0.3" } },
    },
    {
      args: ["bar@npm:@scope/baz@latest"],
      resolved: scoped,
      expected: { dependencies: { bar: "npm:@scope/baz@^0.0.3" } },
    },
    {
      args: ["bar@npm:@scope/baz@rc"],
      resolved: { name: "@scope/baz", version: "0.0.5-rc.123456789", tarballVersion: "0.0.5" },
      expected: { dependencies: { bar: "npm:@scope/baz@^0.0.5-rc.123456789" } },
    },
    {
      args: ["--exact", "bar@npm:@scope/baz"],
      resolved: scoped,
      expected: { dependencies: { bar: "npm:@scope/baz@0.0.3" } },
    },
    {
      args: ["bar@npm:@scope/baz@0.0.3"],
      resolved: scoped,
      expected: { dependencies: { bar: "npm:@scope/baz@0.0.3" } },
    },
    {
      args: ["bar@npm:@scope/baz@^0.0.3"],
      resolved: scoped,
      expected: { dependencies: { bar: "npm:@scope/baz@^0.0.3" } },
    },
    {
      args: ["bar@npm:@scope/baz@~0.0.2"],
      resolved: scoped,
      expected: { dependencies: { bar: "npm:@scope/baz@~0.0.2" } },
    },
    {
      args: ["bar@npm:@scope/baz@>=0.0.2"],
      resolved: scoped,
      expected: { dependencies: { bar: "npm:@scope/baz@>=0.0.2" } },
    },
    {
      args: ["--exact", "bar@npm:@scope/baz@>=0.0.2"],
      resolved: scoped,
      expected: { dependencies: { bar: "npm:@scope/baz@0.0.3" } },
    },
    {
      args: ["--dev", "bar@npm:@scope/baz"],
      resolved: scoped,
      expected: { devDependencies: { bar: "npm:@scope/baz@^0.0.3" } },
    },
    {
      args: ["--optional", "bar@npm:@scope/baz"],
      resolved: scoped,
      expected: { optionalDependencies: { bar: "npm:@scope/baz@^0.0.3" } },
    },
    {
      args: ["--peer", "bar@npm:@scope/baz"],
      resolved: scoped,
      expected: { peerDependencies: { bar: "npm:@scope/baz@^0.0.3" } },
    },
  ];

  test.each(testCases.map(testCase => ({ ...testCase, command: `bun add ${testCase.args.join(" ")}` })))(
    "$command",
    async ({ args, resolved, expected }) => {
      const [section] = Object.values(expected) as Record<string, string>[];
      const [alias] = Object.keys(section);

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "add", "--save-text-lockfile", ...args],
        cwd: package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      expect(out).toContain(
        `installed ${alias}@npm:${resolved.name}@${resolved.version}${resolved.binaries ? " with binaries:" : ""}\n`,
      );
      expect(exitCode).toBe(0);
      expect(urls.sort()).toStrictEqual([
        `${root_url}/${resolved.name.replace("/", "%2f")}`,
        `${root_url}/${resolved.name}-${resolved.tarballVersion ?? resolved.version}.tgz`,
      ]);
      expect(await file(join(package_dir, "package.json")).json()).toStrictEqual({ ...packageJSON, ...expected });

      const lockfileText = await file(join(package_dir, "bun.lock")).text();
      const lockfile = Bun.JSONC.parse(lockfileText) as BunLockFile;
      expect(lockfile.workspaces[""]).toStrictEqual({ name: packageJSON.name, ...expected });
      expect(lockfile.packages[alias][0]).toBe(`${resolved.name}@${resolved.version}`);

      const frozen = spawn({
        cmd: [bunExe(), "install", "--frozen-lockfile"],
        cwd: package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const [, frozenErr, frozenExitCode] = await Promise.all([
        frozen.stdout.text(),
        frozen.stderr.text(),
        frozen.exited,
      ]);
      expect(frozenErr).not.toContain("error:");
      expect(frozenExitCode).toBe(0);
      expect(await file(join(package_dir, "bun.lock")).text()).toBe(lockfileText);
    },
  );
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: githubEnv(),
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed uglify@github:mishoo/UglifyJS#e219a9a with binaries:",
    " - uglifyjs",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toBeEmpty();
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual([
    "@GH@mishoo-UglifyJS-e219a9a@@@1",
    "uglify",
  ]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache", "uglify"))).toEqual([
    "mishoo-UglifyJS-e219a9a@@@1",
  ]);
  expect(
    resolve(await readlink(join(package_dir, "node_modules", ".cache", "uglify", "mishoo-UglifyJS-e219a9a@@@1"))),
  ).toBe(join(package_dir, "node_modules", ".cache", "@GH@mishoo-UglifyJS-e219a9a@@@1"));
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

const gitNameTests = [
  { desc: "git dep without package.json", dep: "dylan-conway/install-test-3#v1.0.0" },
  { desc: "git dep with package.json without name", dep: "dylan-conway/install-test-3#v1.0.1" },
  { desc: "git dep with package.json with empty name", dep: "dylan-conway/install-test-3#v1.0.2" },
];
for (const { desc, dep } of gitNameTests) {
  it(desc, async () => {
    await Bun.write(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
      }),
    );

    const { stderr, exited } = spawn({
      cmd: [bunExe(), "add", dep],
      cwd: package_dir,
      stdout: "ignore",
      stderr: "pipe",
      env: githubEnv(),
    });

    const err = await stderr.text();
    expect(err).not.toContain("error:");

    expect(await exited).toBe(0);

    expect(await file(join(package_dir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "install-test-3": dep,
      },
    });
  });
}

// https://github.com/oven-sh/bun/issues/13891
describe("a git URL that is not GitHub's", () => {
  // The clone fails without the network: ssh is `false`, and `:some` is no port number for https.
  async function addAndFailToClone(dep: string) {
    await Bun.write(join(package_dir, "package.json"), JSON.stringify({ name: "foo" }));
    await using proc = spawn({
      cmd: [bunExe(), "add", dep],
      cwd: package_dir,
      stdout: "ignore",
      stderr: "pipe",
      env: { ...env, GIT_SSH_COMMAND: "false", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "false" },
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stderr, exitCode };
  }

  it.each([
    ["mypkg", "git://bun-13891.invalid:some/repo.git"],
    ["mypkg", "git+ssh://bun-13891.invalid:some/repo.git"],
    ["mypkg", "git+ssh://git@bun-13891.invalid:some/repo.git#ref"],
    ["mypkg", "git+file:///bun-13891/repo.git"],
    ["mypkg", "git+https://bun-13891.invalid:some/repo.git"],
    ["@myorg/tool", "git+ssh://bun-13891.invalid:some/repo.git"],
    ["@myorg/tool", "git+https://bun-13891.invalid:some/repo.git"],
  ])("%s@%s keeps its alias", async (name, url) => {
    const { stderr, exitCode } = await addAndFailToClone(`${name}@${url}`);
    expect(stderr).not.toContain("unrecognised dependency format");
    // With the alias dropped, the whole positional is the name.
    expect(stderr).toContain(`"git clone" for "${name}" failed`);
    expect(exitCode).toBe(1);
  });

  // The `git` of `git@host:path` is the ssh user.
  it("an scp-style URL has no alias", async () => {
    const dep = "git@localhost:some/repo.git";
    const { stderr, exitCode } = await addAndFailToClone(dep);
    expect(stderr).not.toContain("unrecognised dependency format");
    expect(stderr).toContain(`"git clone" for "${dep}" failed`);
    expect(exitCode).toBe(1);
  });
});

it("git dep without package.json and with default branch", async () => {
  using repo = await hostedGitRepository(["https://git@github.com/dylan-conway/install-test-no-packagejson"], {
    "index.js": "",
  });
  await Bun.write(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
    }),
  );

  const { stderr, exited } = spawn({
    cmd: [bunExe(), "add", "git@github.com:dylan-conway/install-test-no-packagejson"],
    cwd: package_dir,
    stdout: "ignore",
    stderr: "pipe",
    env: repo.env,
  });

  const err = await stderr.text();
  expect(err).not.toContain("error:");

  expect(await exited).toBe(0);

  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    dependencies: {
      "install-test-no-packagejson": "git@github.com:dylan-conway/install-test-no-packagejson",
    },
  });
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err1 = await new Response(stderr1).text();
  expect(err1).not.toContain("error:");
  expect(err1).toContain("Saved lockfile");
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed baz@0.0.3",
    "",
    "1 package installed",
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
        name: "Foo",
        version: "0.0.1",
        dependencies: {
          baz: "0.0.3",
        },
      },
      null,
      2,
    ),
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("error:");
  expect(err2).toContain("Saved lockfile");
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\[[0-9\.]+m?s\]/, "[]").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed baz@0.0.3",
    "",
    "[] done",
    "",
  ]);
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
  expect(await file(join(package_dir, "package.json")).text()).toEqual(
    JSON.stringify(
      {
        name: "Foo",
        version: "0.0.1",
        devDependencies: {
          baz: "^0.0.3",
        },
      },
      null,
      2,
    ),
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err1 = await new Response(stderr1).text();
  const out1 = await new Response(stdout1).text();

  expect(err1).not.toContain("error:");
  expect(err1).toContain("Saved lockfile");
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed baz@0.0.3",
    "",
    "1 package installed",
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("error:");
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    "+ baz@0.0.3",
    "",
    "1 package installed",
  ]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toEqual([`${root_url}/baz-0.0.3.tgz`]);
  expect(requested).toBe(3);
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
  using repo = await hostedGitRepository(["https://bun@github.com/mishoo/UglifyJS.git"], uglifyJsRepositoryFiles);
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: repo.env,
  });
  const err1 = await new Response(stderr1).text();
  expect(err1).not.toContain("error:");
  expect(err1).toContain("Saved lockfile");
  let out1 = await new Response(stdout1).text();
  out1 = out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "");
  out1 = out1.replace(/(\.git)#[a-f0-9]+/, "$1");
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed uglify-js@git+ssh://***@github.com:mishoo/UglifyJS.git with binaries:",
    " - uglifyjs",
    "",
    "1 package installed",
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: repo.env,
  });
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("error:");
  expect(err2).not.toContain("Saved lockfile");
  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    "Checked 1 install across 2 packages (no changes)",
  ]);
  expect(await exited2).toBe(0);
  expect(urls.sort()).toBeEmpty();
  expect(requested).toBe(0);
});

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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: githubEnv(),
  });

  expect(await exited1).toBe(0);

  const package_json_content = await file(join(package_dir, "package.json")).json();
  expect(package_json_content.dependencies).toEqual({
    "test-repo": "https://github.com/liz3/empty-bun-repo",
  });

  const { exited: exited2 } = spawn({
    cmd: [bunExe(), "add", "https://github.com/liz3/empty-bun-repo"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: githubEnv(),
  });

  expect(await exited2).toBe(0);

  const package_json_content2 = await file(join(package_dir, "package.json")).json();
  expect(package_json_content2.dependencies).toEqual({
    "test-repo": "https://github.com/liz3/empty-bun-repo",
  });
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed bar@0.0.2",
    "",
    "2 packages installed",
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed bar@0.0.2",
    "",
    "2 packages installed",
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err1 = await new Response(stderr1).text();
  expect(err1).not.toContain("error:");
  expect(err1).toContain("Saved lockfile");
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed bar@0.0.2",
    "",
    "1 package installed",
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err2 = await new Response(stderr2).text();
  const out2 = await new Response(stdout2).text();

  expect(err2).not.toContain("error:");

  // Nothing changed, so the identical lockfile is not rewritten.
  expect(err2).not.toContain("Saved lockfile");

  expect(out2.replace(/\s*\[[0-9\.]+m?s\] done\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed bar@0.0.2",
  ]);
  expect(await exited2).toBe(0);
  expect(requested).toBe(3);
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: githubEnv(),
  });
  const err1 = await new Response(stderr1).text();
  expect(err1).not.toContain("error:");
  expect(err1).toContain("Saved lockfile");
  const out1 = await new Response(stdout1).text();
  expect(out1.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed uglify-js@github:mishoo/UglifyJS#e219a9a with binaries:",
    " - uglifyjs",
    "",
    "1 package installed",
  ]);
  expect(await exited1).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify-js"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual(["@GH@mishoo-UglifyJS-e219a9a@@@1"]);
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: githubEnv(),
  });
  const err2 = await new Response(stderr2).text();
  expect(err2).not.toContain("error:");

  // Nothing changed, so the identical lockfile is not rewritten.
  expect(err2).not.toContain("Saved lockfile");

  const out2 = await new Response(stdout2).text();
  expect(out2.replace(/\s*\[[0-9\.]+m?s\] done\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed uglify-js@github:mishoo/UglifyJS#e219a9a with binaries:",
    " - uglifyjs",
  ]);
  expect(await exited2).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "uglify-js"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["uglifyjs"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".cache"))).toEqual(["@GH@mishoo-UglifyJS-e219a9a@@@1"]);
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
  const fooPackage = {
    name: "foo",
    version: "0.1.0",
    workspaces: ["moo"],
  };
  await writeFile(join(add_dir, "package.json"), JSON.stringify(fooPackage));
  const barPackage = JSON.stringify({
    name: "bar",
    version: "0.2.0",
    workspaces: ["moo"],
  });
  await writeFile(join(package_dir, "package.json"), barPackage);
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
  const dep = `file:${add_path}`.replace(/\\/g, "/");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", dep, "--linker=isolated"],
    cwd: join(package_dir, "moo"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    `installed foo@${relative(package_dir, add_dir).replace(/\\/g, "/")}`,
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(await readdirSorted(join(package_dir))).toEqual([
    "bun.lockb",
    "bunfig.toml",
    "moo",
    "node_modules",
    "package.json",
  ]);
  expect(await file(join(package_dir, "package.json")).text()).toEqual(barPackage);
  expect(await readdirSorted(join(package_dir, "moo"))).toEqual(["bunfig.toml", "node_modules", "package.json"]);
  expect(await readdirSorted(join(package_dir, "moo", "node_modules", "foo"))).toEqual(["package.json"]);
  if (process.platform === "win32") {
    expect(await file(join(package_dir, "moo", "node_modules", "foo", "package.json")).json()).toEqual(fooPackage);
  } else {
    expect(await file(join(package_dir, "moo", "node_modules", "foo", "package.json")).json()).toEqual(fooPackage);
  }
  expect(await file(join(package_dir, "moo", "package.json")).json()).toEqual({
    name: "moo",
    version: "0.3.0",
    dependencies: {
      foo: `file:${add_path.replace(/\\/g, "/")}`,
    },
  });
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bun", ".cache"]);
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    `installed foo@${add_path.replace(/\\/g, "/")}`,
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(package_dir, "package.json")).text()).toInclude("bun.test.");
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed bar@0.0.2",
    "",
    "1 package installed",
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
    peerDependencies: {
      bar: "^0.0.2",
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
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed baz@baz-0.0.3.tgz with binaries:",
    " - baz-run",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toBeEmpty();
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual([
    ".bun-tag",
    "index.js",
    "package.json",
  ]);
  const package_json = await file(join(package_dir, "node_modules", "baz", "package.json")).json();
  expect(package_json.name).toBe("baz");
  expect(package_json.version).toBe("0.0.3");
  (expect(await file(join(package_dir, "package.json")).text()).toInclude('"baz-0.0.3.tgz"'),
    await access(join(package_dir, "bun.lockb")));
});

describe("a relative local path typed from a directory below package.json", () => {
  const posix = (path: string) => path.replaceAll("\\", "/");

  async function run(cwd: string, command: "add" | "install", ...positionals: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), command, ...positionals],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // `add_dir` is the local package; `package_dir/src/nested` is the cwd.
  async function makeNestedCwd() {
    await writeFile(join(add_dir, "package.json"), JSON.stringify({ name: "lib", version: "1.0.0" }));
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "app", version: "0.0.1" }));
    const cwd = join(package_dir, "src", "nested");
    await mkdir(cwd, { recursive: true });
    return cwd;
  }

  // `file:/`, `file://` and `file:///` before a `..` path are spellings of `file:`.
  it.each([
    ["add", "", "lib", ""],
    ["add", "file:", "lib", "file:"],
    ["add", "file:/", "lib", "file:"],
    ["add", "file://", "lib", "file:"],
    ["add", "file:///", "lib", "file:"],
    ["add", "mylib@", "mylib", ""],
    ["add", "mylib@file:", "mylib", "file:"],
    ["install", "", "lib", ""],
  ] as const)(
    "bun %s %s<folder> resolves against the cwd and is written relative to package.json",
    async (command, typedPrefix, key, writtenPrefix) => {
      const cwd = await makeNestedCwd();

      const { stdout, stderr, exitCode } = await run(cwd, command, typedPrefix + posix(relative(cwd, add_dir)));
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain(`installed ${key}@`);
      expect(await file(join(package_dir, "package.json")).json()).toEqual({
        name: "app",
        version: "0.0.1",
        dependencies: { [key]: writtenPrefix + posix(relative(package_dir, add_dir)) },
      });
      expect(await file(join(package_dir, "node_modules", key, "package.json")).json()).toEqual({
        name: "lib",
        version: "1.0.0",
      });
      expect(exitCode).toBe(0);
    },
  );

  it.each([
    ["../../vendor/baz-0.0.3.tgz", "./vendor/baz-0.0.3.tgz"],
    ["file:../../vendor/baz-0.0.3.tgz", "file:./vendor/baz-0.0.3.tgz"],
    ["file://../../vendor/baz-0.0.3.tgz", "file:./vendor/baz-0.0.3.tgz"],
  ])("the local tarball %s resolves against the cwd and is written as %s", async (typed, written) => {
    const cwd = await makeNestedCwd();
    await mkdir(join(package_dir, "vendor"));
    await copyFile(join(__dirname, "baz-0.0.3.tgz"), join(package_dir, "vendor", "baz-0.0.3.tgz"));

    const { stdout, stderr, exitCode } = await run(cwd, "add", typed);
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("installed baz@");
    expect(await file(join(package_dir, "package.json")).json()).toEqual({
      name: "app",
      version: "0.0.1",
      dependencies: { baz: written },
    });
    expect((await file(join(package_dir, "node_modules", "baz", "package.json")).json()).version).toBe("0.0.3");
    expect(exitCode).toBe(0);
  });

  it.each([
    ["bar", "lib"],
    ["lib", "bar"],
  ] as const)("a registry package and a folder are both added, in the order typed (%s, %s)", async (...order) => {
    const cwd = await makeNestedCwd();
    setHandler(dummyRegistry([]));
    const positionals = { bar: "bar", lib: posix(relative(cwd, add_dir)) };
    const installed = { bar: "installed bar@0.0.2", lib: `installed lib@${posix(relative(package_dir, add_dir))}` };

    const { stdout, stderr, exitCode } = await run(cwd, "add", ...order.map(name => positionals[name]));
    expect(stderr).not.toContain("error:");
    expect(stdout.split(/\r?\n/).filter(line => line.startsWith("installed "))).toEqual(
      order.map(name => installed[name]),
    );
    expect(await file(join(package_dir, "package.json")).json()).toEqual({
      name: "app",
      version: "0.0.1",
      dependencies: { bar: "^0.0.2", lib: posix(relative(package_dir, add_dir)) },
    });
    expect(exitCode).toBe(0);
  });

  it("the nearest package.json is a workspace member", async () => {
    await writeFile(join(add_dir, "package.json"), JSON.stringify({ name: "lib", version: "1.0.0" }));
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    const member = join(package_dir, "packages", "member");
    const cwd = join(member, "src");
    await mkdir(cwd, { recursive: true });
    await writeFile(join(member, "package.json"), JSON.stringify({ name: "member" }));

    const { stderr, exitCode } = await run(cwd, "add", posix(relative(cwd, add_dir)));
    expect(stderr).not.toContain("error:");
    expect(await file(join(member, "package.json")).json()).toEqual({
      name: "member",
      dependencies: { lib: posix(relative(member, add_dir)) },
    });
    expect(await file(join(package_dir, "package.json")).json()).toEqual({ name: "root", workspaces: ["packages/*"] });
    expect(exitCode).toBe(0);
  });

  // From `package_dir/src`, `../<name>` is `package_dir/<name>`. From `package_dir` it is `add_dir`, another package.
  it("a path that matches one package relative to package.json and another relative to the cwd installs the cwd's", async () => {
    const name = basename(add_dir);
    await writeFile(join(add_dir, "package.json"), JSON.stringify({ name: "lib", version: "1.0.0" }));
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "app", version: "0.0.1" }));
    await mkdir(join(package_dir, name));
    await writeFile(join(package_dir, name, "package.json"), JSON.stringify({ name: "lib", version: "2.0.0" }));
    const cwd = join(package_dir, "src");
    await mkdir(cwd);

    const { stderr, exitCode } = await run(cwd, "add", `../${name}`);
    expect(stderr).not.toContain("error:");
    expect(await file(join(package_dir, "package.json")).json()).toEqual({
      name: "app",
      version: "0.0.1",
      dependencies: { lib: `./${name}` },
    });
    expect(await file(join(package_dir, "node_modules", "lib", "package.json")).json()).toEqual({
      name: "lib",
      version: "2.0.0",
    });
    expect(exitCode).toBe(0);
  });

  it("a path that exists only relative to package.json is not found", async () => {
    const cwd = await makeNestedCwd();
    const vendored = join(package_dir, "vendor", "inner");
    await mkdir(vendored, { recursive: true });
    await writeFile(join(vendored, "package.json"), JSON.stringify({ name: "inner", version: "1.0.0" }));

    const { stderr, exitCode } = await run(cwd, "add", "./vendor/inner");
    expect(stderr).toContain('error: package.json not found for "file:src/nested/vendor/inner"');
    expect(await file(join(package_dir, "package.json")).json()).toEqual({ name: "app", version: "0.0.1" });
    expect(exitCode).toBe(1);
  });

  it("a directory named like a tarball keeps its trailing slash and is added as a folder", async () => {
    const cwd = await makeNestedCwd();
    const vendored = join(package_dir, "vendor", "lib.tgz");
    await mkdir(vendored, { recursive: true });
    await writeFile(join(vendored, "package.json"), JSON.stringify({ name: "lib", version: "3.0.0" }));

    const { stderr, exitCode } = await run(cwd, "add", "../../vendor/lib.tgz/");
    expect(stderr).not.toContain("error:");
    expect(await file(join(package_dir, "package.json")).json()).toEqual({
      name: "app",
      version: "0.0.1",
      dependencies: { lib: "./vendor/lib.tgz/" },
    });
    expect(await file(join(package_dir, "node_modules", "lib", "package.json")).json()).toEqual({
      name: "lib",
      version: "3.0.0",
    });
    expect(exitCode).toBe(0);
  });

  // A Windows command line cannot carry a path longer than the path buffer.
  it.skipIf(isWindows)("a path that does not fit a path buffer once joined with the cwd is an error", async () => {
    const cwd = await makeNestedCwd();
    const typed = "./" + Buffer.alloc(6000, "a").toString();

    const { stderr, exitCode } = await run(cwd, "add", typed);
    expect(stderr).toContain(`error: Dependency "${typed}" has an unsafe folder path`);
    expect(await file(join(package_dir, "package.json")).json()).toEqual({ name: "app", version: "0.0.1" });
    expect(exitCode).toBe(1);
  });

  it.skipIf(isWindows)("a path whose re-spelled form does not fit a path buffer is an error", async () => {
    const app = join(package_dir, "a", "b", "c", "d", "e", "f");
    const cwd = join(app, "src");
    await mkdir(cwd, { recursive: true });
    await writeFile(join(app, "package.json"), JSON.stringify({ name: "app", version: "0.0.1" }));
    // The absolute form fits a path buffer. It does not fit after the `../` segments that lead out of `app`.
    const maxPathBytes = process.platform === "linux" ? 4096 : 1024;
    const name = Buffer.alloc(maxPathBytes - 8 - (add_dir.length + 1), "a").toString();
    const typed = `${posix(relative(cwd, add_dir))}/${name}`;

    const { stderr, exitCode } = await run(cwd, "add", typed);
    expect(stderr).toContain(`error: Dependency "${typed}" has an unsafe folder path`);
    expect(await file(join(app, "package.json")).json()).toEqual({ name: "app", version: "0.0.1" });
    expect(exitCode).toBe(1);
  });
});

// https://github.com/oven-sh/bun/issues/5682
describe("-g and a relative local path", () => {
  const files = {
    "pkg/package.json": JSON.stringify({ name: "mypkg", version: "1.0.0", bin: { mypkg: "./cli.js" } }),
    "pkg/cli.js": "#!/usr/bin/env node\n",
    "sibling/.keep": "",
  };

  async function runGlobal(home: string, cwd: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        HOME: home,
        BUN_INSTALL: join(home, ".bun"),
        BUN_INSTALL_GLOBAL_DIR: join(home, ".bun", "install", "global"),
        BUN_INSTALL_BIN: join(home, ".bun", "bin"),
        BUN_INSTALL_CACHE_DIR: join(home, ".bun", "install", "cache"),
      },
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const posix = (path: string) => path.replaceAll("\\", "/");

  // The first `bun add -g` finds no global package.json, creates it and starts over, from the global directory.
  it.each([
    ["install", "pkg", ".", ""],
    ["install", "pkg", "./", "/"],
    ["install", "pkg", "file:.", ""],
    ["add", "pkg", ".", ""],
    ["add", "sibling", "../pkg", ""],
    ["add", ".", "file:pkg", ""],
    ["add", ".", "./pkg", ""],
    ["add", ".", "alias@./pkg", ""],
  ])("bun %s -g from %s: %s is the folder the cwd names", async (command, cwd, typed, suffix) => {
    using dir = tempDir("bun-add-global-relative", files);
    const home = String(dir);
    const key = typed.startsWith("alias@") ? "alias" : "mypkg";
    const prefix = typed.includes("file:") ? "file:" : "";

    const { stdout, stderr, exitCode } = await runGlobal(home, join(home, cwd), command, "-g", typed);
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain(`installed ${key}@`);
    expect(await file(join(home, ".bun", "install", "global", "package.json")).json()).toEqual({
      dependencies: { [key]: prefix + posix(join(home, "pkg")) + suffix },
    });
    expect(await readdirSorted(join(home, ".bun", "install", "global", "node_modules", key))).toEqual([
      "cli.js",
      "package.json",
    ]);
    expect(join(home, ".bun", "bin", "mypkg")).toBeValidBin(
      join("..", "install", "global", "node_modules", key, "cli.js"),
    );
    expect(exitCode).toBe(0);
  });

  it("a local tarball", async () => {
    using dir = tempDir("bun-add-global-relative-tgz", files);
    const home = String(dir);
    await copyFile(join(__dirname, "baz-0.0.3.tgz"), join(home, "sibling", "baz-0.0.3.tgz"));

    const { stdout, stderr, exitCode } = await runGlobal(
      home,
      join(home, "pkg"),
      "add",
      "-g",
      "../sibling/baz-0.0.3.tgz",
    );
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("installed baz@");
    expect(await file(join(home, ".bun", "install", "global", "package.json")).json()).toEqual({
      dependencies: { baz: posix(join(home, "sibling", "baz-0.0.3.tgz")) },
    });
    expect(exitCode).toBe(0);
  });

  it("a path that doesn't exist leaves the global package.json usable", async () => {
    using dir = tempDir("bun-add-global-relative-missing", files);
    const home = String(dir);

    const missing = await runGlobal(home, join(home, "sibling"), "add", "-g", "./pkg");
    expect(missing.stderr).toContain("error: package.json not found for");
    expect(missing.exitCode).toBe(1);

    const { stderr, exitCode } = await runGlobal(home, join(home, "pkg"), "add", "-g", ".");
    expect(stderr).not.toContain("error:");
    expect(await file(join(home, ".bun", "install", "global", "package.json")).json()).toEqual({
      dependencies: { mypkg: posix(join(home, "pkg")) },
    });
    expect(exitCode).toBe(0);
  });
});

it("should not add duplicate package.json entries when installing the same local folder twice (#30933)", async () => {
  setHandler(dummyRegistry([]));
  // `add_dir` is a fresh tmpdir created in beforeEach; use it as the local dep source.
  await writeFile(
    join(add_dir, "package.json"),
    JSON.stringify({
      name: "myproject",
      version: "1.0.0",
      bin: { myproject: "./index.js" },
    }),
  );
  await writeFile(join(add_dir, "index.js"), 'console.log("hi")');

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "host",
      version: "0.0.1",
    }),
  );

  // The positional is the absolute path; parse_with_optional_tag will tag this as `.folder`.
  // `bun add` normalises backslashes to forward slashes before writing package.json,
  // so the stored literal uses `/` on Windows too.
  const local_path = resolve(add_dir);
  const stored_path = local_path.replace(/\\/g, "/");

  // 1st run — clean, adds one entry keyed by the resolved package name.
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", local_path],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    const out = await stdout.text();
    expect(out).toContain("installed myproject@");
    expect(await exited).toBe(0);
  }

  // 2nd run with the same path — must reuse the existing "myproject" key, not append a duplicate.
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", local_path],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    // Nothing changed, so the identical lockfile is not rewritten.
    expect(err).not.toContain("Saved lockfile");
    const out = await stdout.text();
    expect(out).toContain("installed myproject@");
    expect(await exited).toBe(0);
  }

  // `JSON.parse` collapses duplicate keys — inspect the raw text to prove de-duplication.
  const raw = await file(join(package_dir, "package.json")).text();
  expect(raw.match(/"myproject"\s*:/g) ?? []).toHaveLength(1);
  expect(JSON.parse(raw)).toStrictEqual({
    name: "host",
    version: "0.0.1",
    dependencies: {
      myproject: stored_path,
    },
  });
});

it("should not add duplicate package.json entries when installing the same tarball URL twice (#30499)", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(Bun.file(join(__dirname, "baz-0.0.3.tgz")));
    },
  });
  const tarball_url = `${server.url.href.replace(/\/+$/, "")}/baz-0.0.3.tgz`;
  setHandler(dummyRegistry([]));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );

  // First install — key should be the package name from the tarball ("baz").
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", tarball_url],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).toContain("Saved lockfile");
    const out = await stdout.text();
    expect(out).toContain("installed baz@");
    expect(await exited).toBe(0);
  }
  expect(await file(join(package_dir, "package.json")).json()).toStrictEqual({
    name: "foo",
    version: "0.0.1",
    dependencies: {
      baz: tarball_url,
    },
  });

  // Second install with the same URL — must not duplicate the "baz" key.
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", tarball_url],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    // Nothing changed, so the identical lockfile is not rewritten.
    expect(err).not.toContain("Saved lockfile");
    const out = await stdout.text();
    expect(out).toContain("installed baz@");
    expect(await exited).toBe(0);
  }

  const raw = await file(join(package_dir, "package.json")).text();
  expect(raw.match(/"baz"\s*:/g) ?? []).toHaveLength(1);
  expect(JSON.parse(raw)).toStrictEqual({
    name: "foo",
    version: "0.0.1",
    dependencies: {
      baz: tarball_url,
    },
  });
});

it("should not add duplicate package.json entries when installing a different commit of the same git dependency (#40799)", async () => {
  setHandler(dummyRegistry([]));
  const gitEnv = {
    ...env,
    // Set on the asan lanes, where it makes `bun install` kill its own git clones (#33982).
    BUN_FEATURE_FLAG_NO_ORPHANS: undefined,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };

  // Two commits in a local repo stand in for two github hashes.
  await writeFile(join(add_dir, "package.json"), JSON.stringify({ name: "mydep", version: "1.0.0" }));
  await $`git init -q && git add -A && git commit -q -m one --no-gpg-sign`.cwd(add_dir).env(gitEnv).quiet();
  const sha1 = (await $`git rev-parse HEAD`.cwd(add_dir).env(gitEnv).text()).trim();
  await writeFile(join(add_dir, "package.json"), JSON.stringify({ name: "mydep", version: "1.0.1" }));
  await $`git add -A && git commit -q -m two --no-gpg-sign`.cwd(add_dir).env(gitEnv).quiet();
  const sha2 = (await $`git rev-parse HEAD`.cwd(add_dir).env(gitEnv).text()).trim();

  const repo_url = `git+${pathToFileURL(add_dir).href}`;

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "host",
      version: "0.0.1",
    }),
  );

  // Install each commit in turn. The second install must overwrite the
  // existing "mydep" entry, not append a second "mydep" key.
  for (const sha of [sha1, sha2]) {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "add", `${repo_url}#${sha}`],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: gitEnv,
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    const out = await stdout.text();
    expect(out).toContain("installed mydep@");
    expect(await exited).toBe(0);
  }

  // `JSON.parse` collapses duplicate keys, so inspect the raw text to prove the key was reused.
  const raw2 = await file(join(package_dir, "package.json")).text();
  expect(raw2.match(/"mydep"\s*:/g) ?? []).toHaveLength(1);
  expect(JSON.parse(raw2)).toStrictEqual({
    name: "host",
    version: "0.0.1",
    dependencies: {
      mydep: `${repo_url}#${sha2}`,
    },
  });
});

// `bun add <url>` names the dependency after the URL until the tarball's package.json has been read,
// and the URL's basename labels the directory the tarball is extracted into. The query string and
// fragment used to end up in that label: `?` cannot appear in a directory name on Windows, and a `:`
// within the first 32 bytes of the label (it is truncated to that) fails the install folder name
// check on every platform with "Refusing to install package with invalid name". A URL without a path
// has nothing usable left once the query is gone (its basename is the `host:port`), so the label
// falls back to "package" instead.
describe("should add a tarball URL with a query string or fragment", () => {
  const paths = [
    ["query string", "/qs-pkg-1.0.0.tgz?token=abc"],
    ["query string containing a colon", "/qs-pkg-1.0.0.tgz?expires=12:00"],
    ["fragment containing a colon", "/qs-pkg-1.0.0.tgz#ref:main"],
    ["query string on a URL without a path", "/?file=qs-pkg-1.0.0.tgz"],
  ] as const;

  let tarball: Uint8Array;
  beforeAll(async () => {
    tarball = await new Bun.Archive(
      {
        "package/package.json": JSON.stringify({ name: "qs-pkg", version: "1.0.0" }),
        // Incompressible padding so the drip-fed response below arrives in many socket reads, which
        // is what commits the install to the streaming extractor.
        "package/pad.bin": randomBytes(256 * 1024),
      },
      { compress: "gzip" },
    ).bytes();
  });

  // The tarball is extracted either from the fully buffered response body or, when the body is
  // large enough and arrives in several reads, by the streaming extractor; both pick the extraction
  // directory name the same way.
  async function serveTarball(mode: "buffered" | "streaming") {
    if (mode === "buffered") {
      const server = Bun.serve({
        port: 0,
        fetch: () => new Response(tarball),
      });
      return {
        origin: server.url.origin,
        [Symbol.asyncDispose]: () => server.stop(true),
      };
    }

    // node:http so the response carries a Content-Length and can still be written 1 KiB at a time.
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Length", String(tarball.length));
      req.socket.setNoDelay(true);
      let offset = 0;
      const step = () => {
        if (offset >= tarball.length) {
          res.end();
          return;
        }
        res.write(tarball.subarray(offset, offset + 1024));
        offset += 1024;
        setImmediate(step);
      };
      step();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
      origin: `http://127.0.0.1:${port}`,
      [Symbol.asyncDispose]: () => {
        server.closeAllConnections();
        return new Promise<void>(resolve => server.close(() => resolve()));
      },
    };
  }

  describe.each(["buffered", "streaming"] as const)("%s extraction", mode => {
    test.each(paths)("%s", async (_, path) => {
      await using server = await serveTarball(mode);
      const url = `${server.origin}${path}`;
      await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "add", url, "--verbose"],
        cwd: package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: mode === "streaming" ? { ...env, BUN_INSTALL_STREAMING_MIN_SIZE: "1024" } : env,
      });
      const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
      expect(err).not.toContain("error:");
      // Printed by the streaming extractor only, so each mode is known to have taken its own path.
      if (mode === "streaming") {
        expect(err).toContain("Streamed ");
      } else {
        expect(err).not.toContain("Streamed ");
      }
      expect(out).toContain(`+ qs-pkg@${url}`);
      expect(exitCode).toBe(0);
      expect(await file(join(package_dir, "package.json")).json()).toStrictEqual({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "qs-pkg": url,
        },
      });
      expect(await file(join(package_dir, "node_modules", "qs-pkg", "package.json")).json()).toEqual({
        name: "qs-pkg",
        version: "1.0.0",
      });
    });
  });
});

it("should add multiple dependencies specified on command line", async () => {
  expect(check_npm_auth_type.check).toBe(true);
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(Bun.file(join(__dirname, "baz-0.0.3.tgz")));
    },
  });
  const server_url = server.url.href.replace(/\/+$/, "");
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", `${server_url}/baz-0.0.3.tgz`, "bar"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  await writeFile(
    join(add_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringMatching(/^bun add v1./),
    "",
    expect.stringMatching(/^installed baz@http:\/\/.* with binaries:$/),
    " - baz-run",
    "installed bar@0.0.2",
    "",
    "2 packages installed",
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(package_dir, "package.json")).json()).toStrictEqual({
    dependencies: {
      bar: "^0.0.2",
      baz: `${server_url}/baz-0.0.3.tgz`,
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it("requests the manifests of all the packages on the command line at the same time", async () => {
  const registry = dummyRegistry([]);
  const lastWasRequested = Promise.withResolvers<void>();
  setHandler(async request => {
    if (request.url.endsWith("/moo")) lastWasRequested.resolve();
    if (request.url.endsWith("/bar")) await lastWasRequested.promise;
    return registry(request);
  });
  await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo" }));
  await using proc = spawn({
    cmd: [bunExe(), "add", "bar", "baz", "moo", "--lockfile-only"],
    cwd: package_dir,
    stdout: "ignore",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(err).not.toContain("error:");
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    dependencies: { bar: "^0.0.2", baz: "^0.0.2", moo: "^0.0.2" },
  });
  expect(exitCode).toBe(0);
});

it("should install tarball with tarball dependencies", async () => {
  // This test verifies that tarballs containing dependencies that are also tarballs
  // can be installed correctly. Regression test for URL corruption bug where
  // URLs like https://example.com/pkg.tgz get mangled with cache folder patterns.

  // Create simple test tarballs
  const tmpDir = tmpdirSync();

  // Create child package
  const childDir = join(tmpDir, "child");
  await mkdir(childDir, { recursive: true });
  await writeFile(join(childDir, "package.json"), JSON.stringify({ name: "test-child", version: "1.0.0" }));

  // Create child tarball
  const { exited: childTarExited } = spawn({
    cmd: ["tar", "-czf", join(tmpDir, "child.tgz"), "-C", tmpDir, "child"],
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await childTarExited).toBe(0);

  // Set up server first to get the port
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/child.tgz") {
        return new Response(Bun.file(join(tmpDir, "child.tgz")));
      } else if (url.pathname === "/parent.tgz") {
        return new Response(Bun.file(join(tmpDir, "parent.tgz")));
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const server_url = server.url.href.replace(/\/+$/, "");

  // Create parent package that depends on child via URL
  const parentDir = join(tmpDir, "parent");
  await mkdir(parentDir, { recursive: true });
  await writeFile(
    join(parentDir, "package.json"),
    JSON.stringify({
      name: "test-parent",
      version: "1.0.0",
      dependencies: {
        "test-child": `${server_url}/child.tgz`,
      },
    }),
  );

  // Create parent tarball
  const { exited: parentTarExited } = spawn({
    cmd: ["tar", "-czf", join(tmpDir, "parent.tgz"), "-C", tmpDir, "parent"],
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await parentTarExited).toBe(0);

  // Now test adding the parent tarball
  await writeFile(
    join(add_dir, "package.json"),
    JSON.stringify({
      name: "foo",
    }),
  );

  const urls: string[] = [];
  setHandler(dummyRegistry(urls));

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", `${server_url}/parent.tgz`, "--linker=hoisted"],
    cwd: add_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).not.toContain("HttpNotFound");
  expect(err).not.toContain("404");

  expect(await exited).toBe(0);

  // Verify both packages were installed
  await access(join(add_dir, "node_modules", "test-parent"));
  await access(join(add_dir, "node_modules", "test-child"));
});

it("should add a local tarball with an uppercase .TGZ extension", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  await copyFile(join(__dirname, "baz-0.0.3.tgz"), join(package_dir, "BAZ-0.0.3.TGZ"));
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "./BAZ-0.0.3.TGZ"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out).toContain("installed baz@");
  expect(out).toContain("1 package installed");
  expect(await exited).toBe(0);
  expect(urls).toBeEmpty();
  expect(requested).toBe(0);
  const package_json = await file(join(package_dir, "node_modules", "baz", "package.json")).json();
  expect(package_json.name).toBe("baz");
  expect(package_json.version).toBe("0.0.3");
});

it("should add an uncompressed .tar local tarball", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  await writeFile(
    join(package_dir, "baz-0.0.3.tar"),
    Bun.gunzipSync(await file(join(__dirname, "baz-0.0.3.tgz")).bytes()),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "baz-0.0.3.tar"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toStrictEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed baz@baz-0.0.3.tar with binaries:",
    " - baz-run",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls).toBeEmpty();
  expect(requested).toBe(0);
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toStrictEqual([
    ".bun-tag",
    "index.js",
    "package.json",
  ]);
  const package_json = await file(join(package_dir, "node_modules", "baz", "package.json")).json();
  expect(package_json.name).toBe("baz");
  expect(package_json.version).toBe("0.0.3");
  expect(await file(join(package_dir, "package.json")).text()).toInclude('"baz-0.0.3.tar"');
});

it("bun add --trust keeps the new package when another --trust package is already in trustedDependencies", async () => {
  setHandler(dummyRegistry([]));
  for (const name of ["a-scripted", "b-scripted"]) {
    await mkdir(join(package_dir, name));
    await writeFile(
      join(package_dir, name, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        scripts: { postinstall: `${bunExe()} -e "require('fs').writeFileSync('postinstall.txt', '')"` },
      }),
    );
  }
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      trustedDependencies: ["a-scripted"],
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "--trust", "file:./a-scripted", "file:./b-scripted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out).toContain("installed b-scripted@");
  expect(await exited).toBe(0);

  expect(
    await Promise.all(
      ["a-scripted", "b-scripted"].map(name =>
        file(join(package_dir, "node_modules", name, "postinstall.txt")).exists(),
      ),
    ),
  ).toStrictEqual([true, true]);
  expect(await file(join(package_dir, "package.json")).json()).toStrictEqual({
    name: "foo",
    version: "0.0.1",
    trustedDependencies: ["a-scripted", "b-scripted"],
    dependencies: {
      "a-scripted": "file:./a-scripted",
      "b-scripted": "file:./b-scripted",
    },
  });
});

describe("should move existing dependency when an explicit group flag is given", () => {
  const root = { name: "foo", version: "0.0.1" };
  const pkgJson = (pkg: Record<string, unknown>) => JSON.stringify(pkg, null, 2);

  async function add(
    initial: Record<string, unknown> | string,
    args: string[],
    registry: Record<string, unknown> = { "0.0.2": {} },
    command = "add",
  ) {
    setHandler(dummyRegistry([], registry));
    await writeFile(join(package_dir, "package.json"), typeof initial === "string" ? initial : pkgJson(initial));
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), command, ...args],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [err, , exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(exitCode).toBe(0);
    return await file(join(package_dir, "package.json")).text();
  }

  it.each([
    ["dependencies", "devDependencies", "--dev"],
    ["dependencies", "optionalDependencies", "--optional"],
    ["dependencies", "peerDependencies", "--peer"],
    ["devDependencies", "optionalDependencies", "--optional"],
    ["optionalDependencies", "devDependencies", "--dev"],
    ["optionalDependencies", "peerDependencies", "--peer"],
    ["devDependencies", "dependencies", "--save-prod"],
    ["optionalDependencies", "dependencies", "--save-prod"],
  ])("%s -> %s with %s", async (from, to, flag) => {
    expect(await add({ ...root, [from]: { BaR: "^0.0.2" } }, [flag, "BaR"])).toBe(
      pkgJson({ ...root, [to]: { BaR: "^0.0.2" } }),
    );
  });

  it("--save-prod adds to dependencies and leaves a peerDependencies entry untouched", async () => {
    const initial = { ...root, peerDependencies: { baz: ">=0.0.3" } };
    expect(await add(initial, ["--save-prod", "baz"], { "0.0.3": {}, "0.0.5": {} })).toBe(
      pkgJson({ ...root, peerDependencies: { baz: ">=0.0.3" }, dependencies: { baz: "^0.0.5" } }),
    );
  });

  it("bun install --save-prod moves like bun add", async () => {
    expect(
      await add({ ...root, devDependencies: { BaR: "^0.0.2" } }, ["--save-prod", "BaR"], undefined, "install"),
    ).toBe(pkgJson({ ...root, dependencies: { BaR: "^0.0.2" } }));
  });

  it("another group's flag wins over --save-prod", async () => {
    expect(await add({ ...root, dependencies: { BaR: "^0.0.2" } }, ["--save-prod", "--dev", "BaR"])).toBe(
      pkgJson({ ...root, devDependencies: { BaR: "^0.0.2" } }),
    );
  });

  it("--save-prod does not move with --only-missing", async () => {
    const initial = { ...root, devDependencies: { BaR: "^0.0.2" } };
    expect(await add(initial, ["--save-prod", "--only-missing", "BaR"])).toBe(pkgJson(initial));
  });

  it.each(["link"])("bun %s has no --save-prod flag", async command => {
    const initial = pkgJson({ ...root, devDependencies: { BaR: "^0.0.2" } });
    await writeFile(join(package_dir, "package.json"), initial);
    await using proc = spawn({
      cmd: [bunExe(), command, "--save-prod", "BaR"],
      cwd: package_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [err, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(err).toBe(
      `error: bun ${command} has no --save-prod flag.\nnote: Run 'bun ${command} --help' for more information\n`,
    );
    expect(await file(join(package_dir, "package.json")).text()).toBe(initial);
    expect(exitCode).toBe(1);
  });

  it("keeps the remaining entries of the source group in their original order", async () => {
    const dependencies = { monkey: "^0.0.2", BaR: "^0.0.2", boba: "^0.0.2", "depends-on-monkey": "^0.0.2" };
    expect(await add({ ...root, dependencies }, ["--dev", "BaR"])).toBe(
      pkgJson({
        ...root,
        dependencies: { monkey: "^0.0.2", boba: "^0.0.2", "depends-on-monkey": "^0.0.2" },
        devDependencies: { BaR: "^0.0.2" },
      }),
    );
  });

  it("keeps the other root keys in their original order when the source group becomes empty", async () => {
    const rest = { type: "module", scripts: { test: "true" }, license: "MIT" };
    expect(await add({ ...root, dependencies: { BaR: "^0.0.2" }, ...rest }, ["--dev", "BaR"])).toBe(
      pkgJson({ ...root, ...rest, devDependencies: { BaR: "^0.0.2" } }),
    );
  });

  it("moves several packages out of the same group", async () => {
    expect(await add({ ...root, dependencies: { BaR: "^0.0.2", monkey: "^0.0.2" } }, ["--dev", "BaR", "monkey"])).toBe(
      pkgJson({ ...root, devDependencies: { BaR: "^0.0.2", monkey: "^0.0.2" } }),
    );
  });

  it("removes the other group when the package is already in the target group", async () => {
    const initial = { ...root, devDependencies: { BaR: "^0.0.2" }, optionalDependencies: { BaR: "^0.0.2" } };
    expect(await add(initial, ["--dev", "BaR"])).toBe(pkgJson({ ...root, devDependencies: { BaR: "^0.0.2" } }));
  });

  it("leaves a peerDependencies entry untouched when adding to devDependencies", async () => {
    const initial = { ...root, peerDependencies: { baz: ">=0.0.3" } };
    expect(await add(initial, ["--dev", "baz"], { "0.0.3": {}, "0.0.5": {} })).toBe(
      pkgJson({ ...root, peerDependencies: { baz: ">=0.0.3" }, devDependencies: { baz: "^0.0.5" } }),
    );
  });

  it("updates the devDependencies range when adding to peerDependencies", async () => {
    const initial = { ...root, devDependencies: { baz: ">=0.0.3" } };
    expect(await add(initial, ["--peer", "baz"], { "0.0.3": {}, "0.0.5": {} })).toBe(
      pkgJson({ ...root, devDependencies: { baz: "^0.0.5" }, peerDependencies: { baz: "^0.0.5" } }),
    );
  });

  it("does not move when no group flag is given", async () => {
    const initial = { ...root, devDependencies: { BaR: "^0.0.2" } };
    expect(await add(initial, ["BaR"])).toBe(pkgJson(initial));
  });

  describe.each([
    ["dependencies", "devDependencies"],
    ["dependencies", "optionalDependencies"],
    ["devDependencies", "optionalDependencies"],
  ])("without a group flag the entries in %s and %s both take", (first, second) => {
    it.each([
      ["baz@0.0.5", "0.0.5"],
      ["baz", "^0.0.5"],
    ])("bun add %s", async (spec, saved) => {
      const declared = (version: string) => ({ ...root, [first]: { baz: version }, [second]: { baz: version } });
      expect(await add(declared("0.0.3"), [spec], { "0.0.3": {}, "0.0.5": {} })).toBe(pkgJson(declared(saved)));

      for (const args of [[], ["--frozen-lockfile"]]) {
        await using proc = spawn({
          cmd: [bunExe(), "install", ...args],
          cwd: package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({
          args,
          saved: err.includes("Saved lockfile"),
          failed: err.includes("error:"),
          out,
          version: (await file(join(package_dir, "node_modules", "baz", "package.json")).json()).version,
          exitCode,
        }).toEqual({
          args,
          saved: false,
          failed: false,
          out: expect.stringContaining("(no changes)"),
          version: "0.0.5",
          exitCode: 0,
        });
      }
    });
  });

  it("installs the version it saves when the install leaves out one of three groups with the name", async () => {
    const groups = ["dependencies", "devDependencies", "optionalDependencies"];
    const declared = { ...root, ...Object.fromEntries(groups.map(group => [group, { baz: "0.0.3" }])) };
    const saved = JSON.parse(await add(declared, ["baz@0.0.5", "--omit=dev"], { "0.0.3": {}, "0.0.5": {} }));
    expect((await file(join(package_dir, "node_modules", "baz", "package.json")).json()).version).toBe(
      saved.optionalDependencies.baz,
    );
  });

  it("does not move with --only-missing", async () => {
    const initial = { ...root, dependencies: { BaR: "^0.0.2" } };
    expect(await add(initial, ["--dev", "--only-missing", "BaR"])).toBe(pkgJson(initial));
  });

  it("moves the one package of two that another group has", async () => {
    expect(await add({ ...root, dependencies: { BaR: "^0.0.2", boba: "^0.0.2" } }, ["--dev", "BaR", "monkey"])).toBe(
      pkgJson({ ...root, dependencies: { boba: "^0.0.2" }, devDependencies: { BaR: "^0.0.2", monkey: "^0.0.2" } }),
    );
  });

  it("moves an npm: alias under its own name", async () => {
    expect(await add({ ...root, dependencies: { zz: "npm:BaR@^0.0.1" } }, ["--dev", "zz@npm:BaR@0.0.2"])).toBe(
      pkgJson({ ...root, devDependencies: { zz: "npm:BaR@0.0.2" } }),
    );
  });

  it("keeps tabs and a missing final newline", async () => {
    const text = (...lines: string[]) => lines.join("\n");
    expect(
      await add(
        text("{", '\t"name": "foo",', '\t"dependencies": {', '\t\t"BaR": "^0.0.2"', "\t},", '\t"license": "MIT"', "}"),
        ["--dev", "BaR"],
      ),
    ).toBe(
      text("{", '\t"name": "foo",', '\t"license": "MIT",', '\t"devDependencies": {', '\t\t"BaR": "^0.0.2"', "\t}", "}"),
    );
  });
});

describe("a spec without a name that resolves to a dependency package.json already declares", () => {
  type Kind = "folder" | "tarball" | "git";
  type Declared =
    "none" | "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies" | "optional peer";
  type Flag = "" | "-d" | "--peer";

  const gitEnv = {
    ...env,
    // Set on the asan lanes, where it makes `bun install` kill its own git clones (#33982).
    BUN_FEATURE_FLAG_NO_ORPHANS: undefined,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };

  const manifest = (version: string) => JSON.stringify({ name: "pkga", version });

  async function commit(repo: string, version: string) {
    await Bun.write(join(repo, "package.json"), manifest(version));
    await $`git init -q && git add -A && git commit -q -m ${version} --no-gpg-sign`.cwd(repo).env(gitEnv).quiet();
    return (await $`git rev-parse HEAD`.cwd(repo).env(gitEnv).text()).trim();
  }

  // Tarballs and git repositories live in `root`, next to the projects that use them, so two projects name the same bytes.
  async function source(root: string, kind: Kind, label: string, version: string) {
    if (kind === "tarball") {
      await Bun.Archive.write(
        join(root, `${label}.tgz`),
        { "package/package.json": manifest(version) },
        { compress: "gzip" },
      );
    } else if (kind === "git") {
      await commit(join(root, label), version);
    }
    return async (project: string, prefix: string) => {
      switch (kind) {
        case "folder":
          await Bun.write(join(project, label, "package.json"), manifest(version));
          return `${prefix}./${label}`;
        case "tarball":
          await copyFile(join(root, `${label}.tgz`), join(project, `${label}.tgz`));
          return `${prefix}./${label}.tgz`;
        case "git":
          return `git+${pathToFileURL(join(root, label)).href}`;
      }
    };
  }

  async function run(project: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd: project,
      env: { ...gitEnv, BUN_INSTALL_CACHE_DIR: join(project, ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, exitCode };
  }

  async function ok(project: string, ...args: string[]) {
    const { out, err, exitCode } = await run(project, ...args);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
    return out;
  }

  // Keys that one object of a JSON or JSONC text has twice. `JSON.parse` keeps the last one, so they are found in the text.
  function duplicateKeys(text: string) {
    const duplicates: string[] = [];
    const open: (Set<string> | null)[] = [];
    for (const [token, colon] of text.matchAll(/"(?:[^"\\]|\\.)*"(\s*:)?|[{}\[\]]/g)) {
      if (token === "{") open.push(new Set());
      else if (token === "[") open.push(null);
      else if (token === "}" || token === "]") open.pop();
      else if (colon) {
        const key = token.slice(0, token.lastIndexOf('"') + 1);
        if (open.at(-1)!.has(key)) duplicates.push(key);
        open.at(-1)!.add(key);
      }
    }
    return duplicates;
  }

  const state = async (project: string) => ({
    packageJson: await file(join(project, "package.json")).text(),
    lockfile: await file(join(project, "bun.lock")).text(),
    installed: (await file(join(project, "node_modules", "pkga", "package.json")).json()).version,
  });

  // package.json, bun.lock and node_modules agree and are stable: no key appears twice, a frozen install passes, and a
  // second install changes nothing.
  async function settled(project: string, frozen = true) {
    const after = await state(project);
    expect(duplicateKeys(after.packageJson)).toEqual([]);
    expect(duplicateKeys(after.lockfile)).toEqual([]);
    if (frozen) await ok(project, "install", "--frozen-lockfile");
    await ok(project, "install");
    expect(await state(project)).toEqual(after);
    return after;
  }

  // The lists that hold the spec afterwards. Without a flag the entry stays in its list; `-d` and `--peer` move it there, as
  // they do for `bun add <flag> pkga@<spec>`. A peer entry and the entry of another list may share a name, so neither
  // replaces the other ("keeps"), except that the devDependencies entry follows a new peer entry.
  // `bun add --peer <spec>` over an optional peer of that name is left out: it still writes the name twice into bun.lock.
  const outcomes: Record<Flag, Partial<Record<Declared, { lists: string[]; keeps?: true }>>> = {
    "": {
      "none": { lists: ["dependencies"] },
      "dependencies": { lists: ["dependencies"] },
      "devDependencies": { lists: ["devDependencies"] },
      "optionalDependencies": { lists: ["optionalDependencies"] },
      "peerDependencies": { lists: ["dependencies"], keeps: true },
      "optional peer": { lists: ["dependencies"], keeps: true },
    },
    "-d": {
      none: { lists: ["devDependencies"] },
      dependencies: { lists: ["devDependencies"] },
      devDependencies: { lists: ["devDependencies"] },
      optionalDependencies: { lists: ["devDependencies"] },
      peerDependencies: { lists: ["devDependencies"], keeps: true },
    },
    "--peer": {
      none: { lists: ["peerDependencies"] },
      dependencies: { lists: ["peerDependencies"] },
      devDependencies: { lists: ["devDependencies", "peerDependencies"] },
      optionalDependencies: { lists: ["peerDependencies"] },
      peerDependencies: { lists: ["peerDependencies"] },
    },
  };
  // Every cell with a folder. The other kinds are only tested where the list can change the outcome, to keep the file
  // fast.
  const cell = (declared: Declared, kind: Kind, flag: Flag) => ({ declared, kind, flag });
  const cells = [
    ...(Object.keys(outcomes) as Flag[]).flatMap(flag =>
      (Object.keys(outcomes[flag]) as Declared[]).map(declared => cell(declared, "folder", flag)),
    ),
    ...(["none", "dependencies", "peerDependencies"] as Declared[]).flatMap(declared => [
      cell(declared, "tarball", ""),
      cell(declared, "git", ""),
    ]),
    cell("dependencies", "tarball", "-d"),
    cell("dependencies", "git", "-d"),
  ];

  test.concurrent.each(cells)("bun add $flag <$kind>, declared: $declared", async ({ declared, kind, flag }) => {
    using dir = tempDir("bun-add-declared-name", {});
    const root = String(dir);
    const [oldSource, newSource] = await Promise.all([
      source(root, "folder", "old-pkga", "1.0.0"),
      source(root, kind, "new-pkga", "2.0.0"),
    ]);

    const declaredList = declared === "optional peer" ? "peerDependencies" : declared;
    const { lists, keeps } = outcomes[flag][declared]!;

    const add = async (name: string) => {
      const project = join(root, name);
      const siblings = { "other-a": "file:./other-a", "other-z": "file:./other-z" };
      for (const sibling of Object.keys(siblings)) {
        await Bun.write(join(project, sibling, "package.json"), JSON.stringify({ name: sibling, version: "1.0.0" }));
      }
      const before: Record<string, any> = { name: "app", dependencies: { ...siblings } };
      if (declared !== "none") {
        before[declaredList] = { ...before[declaredList], pkga: await oldSource(project, "file:") };
        if (declared === "optional peer") before.peerDependenciesMeta = { pkga: { optional: true } };
      }
      await Bun.write(join(project, "package.json"), JSON.stringify(before));
      if (declared !== "none") await ok(project, "install");

      const spec = await newSource(project, "");
      const out = await ok(project, "add", ...(flag ? [flag] : []), name === "named" ? `pkga@${spec}` : spec);
      expect(out).toContain("installed pkga@");
      return { project, before, spec };
    };

    // `bun add pkga@<spec>` never had the second row, so it is the oracle. Without a flag it writes over a peer entry, which a
    // spec without a name leaves alone. One kind is enough: the kind does not change what the named spec writes.
    const oracle = kind === "folder" && !(flag === "" && keeps);
    const [bare, named] = await Promise.all([add("bare"), oracle ? add("named") : undefined]);

    const expected = structuredClone(bare.before);
    if (declared !== "none" && !keeps) {
      delete expected[declaredList].pkga;
      if (Object.keys(expected[declaredList]).length === 0) delete expected[declaredList];
    }
    for (const list of lists) expected[list] = { ...expected[list], pkga: bare.spec };
    // Beside a peer entry with another source the result is what 1.4.3 writes, so one follow-up install is enough there.
    const after = await settled(bare.project, !keeps);
    expect(JSON.parse(after.packageJson)).toEqual(expected);
    expect(after.installed).toBe("2.0.0");
    if (named) expect(after).toEqual(await state(named.project));
  });

  test.concurrent.each([
    { name: "./folder over a tarball", old: "tarball", add: "folder" },
    { name: "./x.tgz over a git dependency", old: "git", add: "tarball" },
  ] as { name: string; old: Kind; add: Kind }[])("bun add $name", async ({ old, add }) => {
    using dir = tempDir("bun-add-declared-name", {});
    const project = String(dir);
    const oldSpec = await (await source(project, old, "old-pkga", "1.0.0"))(project, "");
    await Bun.write(join(project, "package.json"), JSON.stringify({ name: "app", dependencies: { pkga: oldSpec } }));
    await ok(project, "install");

    const spec = await (await source(project, add, "new-pkga", "2.0.0"))(project, "file:");
    await ok(project, "add", spec);
    const after = await settled(project);
    expect(JSON.parse(after.packageJson)).toEqual({ name: "app", dependencies: { pkga: spec } });
    expect(after.installed).toBe("2.0.0");
  });

  test.concurrent("bun add <git url>#<commit> over another commit of the same repository (#8031)", async () => {
    using dir = tempDir("bun-add-declared-name", {});
    const project = join(String(dir), "app");
    const repo = join(String(dir), "repo");
    const url = `git+${pathToFileURL(repo).href}`;
    await Bun.write(join(project, "package.json"), JSON.stringify({ name: "app" }));

    for (const version of ["1.0.0", "2.0.0"]) {
      const spec = `${url}#${await commit(repo, version)}`;
      await ok(project, "add", spec);
      const after = await state(project);
      expect(duplicateKeys(after.lockfile)).toEqual([]);
      expect(JSON.parse(after.packageJson)).toEqual({ name: "app", dependencies: { pkga: spec } });
      expect(after.installed).toBe(version);
    }
    await settled(project);
  });

  test.concurrent("bun add <tarball url> over another url of the same package (#20647)", async () => {
    using dir = tempDir("bun-add-declared-name", {});
    const project = String(dir);
    const tarballs = new Map<string, Uint8Array>();
    for (const version of ["1.0.0", "2.0.0"]) {
      tarballs.set(
        `/pkga-${version}.tgz`,
        await new Bun.Archive({ "package/package.json": manifest(version) }, { compress: "gzip" }).bytes(),
      );
    }
    using server = Bun.serve({
      port: 0,
      fetch: req => new Response(tarballs.get(new URL(req.url).pathname.replace("/mirror", "")) ?? null),
    });
    await Bun.write(join(project, "package.json"), JSON.stringify({ name: "app" }));

    // `/mirror` is a second literal for the first tarball, as `?1` is in the report.
    for (const [path, version] of [
      ["/pkga-1.0.0.tgz", "1.0.0"],
      ["/mirror/pkga-1.0.0.tgz", "1.0.0"],
      ["/pkga-1.0.0.tgz", "1.0.0"],
      ["/pkga-2.0.0.tgz", "2.0.0"],
    ]) {
      const spec = new URL(path, server.url).href;
      await ok(project, "add", spec);
      const after = await state(project);
      expect(duplicateKeys(after.lockfile)).toEqual([]);
      expect(JSON.parse(after.packageJson)).toEqual({ name: "app", dependencies: { pkga: spec } });
      expect(after.installed).toBe(version);
    }
    await settled(project);
  });

  // A folder in both `dependencies` and `devDependencies` is written to bun.lock twice by a plain install, so that pair uses tarballs.
  test.concurrent.each([
    { kind: "folder", groups: ["dependencies", "optionalDependencies"] },
    { kind: "tarball", groups: ["dependencies", "devDependencies"] },
  ] as { kind: Kind; groups: string[] }[])(
    "bun add <$kind>, declared: $groups.0 and $groups.1",
    async ({ kind, groups }) => {
      using dir = tempDir("bun-add-declared-name", {});
      const project = String(dir);
      const oldSpec = await (await source(project, kind, "old-pkga", "1.0.0"))(project, "file:");
      const declared = Object.fromEntries(groups.map(group => [group, { pkga: oldSpec }]));
      await Bun.write(join(project, "package.json"), JSON.stringify({ name: "app", ...declared }));
      await ok(project, "install");

      const spec = await (await source(project, kind, "new-pkga", "2.0.0"))(project, "");
      await ok(project, "add", spec);
      const after = await settled(project);
      // Each entry takes the spec, so the row bun.lock keeps for the name agrees with package.json whichever group wins.
      expect(JSON.parse(after.packageJson)).toEqual({
        name: "app",
        ...Object.fromEntries(groups.map(group => [group, { pkga: spec }])),
      });
      expect(after.installed).toBe("2.0.0");
    },
  );

  test.concurrent.each([
    ["./a-v1", "./a-v2"],
    ["./a-v1", "pkga@./a-v2"],
    ["pkga@./a-v2", "./a-v1"],
  ])("bun add %s %s is refused: one package, two specs", async (first, second) => {
    using dir = tempDir("bun-add-declared-name", {});
    const project = String(dir);
    const before = JSON.stringify({ name: "app" });
    await Promise.all([
      Bun.write(join(project, "package.json"), before),
      Bun.write(join(project, "a-v1", "package.json"), manifest("1.0.0")),
      Bun.write(join(project, "a-v2", "package.json"), manifest("2.0.0")),
    ]);

    const { err, exitCode } = await run(project, "add", first, second);
    expect(err).toContain(`error: "${first}" and "${second}" both resolve to "pkga"\nnote: add only one of them`);
    expect(exitCode).toBe(1);
    expect(await file(join(project, "package.json")).text()).toBe(before);
    expect(await Bun.file(join(project, "bun.lock")).exists()).toBeFalse();
  });
});

it("should replace a registry dependency when adding a local folder with the same package name", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await Promise.all([
    writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } }),
    ),
    Bun.write(join(package_dir, "bar-fork", "package.json"), JSON.stringify({ name: "bar", version: "0.0.2-fork" })),
  ]);

  for (const args of [["install"], ["add", "./bar-fork"], ["install", "--frozen-lockfile"]]) {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), ...args, "--save-text-lockfile"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "foo",
    version: "0.0.1",
    dependencies: { bar: "./bar-fork" },
  });
  expect(await file(join(package_dir, "node_modules", "bar", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2-fork",
  });
  const lockfileText = await file(join(package_dir, "bun.lock")).text();
  expect(lockfileText.match(/"bar":/g)).toHaveLength(2);
  const lockfile = Bun.JSONC.parse(lockfileText) as BunLockFile;
  expect(lockfile.workspaces[""].dependencies).toEqual({ bar: "./bar-fork" });
  expect(lockfile.packages).toEqual({ bar: ["bar@file:bar-fork", {}] });
});

// https://github.com/oven-sh/bun/issues/13244
describe("--dry-run in a folder without a package.json", () => {
  it.each(["add", "install"])("`bun %s <package>` creates nothing", async command => {
    setHandler(dummyRegistry([]));
    using dir = tempDir("bun-add-dry-run", {});
    using cache = tempDir("bun-add-dry-run-cache", {});

    await using proc = spawn({
      cmd: [bunExe(), command, "BaR", "--dry-run", "--registry", root_url + "/"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...env, BUN_INSTALL_CACHE_DIR: String(cache) },
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(err).not.toContain("Saved lockfile");
    expect(out).toContain("installed BaR@0.0.2");
    expect(await readdirSorted(String(dir))).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it("`bun add -g <package>` leaves a new global directory empty", async () => {
    using home = tempDir("bun-add-global-dry-run", {
      "package.json": JSON.stringify({ name: "home-project" }),
      "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
    });
    const globalDir = join(String(home), ".bun", "install", "global");

    await using proc = spawn({
      cmd: [bunExe(), "add", "-g", "--dry-run", join(String(home), "pkg")],
      cwd: String(home),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        HOME: String(home),
        BUN_INSTALL: join(String(home), ".bun"),
        BUN_INSTALL_GLOBAL_DIR: globalDir,
        BUN_INSTALL_BIN: join(String(home), ".bun", "bin"),
      },
    });
    const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(err).not.toContain("error:");
    expect(await readdirSorted(globalDir)).toEqual([]);
    expect(await readdirSorted(String(home))).toEqual([".bun", "package.json", "pkg"]);
    expect(await file(join(String(home), "package.json")).json()).toEqual({ name: "home-project" });
    expect(exitCode).toBe(0);
  });
});

// `-g` names its project: the global directory. A package.json above it (~/package.json) is another project's.
describe("-g and a package.json above the global directory", () => {
  const strayRoot = (fields: object = {}) => JSON.stringify({ name: "stray-root", version: "1.0.0", ...fields });

  // Every global location is below `home`, so the ambient BUN_INSTALL* cannot redirect these tests. The registry
  // knows no package: an `add` of one fails after `init` has chosen the project.
  async function runGlobal(home: string, ...args: string[]) {
    await using registry = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) });
    await using proc = spawn({
      cmd: [bunExe(), ...args, "-g", `--registry=${registry.url}`],
      cwd: home,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        HOME: home,
        BUN_INSTALL: join(home, ".bun"),
        BUN_INSTALL_GLOBAL_DIR: join(home, ".bun", "install", "global"),
        BUN_INSTALL_BIN: join(home, ".bun", "bin"),
      },
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const globalDirOf = (home: string) => join(home, ".bun", "install", "global");

  it.each(["add", "install"])("the first `bun %s -g` creates the global package.json", async command => {
    using home = tempDir("bun-add-global-home-project", {
      "package.json": strayRoot({ dependencies: { tool: "file:./tool" }, trustedDependencies: ["tool"] }),
      "tool/package.json": JSON.stringify({
        name: "tool",
        version: "1.0.0",
        scripts: { postinstall: "echo ran > ran.txt" },
      }),
      "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
    });
    const before = await file(join(String(home), "package.json")).text();

    const { stdout, stderr, exitCode } = await runGlobal(String(home), command, join(String(home), "pkg"));
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("installed pkg@");
    expect(await file(join(globalDirOf(String(home)), "package.json")).json()).toEqual({
      dependencies: { pkg: expect.any(String) },
    });
    expect(await readdirSorted(join(globalDirOf(String(home)), "node_modules"))).toEqual(["pkg"]);
    // No lockfile, no node_modules, no script of that project.
    expect(await readdirSorted(String(home))).toEqual([".bun", "package.json", "pkg", "tool"]);
    expect(await readdirSorted(join(String(home), "tool"))).toEqual(["package.json"]);
    expect(await file(join(String(home), "package.json")).text()).toBe(before);
    expect(exitCode).toBe(0);
  });

  it.each([
    [
      "a package-lock.json bun cannot migrate",
      {
        "package.json": strayRoot(),
        "package-lock.json": JSON.stringify({ name: "stray-root", lockfileVersion: 1, dependencies: {} }),
      },
    ],
    [
      "workspaces",
      {
        "package.json": strayRoot({
          workspaces: ["packages/*"],
          dependencies: { "@scope/nonexistent": "workspace:*" },
        }),
      },
    ],
    [
      "workspaces that list the global directory, which has a package.json",
      {
        "package.json": strayRoot({
          workspaces: [".bun/install/global"],
          dependencies: { "@scope/nonexistent": "workspace:*" },
        }),
        ".bun/install/global/package.json": JSON.stringify({ name: "g", version: "1.0.0" }),
      },
    ],
  ])("`bun add -g` does not read a project with %s", async (_, files) => {
    using home = tempDir("bun-add-global-parent", files);

    const { stderr, exitCode } = await runGlobal(String(home), "add", "chalk");
    expect(stderr).not.toContain("lockfileVersion");
    expect(stderr).not.toContain("@scope/nonexistent");
    // It got as far as asking the registry.
    expect(stderr).toContain("chalk");
    expect(stderr).toContain("404");
    expect(await file(join(String(home), "package.json")).text()).toBe(files["package.json"]);
    expect(exitCode).toBe(1);
  });

  const lock = JSON.stringify({ lockfileVersion: 1, workspaces: { "": { dependencies: { pkg: "1.0.0" } } } });

  // They don't create an empty global package.json either, which would make the lockfile lose every package.
  it.each([
    [["update"], "nothing to update"],
    [["remove", "pkg"], "nothing to remove"],
    [["outdated"], "missing package.json"],
  ])("`bun %p -g` has no project without a global package.json", async (args, message) => {
    using home = tempDir("bun-global-lock-no-manifest", {
      "package.json": strayRoot({ dependencies: { pkg: "1.0.0" } }),
      ".bun/install/global/bun.lock": lock,
    });

    const { stderr, exitCode } = await runGlobal(String(home), ...args);
    expect(stderr).toContain(message);
    expect(await readdirSorted(globalDirOf(String(home)))).toEqual(["bun.lock"]);
    expect(await file(join(globalDirOf(String(home)), "bun.lock")).text()).toBe(lock);
    expect(await readdirSorted(String(home))).toEqual([".bun", "package.json"]);
    expect(exitCode).toBe(1);
  });

  it.each([
    ["before the first global install", {}, []],
    ["beside a global bun.lock", { ".bun/install/global/bun.lock": lock }, ["bun.lock"]],
  ])("`bun pm bin -g` writes nothing %s", async (_, files, entries) => {
    using home = tempDir("bun-pm-bin-global", { "package.json": strayRoot(), ...files });

    const { stdout, stderr, exitCode } = await runGlobal(String(home), "pm", "bin");
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(join(String(home), ".bun", "bin"));
    expect(await readdirSorted(globalDirOf(String(home)))).toEqual(entries);
    expect(exitCode).toBe(0);
  });
});
