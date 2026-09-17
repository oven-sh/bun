import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, utimesSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
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
} from "./dummy.registry";

// The install-state fast path: after a successful install bun records a fingerprint of
// everything that determines node_modules; a repeat `bun install` with nothing changed
// verifies it and returns without re-walking node_modules. These tests check that it
// engages, and — more importantly — every kind of change that must invalidate it does.

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

let urls: string[];

async function install(cwd: string, args: string[] = []) {
  // the CI runner exports BUN_INSTALL_CACHE_DIR, which would override the bunfig cache
  // dir these tests inspect; pin it to the project's own cache
  await using proc = spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env: { ...env, BUN_INSTALL_CACHE_DIR: join(package_dir, ".cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, code };
}

const noChanges = /\(no changes\)/;

describe.each(["hoisted", "isolated"] as const)("install state (%s)", linker => {
  beforeEach(async () => {
    await dummyBeforeEach({ linker });
    urls = [];
    setHandler(dummyRegistry(urls, { "0.0.2": {}, "0.0.3": {}, "0.0.5": {} }));
    await writeFile(
      join(package_dir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: { dir: join(package_dir, ".cache") },
          registry: root_url + "/",
          saveTextLockfile: true,
          linker,
        },
      }),
    );
    await mkdir(join(package_dir, "packages", "a"), { recursive: true });
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        dependencies: { bar: "0.0.2" },
        devDependencies: { qux: "0.0.2" },
      }),
    );
    await writeFile(
      join(package_dir, "packages", "a", "package.json"),
      JSON.stringify({ name: "a", version: "1.0.0", dependencies: { baz: "0.0.3" } }),
    );
  });
  afterEach(dummyAfterEach);

  it("a repeat install is a no-op, and every relevant change invalidates it", async () => {
    let r = await install(package_dir);
    expect(r.err).not.toContain("error:");
    expect(r.err).toContain("Saved lockfile");
    expect(r.code).toBe(0);

    // 1. nothing changed → no requests, same summary wording as the classic no-op
    const before = urls.length;
    r = await install(package_dir);
    expect(r.out).toMatch(noChanges);
    expect(r.code).toBe(0);
    expect(urls.length).toBe(before);

    // 2. a workspace manifest edit is noticed
    await writeFile(
      join(package_dir, "packages", "a", "package.json"),
      JSON.stringify({ name: "a", version: "1.0.0", dependencies: { baz: "0.0.5" } }),
    );
    r = await install(package_dir);
    expect(r.err).toContain("Saved lockfile");
    expect(r.code).toBe(0);
    expect(await file(join(package_dir, "bun.lock")).text()).toContain("baz@0.0.5");

    // 3. a new workspace appearing under the glob is noticed (bump the parent's mtime
    //    explicitly so this does not depend on timestamp granularity)
    await mkdir(join(package_dir, "packages", "b"), { recursive: true });
    const pk = join(package_dir, "packages");
    utimesSync(pk, new Date(statSync(pk).mtimeMs + 2000), new Date(statSync(pk).mtimeMs + 2000));
    await writeFile(
      join(package_dir, "packages", "b", "package.json"),
      JSON.stringify({ name: "b", version: "1.0.0" }),
    );
    r = await install(package_dir);
    expect(r.err).toContain("Saved lockfile");
    expect(r.code).toBe(0);
    expect(await file(join(package_dir, "bun.lock")).text()).toContain('"packages/b"');

    // 4. removing something from node_modules is noticed and repaired
    await rm(join(package_dir, "node_modules", "bar"), { recursive: true, force: true });
    r = await install(package_dir);
    expect(r.code).toBe(0);
    expect(existsSync(join(package_dir, "node_modules", "bar", "package.json"))).toBeTrue();
    // (and after the repair we are clean again)
    expect((await install(package_dir)).out).toMatch(noChanges);

    // 5. deleting a file *inside* an installed package is noticed and repaired
    await rm(join(package_dir, "node_modules", "bar", "package.json"));
    r = await install(package_dir);
    expect(r.code).toBe(0);
    expect(existsSync(join(package_dir, "node_modules", "bar", "package.json"))).toBeTrue();

    // 6. flags are part of the fingerprint: state recorded by an `--omit=dev` run is not
    //    valid for a plain run (and vice versa)
    const stateDir = join(package_dir, ".cache", ".install-state");
    const stateFiles = await Array.fromAsync(new Bun.Glob("*").scan(stateDir));
    expect(stateFiles.length).toBe(1);
    const stateFile = join(stateDir, stateFiles[0]);
    const envLine = async () => (await file(stateFile).text()).split("\n").find(l => l.startsWith("e "));
    const plainState = await envLine();
    r = await install(package_dir, ["--omit=dev"]);
    expect(r.code).toBe(0);
    expect(await envLine()).not.toBe(plainState);
    r = await install(package_dir);
    expect(r.code).toBe(0);
    expect(await envLine()).toBe(plainState);
    expect((await install(package_dir)).out).toMatch(noChanges);

    // 7. --force always does the work
    r = await install(package_dir, ["--force"]);
    expect(r.out).not.toMatch(noChanges);
    expect(r.code).toBe(0);

    // 8. `--config <file>`: the alternate config's contents are fingerprinted too. (A
    //    full pass that finds nothing to do prints the same summary as the fast path, so
    //    observe it through the state file: only a full pass rewrites it.)
    const altConfig = (extra: object) =>
      Bun.TOML.stringify({
        install: {
          cache: { dir: join(package_dir, ".cache") },
          registry: root_url + "/",
          saveTextLockfile: true,
          linker,
          ...extra,
        },
      });
    // the file's env+argv line and stamps change whenever a full pass rewrites it
    const stateText = () => readFileSync(stateFile, "utf8");
    await writeFile(join(package_dir, "alt.toml"), altConfig({}));
    r = await install(package_dir, ["--config=alt.toml"]);
    expect(r.code).toBe(0);
    let m = stateText();
    r = await install(package_dir, ["--config=alt.toml"]);
    expect(r.out).toMatch(noChanges);
    expect(r.code).toBe(0);
    expect(stateText()).toBe(m);
    await writeFile(join(package_dir, "alt.toml"), altConfig({ dev: false }));
    r = await install(package_dir, ["--config=alt.toml"]);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    expect(stateText()).not.toBe(m);

    // 9. --dry-run does not touch node_modules, so it leaves the marker alone
    m = stateText();
    r = await install(package_dir, ["--config=alt.toml", "--dry-run"]);
    expect(r.code).toBe(0);
    r = await install(package_dir, ["--config=alt.toml"]);
    expect(r.out).toMatch(noChanges);
    expect(r.code).toBe(0);
    expect(stateText()).toBe(m);

    // 10. install.stateFile = false disables the fast path: no state is recorded, and the
    //    classic per-package verification still repairs node_modules
    await writeFile(
      join(package_dir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: { dir: join(package_dir, ".cache") },
          registry: root_url + "/",
          saveTextLockfile: true,
          linker,
          stateFile: false,
        },
      }),
    );
    expect((await install(package_dir)).code).toBe(0);
    await rm(join(package_dir, ".cache", ".install-state"), { recursive: true, force: true });
    await rm(join(package_dir, "node_modules", "bar", "package.json"));
    r = await install(package_dir);
    expect(r.code).toBe(0);
    expect(existsSync(join(package_dir, "node_modules", "bar", "package.json"))).toBeTrue();
    expect(existsSync(join(package_dir, ".cache", ".install-state"))).toBeFalse();
  });

  it("nested / store packages are verified like top-level ones (scoped removal, missing package.json)", async () => {
    // `@barn/moo` is only a transitive dependency (of bar), so under the isolated linker it
    // exists solely inside the store — no root node_modules entry covers it
    setHandler(
      dummyRegistry(urls, {
        "0.0.2": { dependencies: { "@barn/moo": "0.1.0" } },
        "0.0.3": {},
        "0.0.5": {},
        "0.1.0": {},
      }),
    );
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: { bar: "0.0.2" } }),
    );
    let r = await install(package_dir);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    r = await install(package_dir);
    expect(r.out).toMatch(noChanges);

    // where the real @barn/moo directory lives: hoisted → root node_modules; isolated → its
    // own store entry
    const store = join(package_dir, "node_modules", ".bun");
    const real =
      linker === "isolated"
        ? join(store, readdirSync(store).find(e => e.startsWith("@barn+moo"))!, "node_modules", "@barn", "moo")
        : join(package_dir, "node_modules", "@barn", "moo");
    expect(lstatSync(real).isDirectory()).toBeTrue();

    // 1. its package.json disappears (only the package dir's own mtime changes): repaired.
    //    (A full pass that only re-links prints the same summary as the fast path, so
    //    assert on the effect — the fast path would have left it missing.)
    await rm(join(real, "package.json"));
    r = await install(package_dir);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    expect(existsSync(join(real, "package.json"))).toBeTrue();
    r = await install(package_dir);
    expect(r.out).toMatch(noChanges);

    // 2. the whole scoped package directory disappears (only `@barn`'s mtime changes)
    await rm(real, { recursive: true, force: true });
    r = await install(package_dir);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    expect(existsSync(join(real, "package.json"))).toBeTrue();
  });

  it("local file: dependencies: untouched is a no-op, an edited source re-installs", async () => {
    await mkdir(join(package_dir, "local"), { recursive: true });
    await writeFile(join(package_dir, "local", "package.json"), JSON.stringify({ name: "local", version: "1.0.0" }));
    await writeFile(join(package_dir, "local", "index.js"), "module.exports = 1;");
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "root", dependencies: { local: "file:./local", bar: "0.0.2" } }),
    );

    let r = await install(package_dir);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    r = await install(package_dir);
    expect(r.out).toMatch(noChanges);
    expect(r.code).toBe(0);

    const src = join(package_dir, "local", "index.js");
    const before = statSync(src).mtimeMs;
    await writeFile(src, "module.exports = 2;");
    // make the edit observable regardless of timestamp granularity
    utimesSync(src, new Date(before + 2000), new Date(before + 2000));
    r = await install(package_dir);
    expect(r.out).not.toMatch(noChanges);
    expect(r.code).toBe(0);
    const installed =
      linker === "hoisted"
        ? join(package_dir, "node_modules", "local", "index.js")
        : join(package_dir, "node_modules", ".bun", "local@file+local", "node_modules", "local", "index.js");
    expect(await file(installed).text()).toBe("module.exports = 2;");
  });
});
