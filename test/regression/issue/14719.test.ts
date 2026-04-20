// https://github.com/oven-sh/bun/issues/14719
// `bun add <pkg> --filter=<workspace>` should add the package to the
// matching workspace's package.json, not the root package.json.

import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { bunExe, bunEnv as env } from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  root_url,
  setHandler,
} from "../../cli/install/dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(async () => {
  await dummyBeforeEach();
});
afterEach(dummyAfterEach);

async function setupMonorepo() {
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "monorepo",
      version: "0.0.0",
      workspaces: ["packages/*"],
    }),
  );
  await mkdir(join(package_dir, "packages", "api"), { recursive: true });
  await mkdir(join(package_dir, "packages", "web"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "api", "package.json"),
    JSON.stringify({ name: "api", version: "1.0.0" }),
  );
  await writeFile(
    join(package_dir, "packages", "web", "package.json"),
    JSON.stringify({ name: "web", version: "1.0.0" }),
  );
}

it("bun add --filter=<name> adds to the matching workspace, not the root", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {} }));
  await setupMonorepo();

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "baz", "--filter=api"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  const out = await stdout.text();
  expect(err).not.toContain("error:");
  expect(out).toContain("installed baz@0.0.3");
  expect(await exited).toBe(0);

  // Root package.json should be untouched.
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "monorepo",
    version: "0.0.0",
    workspaces: ["packages/*"],
  });

  // api should have the dependency with the resolved version.
  expect(await file(join(package_dir, "packages", "api", "package.json")).json()).toEqual({
    name: "api",
    version: "1.0.0",
    dependencies: {
      baz: "^0.0.3",
    },
  });

  // web should be untouched.
  expect(await file(join(package_dir, "packages", "web", "package.json")).json()).toEqual({
    name: "web",
    version: "1.0.0",
  });

  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
});

it("bun add --filter='*' adds to every workspace", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {} }));
  await setupMonorepo();

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "baz", "--filter", "*"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  const out = await stdout.text();
  expect(err).not.toContain("error:");
  expect(out).toContain("installed baz@0.0.3");
  expect(await exited).toBe(0);

  // Root package.json should be untouched.
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "monorepo",
    version: "0.0.0",
    workspaces: ["packages/*"],
  });

  expect(await file(join(package_dir, "packages", "api", "package.json")).json()).toEqual({
    name: "api",
    version: "1.0.0",
    dependencies: { baz: "^0.0.3" },
  });

  expect(await file(join(package_dir, "packages", "web", "package.json")).json()).toEqual({
    name: "web",
    version: "1.0.0",
    dependencies: { baz: "^0.0.3" },
  });

  // Even with two matched workspaces, there should be exactly one install
  // (one metadata request, one tarball fetch).
  expect(urls.sort()).toEqual([`${root_url}/baz`, `${root_url}/baz-0.0.3.tgz`]);
});

it("bun add -d --filter puts the dependency in devDependencies", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {} }));
  await setupMonorepo();

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "-d", "baz", "--filter=web"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  const out = await stdout.text();
  expect(out).toContain("installed baz@0.0.3");
  expect(await exited).toBe(0);

  expect(await file(join(package_dir, "packages", "web", "package.json")).json()).toEqual({
    name: "web",
    version: "1.0.0",
    devDependencies: { baz: "^0.0.3" },
  });

  expect(await file(join(package_dir, "packages", "api", "package.json")).json()).toEqual({
    name: "api",
    version: "1.0.0",
  });
});

it("bun add --filter with a path pattern matches by workspace directory", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {} }));
  await setupMonorepo();

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "baz", "--filter", "./packages/api"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  const out = await stdout.text();
  expect(out).toContain("installed baz@0.0.3");
  expect(await exited).toBe(0);

  expect(await file(join(package_dir, "packages", "api", "package.json")).json()).toEqual({
    name: "api",
    version: "1.0.0",
    dependencies: { baz: "^0.0.3" },
  });

  expect(await file(join(package_dir, "packages", "web", "package.json")).json()).toEqual({
    name: "web",
    version: "1.0.0",
  });
});

it("bun add -F '*' --filter '!api' combines the short alias with negation", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {} }));
  await setupMonorepo();

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "baz", "-F", "*", "--filter", "!api"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  const out = await stdout.text();
  expect(out).toContain("installed baz@0.0.3");
  expect(await exited).toBe(0);

  // Root untouched.
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "monorepo",
    version: "0.0.0",
    workspaces: ["packages/*"],
  });

  // api was negated, so unchanged.
  expect(await file(join(package_dir, "packages", "api", "package.json")).json()).toEqual({
    name: "api",
    version: "1.0.0",
  });

  // web matched '*' and wasn't negated.
  expect(await file(join(package_dir, "packages", "web", "package.json")).json()).toEqual({
    name: "web",
    version: "1.0.0",
    dependencies: { baz: "^0.0.3" },
  });
});

it("bun add --filter works when run from inside a workspace directory", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {} }));
  await setupMonorepo();
  await writeFile(
    join(package_dir, "packages", "api", "bunfig.toml"),
    await file(join(package_dir, "bunfig.toml")).text(),
  );

  // Run from packages/api, but target web via --filter.
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "baz", "--filter=web"],
    cwd: join(package_dir, "packages", "api"),
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  const out = await stdout.text();
  expect(out).toContain("installed baz@0.0.3");
  expect(await exited).toBe(0);

  // api (where we ran from) should be untouched.
  expect(await file(join(package_dir, "packages", "api", "package.json")).json()).toEqual({
    name: "api",
    version: "1.0.0",
  });

  // web got the dependency.
  expect(await file(join(package_dir, "packages", "web", "package.json")).json()).toEqual({
    name: "web",
    version: "1.0.0",
    dependencies: { baz: "^0.0.3" },
  });
});

it("bun remove --filter removes from the matching workspace only", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {} }));
  // Root also depends on baz — --filter should never touch the root manifest.
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "monorepo",
      version: "0.0.0",
      workspaces: ["packages/*"],
      dependencies: { baz: "^0.0.3" },
    }),
  );
  await mkdir(join(package_dir, "packages", "api"), { recursive: true });
  await mkdir(join(package_dir, "packages", "web"), { recursive: true });
  await writeFile(
    join(package_dir, "packages", "api", "package.json"),
    JSON.stringify({ name: "api", version: "1.0.0", dependencies: { baz: "^0.0.3" } }),
  );
  await writeFile(
    join(package_dir, "packages", "web", "package.json"),
    JSON.stringify({ name: "web", version: "1.0.0", dependencies: { baz: "^0.0.3" } }),
  );

  const { stderr, exited } = spawn({
    cmd: [bunExe(), "remove", "baz", "--filter=api"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(await exited).toBe(0);

  // Root still has baz.
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "monorepo",
    version: "0.0.0",
    workspaces: ["packages/*"],
    dependencies: { baz: "^0.0.3" },
  });

  expect(await file(join(package_dir, "packages", "api", "package.json")).json()).toEqual({
    name: "api",
    version: "1.0.0",
  });

  expect(await file(join(package_dir, "packages", "web", "package.json")).json()).toEqual({
    name: "web",
    version: "1.0.0",
    dependencies: { baz: "^0.0.3" },
  });
});

it("bun remove --filter with a glob removes from every matching workspace", async () => {
  // https://github.com/oven-sh/bun/issues/27897
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {} }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "monorepo",
      version: "0.0.0",
      workspaces: ["packages/*"],
    }),
  );
  for (const name of ["pkg-a", "pkg-b", "other"]) {
    await mkdir(join(package_dir, "packages", name), { recursive: true });
    await writeFile(
      join(package_dir, "packages", name, "package.json"),
      JSON.stringify({ name, version: "1.0.0", dependencies: { baz: "^0.0.3" } }),
    );
  }

  const { stderr, exited } = spawn({
    cmd: [bunExe(), "remove", "baz", "--filter", "pkg-*"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(await exited).toBe(0);

  expect(await file(join(package_dir, "packages", "pkg-a", "package.json")).json()).toEqual({
    name: "pkg-a",
    version: "1.0.0",
  });
  expect(await file(join(package_dir, "packages", "pkg-b", "package.json")).json()).toEqual({
    name: "pkg-b",
    version: "1.0.0",
  });
  // "other" doesn't match the glob, so it keeps the dependency.
  expect(await file(join(package_dir, "packages", "other", "package.json")).json()).toEqual({
    name: "other",
    version: "1.0.0",
    dependencies: { baz: "^0.0.3" },
  });
});

it("bun add --filter errors when no workspace matches", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {} }));
  await setupMonorepo();

  const { stderr, exited } = spawn({
    cmd: [bunExe(), "add", "baz", "--filter=does-not-exist"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).toContain("did not match any workspace");
  expect(await exited).toBe(1);

  // Nothing should have been written anywhere.
  expect(await file(join(package_dir, "package.json")).json()).toEqual({
    name: "monorepo",
    version: "0.0.0",
    workspaces: ["packages/*"],
  });
  expect(await file(join(package_dir, "packages", "api", "package.json")).json()).toEqual({
    name: "api",
    version: "1.0.0",
  });
});

it("bun add --filter errors when there is no workspaces field", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {} }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "not-a-monorepo",
      version: "0.0.0",
    }),
  );

  const { stderr, exited } = spawn({
    cmd: [bunExe(), "add", "baz", "--filter=api"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).toContain('requires a "workspaces" field');
  expect(await exited).toBe(1);
});
