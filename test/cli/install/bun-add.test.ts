import type { BunLockFile } from "bun";
import { $, file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { access, appendFile, copyFile, mkdir, readlink, rm, writeFile } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  readdirSorted,
  tempDir,
  tmpdirSync,
  toBeValidBin,
  toBeWorkspaceLink,
  toHaveBins,
} from "harness";
import { join, relative, resolve } from "path";
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
  expect(err).toContain(`error: Could not find package.json for "file:${add_path.replaceAll("\\", "/")}" dependency`);
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
        booop: `${server.url.href}/booop-0.0.1.tgz`,
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
      booop: `${server.url.href}/booop-0.0.1.tgz`,
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
    env,
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
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bin",
    ".bun",
    ".cache",
    expect.stringContaining(".old_modules-"),
    "bar",
    "baz",
  ]);
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
      const manifest = await response.json();
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
    env,
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
      env,
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

it("git dep without package.json and with default branch", async () => {
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
    env,
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
    env,
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
    "installed uglify-js@git+ssh://bun@github.com:mishoo/UglifyJS.git with binaries:",
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
    env,
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
    stdout: "pipe",
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
    stdout: "pipe",
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
    env,
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
    env,
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
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
    ".bun",
    ".cache",
    expect.stringContaining(".old_modules-"),
  ]);
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
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  const package_json = await file(join(package_dir, "node_modules", "baz", "package.json")).json();
  expect(package_json.name).toBe("baz");
  expect(package_json.version).toBe("0.0.3");
  (expect(await file(join(package_dir, "package.json")).text()).toInclude('"baz-0.0.3.tgz"'),
    await access(join(package_dir, "bun.lockb")));
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

describe("a spec without a name that resolves to a dependency package.json already declares", () => {
  type Kind = "folder" | "tarball" | "git";
  type Declared =
    | "none"
    | "dependencies"
    | "devDependencies"
    | "optionalDependencies"
    | "peerDependencies"
    | "optional peer";
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

  // package.json, bun.lock and node_modules agree, and stay as they are: no key twice, a frozen install passes, a second install changes nothing.
  async function settled(project: string, frozen = true) {
    const after = await state(project);
    expect(duplicateKeys(after.packageJson)).toEqual([]);
    expect(duplicateKeys(after.lockfile)).toEqual([]);
    if (frozen) await ok(project, "install", "--frozen-lockfile");
    await ok(project, "install");
    expect(await state(project)).toEqual(after);
    return after;
  }

  const declaredAxis: Declared[] = [
    "none",
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "optional peer",
  ];
  // Every group with a folder. The other kinds and the flags only where the group can change the outcome,
  // so that the file stays fast. `bun add --peer <spec>` over an optional peer of that name is left out:
  // it still writes the name twice into bun.lock.
  const cell = (declared: Declared, kind: Kind, flag: Flag) => ({ declared, kind, flag });
  const cells = [
    ...declaredAxis.map(declared => cell(declared, "folder", "")),
    ...(["none", "dependencies", "peerDependencies"] as Declared[]).flatMap(declared => [
      cell(declared, "tarball", ""),
      cell(declared, "git", ""),
    ]),
    ...(["none", "dependencies", "devDependencies", "peerDependencies"] as Declared[]).map(declared =>
      cell(declared, "folder", "-d"),
    ),
    ...declaredAxis
      .filter(declared => declared !== "optional peer")
      .map(declared => cell(declared, "folder", "--peer")),
  ];

  test.concurrent.each(cells)("bun add $flag <$kind>, declared: $declared", async ({ declared, kind, flag }) => {
    using dir = tempDir("bun-add-declared-name", {});
    const root = String(dir);
    const [oldSource, newSource] = await Promise.all([
      source(root, "folder", "old-pkga", "1.0.0"),
      source(root, kind, "new-pkga", "2.0.0"),
    ]);

    const declaredGroup = declared === "optional peer" ? "peerDependencies" : declared;
    const flagGroup = flag === "-d" ? "devDependencies" : flag === "--peer" ? "peerDependencies" : "dependencies";
    // The declared entry takes the spec when it is of the kind the flag asks for: a peer entry and the entry of
    // another group may share a name, so neither replaces the other.
    const replaces =
      declared !== "none" && (declaredGroup === "peerDependencies") === (flagGroup === "peerDependencies");

    const add = async (name: string) => {
      const project = join(root, name);
      const siblings = { "other-a": "file:./other-a", "other-z": "file:./other-z" };
      for (const sibling of Object.keys(siblings)) {
        await Bun.write(join(project, sibling, "package.json"), JSON.stringify({ name: sibling, version: "1.0.0" }));
      }
      const before: Record<string, any> = { name: "app", dependencies: { ...siblings } };
      if (declared !== "none") {
        before[declaredGroup] = { ...before[declaredGroup], pkga: await oldSource(project, "file:") };
        if (declared === "optional peer") before.peerDependenciesMeta = { pkga: { optional: true } };
      }
      await Bun.write(join(project, "package.json"), JSON.stringify(before));
      if (declared !== "none") await ok(project, "install");

      const spec = await newSource(project, "");
      const out = await ok(project, "add", ...(flag ? [flag] : []), name === "named" ? `pkga@${spec}` : spec);
      expect(out).toContain("installed pkga@");
      return { project, before, spec };
    };

    // `bun add pkga@<spec>` is correct on every release, so it is the oracle where the declared entry is replaced. One kind is enough: the kind does not change what the named spec writes.
    const oracle = (replaces || declared === "none") && kind === "folder";
    const [bare, named] = await Promise.all([add("bare"), oracle ? add("named") : undefined]);

    const expected = structuredClone(bare.before);
    const group = replaces ? declaredGroup : flagGroup;
    expected[group] = { ...expected[group], pkga: bare.spec };
    // Where nothing is replaced the result is what 1.4.3 writes, so one follow-up install is enough there.
    const after = await settled(bare.project, replaces);
    expect(JSON.parse(after.packageJson)).toEqual(expected);
    // A peer entry next to the entry of another group does not decide what is installed.
    expect(after.installed).toBe(
      declared !== "none" && !replaces && flagGroup === "peerDependencies" ? "1.0.0" : "2.0.0",
    );
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
    expect(err).toContain(`error: "${first}" and "${second}" both resolve to "pkga"\nnote: add one of them`);
    expect(exitCode).toBe(1);
    expect(await file(join(project, "package.json")).text()).toBe(before);
    expect(await Bun.file(join(project, "bun.lock")).exists()).toBeFalse();
  });

  test.concurrent("two folders without a package name do not count as one package", async () => {
    using dir = tempDir("bun-add-declared-name", {});
    const project = String(dir);
    await Promise.all([
      Bun.write(join(project, "package.json"), JSON.stringify({ name: "app" })),
      Bun.write(join(project, "a", "package.json"), JSON.stringify({ version: "1.0.0" })),
      Bun.write(join(project, "b", "package.json"), JSON.stringify({ version: "2.0.0" })),
    ]);

    // The installer rejects a package without a name. It is the one to say so.
    const { err, exitCode } = await run(project, "add", "./a", "./b");
    expect(err).toContain("error: refusing to install dependency with unsafe name");
    expect(err).not.toContain("both resolve to");
    expect(exitCode).toBe(1);
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
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toStrictEqual(["index.js", "package.json"]);
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
