import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readlinkSync, statSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isWindows, readdirSorted } from "harness";
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

// A workspace that is packaged by tools which walk `node_modules` (Electron packagers,
// serverless bundlers) needs a *complete* and *physical* node_modules of its own:
// nothing it (transitively) depends on may be hoisted above it, and the files must be
// real copies rather than links into the cache.

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
setDefaultTimeout(1000 * 60 * 5);

beforeEach(async () => {
  await dummyBeforeEach({ linker: "hoisted" });
  setHandler(
    dummyRegistry([], {
      "0.0.2": {},
      "0.0.3": {},
      "0.1.0": { dependencies: { bar: "0.0.2" } },
      latest: "0.0.3",
    }),
  );
});
afterEach(dummyAfterEach);

async function install(cwd: string, args: string[] = []) {
  await using proc = spawn({ cmd: [bunExe(), "install", ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, code };
}

async function writeProject(desktopExtra: object, bunfigExtra: object) {
  await writeFile(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: false, registry: root_url + "/", saveTextLockfile: true, linker: "hoisted", ...bunfigExtra },
    }),
  );
  await mkdir(join(package_dir, "apps", "desktop"), { recursive: true });
  await mkdir(join(package_dir, "apps", "web"), { recursive: true });
  await mkdir(join(package_dir, "packages", "shared"), { recursive: true });
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["apps/*", "packages/*"],
      dependencies: { bar: "0.0.2" },
    }),
  );
  await writeFile(
    join(package_dir, "apps", "desktop", "package.json"),
    JSON.stringify({
      name: "desktop",
      version: "1.0.0",
      ...desktopExtra,
      dependencies: { "@barn/moo": "0.1.0", shared: "workspace:*" },
    }),
  );
  await writeFile(
    join(package_dir, "apps", "web", "package.json"),
    JSON.stringify({ name: "web", version: "1.0.0", dependencies: { bar: "0.0.2", qux: "0.0.2" } }),
  );
  await writeFile(
    join(package_dir, "packages", "shared", "package.json"),
    JSON.stringify({ name: "shared", version: "1.0.0", dependencies: { baz: "0.0.3" } }),
  );
}

describe.each([
  [
    "installConfig.hoistingLimits in the workspace's package.json",
    { installConfig: { hoistingLimits: "workspaces" } },
    {},
  ],
  ["install.selfContainedWorkspaces in bunfig.toml", {}, { selfContainedWorkspaces: ["apps/desktop"] }],
] as const)("self-contained workspace via %s", (_label, desktopExtra, bunfigExtra) => {
  it("gets a complete, physical node_modules while other workspaces still hoist", async () => {
    await writeProject(desktopExtra, bunfigExtra);
    const r = await install(package_dir);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);

    const desktopNm = join(package_dir, "apps", "desktop", "node_modules");
    // desktop's direct dep, its transitive dep, the workspace it depends on and *that*
    // workspace's dep are all under apps/desktop/node_modules …
    expect(await readdirSorted(desktopNm)).toEqual(["@barn", "bar", "baz", "shared"]);
    expect(existsSync(join(desktopNm, "@barn", "moo", "package.json"))).toBeTrue();
    expect(readlinkSync(join(desktopNm, "shared"))).toContain("shared");
    // … as real files, not hardlinks into the cache
    if (!isWindows) {
      expect(statSync(join(desktopNm, "bar", "package.json")).nlink).toBe(1);
    }
    // even though `bar` also exists at the root for the root package / other workspaces
    expect(existsSync(join(package_dir, "node_modules", "bar", "package.json"))).toBeTrue();
    // the other workspace hoists as usual
    expect(existsSync(join(package_dir, "node_modules", "qux", "package.json"))).toBeTrue();
    expect(existsSync(join(package_dir, "apps", "web", "node_modules", "qux"))).toBeFalse();

    // stable across a repeat / frozen install …
    let again = await install(package_dir, ["--frozen-lockfile"]);
    expect(again.err).not.toContain("error:");
    expect(again.code).toBe(0);
    expect(await readdirSorted(desktopNm)).toEqual(["@barn", "bar", "baz", "shared"]);
    // … and when installing from the existing lockfile into a clean tree (no dependency
    // changes, so nothing is re-resolved — the layout must still come out self-contained)
    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    await rm(desktopNm, { recursive: true, force: true });
    again = await install(package_dir, []);
    expect(again.err).not.toContain("error:");
    expect(again.code).toBe(0);
    expect(await readdirSorted(desktopNm)).toEqual(["@barn", "bar", "baz", "shared"]);
    if (!isWindows) {
      expect(statSync(join(desktopNm, "bar", "package.json")).nlink).toBe(1);
    }
  });
});

it("without either setting the workspace is hoisted normally", async () => {
  await writeProject({}, {});
  const r = await install(package_dir);
  expect(r.err).not.toContain("error:");
  expect(r.code).toBe(0);
  expect(existsSync(join(package_dir, "apps", "desktop", "node_modules"))).toBeFalse();
  expect(existsSync(join(package_dir, "node_modules", "@barn", "moo", "package.json"))).toBeTrue();
  expect(existsSync(join(package_dir, "node_modules", "baz", "package.json"))).toBeTrue();
});
