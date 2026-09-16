// Migrates one package-lock.json that combines many of the shapes the npm migrator handles, then installs
// it: workspace packages (one linked under two names, with a dependency nested in it), a `file:` folder and
// a `file:` tarball, a remote tarball URL, `npm:` aliases (including a self-named alias inside a linked
// folder), a scoped transitive, version conflicts that force nested installs, optional dependencies with
// `os`/`cpu`, a `bin`, and install scripts of a workspace and of a default-trusted registry package.
// Every tarball is served locally. Git resolutions are not here: migrate.test.ts covers them.
import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "fs";
import { VerdaccioRegistry, bunEnv, bunExe, isWindows, pack, tmpdirSync } from "harness";
import path from "path";

const registry = new VerdaccioRegistry();
let tarballServer: ReturnType<typeof Bun.serve>;
let cwd: string | undefined = tmpdirSync();

function validate(packagePath: string, version: string, realPackageName?: string) {
  test(`${packagePath} is ${realPackageName ? `${realPackageName}@${version}` : version}`, () => {
    if (!cwd) throw new Error("install failed");
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, packagePath, "package.json"), "utf8"));
    expect(pkg.version).toBe(version);
    if (realPackageName) {
      expect(pkg.name).toBe(realPackageName);
    }
  });
}

function mustExist(filePath: string) {
  test(`${filePath} exists`, () => {
    if (!cwd) throw new Error("install failed");
    if (!fs.existsSync(path.join(cwd, filePath))) {
      throw new Error(`File ${filePath} was not found`);
    }
  });
}

function mustNotExist(filePath: string) {
  test(`${filePath} does not exist`, () => {
    if (!cwd) throw new Error("install failed");
    if (fs.existsSync(path.join(cwd, filePath))) {
      throw new Error(`File ${filePath} was found`);
    }
  });
}

// The lockfile entry npm writes for a registry package: where the local registry serves it, and the
// integrity that registry's checked-in manifest records for the tarball.
function registryEntry(name: string, version: string) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(import.meta.dir, "..", "registry", "packages", name, "package.json"), "utf8"),
  );
  return {
    version,
    resolved: `${registry.registryUrl()}${name}/-/${name.split("/").pop()}-${version}.tgz`,
    integrity: manifest.versions[version].dist.integrity as string,
  };
}

beforeAll(async () => {
  await registry.start();

  // Remote tarball dependency: serve bar-0.0.2.tgz over loopback instead of github.com.
  const barTgz = fs.readFileSync(path.join(import.meta.dir, "..", "bar-0.0.2.tgz"));
  tarballServer = Bun.serve({
    port: 0,
    fetch: () => new Response(barTgz),
  });
  const barUrl = `http://localhost:${tarballServer.port}/bar-0.0.2.tgz`;
  const barIntegrity = "sha512-" + Buffer.from(await crypto.subtle.digest("SHA-512", barTgz)).toString("base64");

  const write = (rel: string, content: string) => {
    const full = path.join(cwd!, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  write(
    "package.json",
    JSON.stringify({
      name: "root",
      version: "0.0.0",
      dependencies: {
        "a-dep": "1.0.10",
        "bar": barUrl,
        "bun-types": "file:bun-types",
        "hello": "file:hello-0.3.2.tgz",
        "is-number": "^1.0.0",
      },
      workspaces: ["packages/*"],
    }),
  );

  write(
    "bun-types/package.json",
    JSON.stringify({
      name: "bun-types",
      version: "1.0.0",
      dependencies: { "bun-types": "npm:no-deps@^1.0.0" },
    }),
  );
  write("bun-types/isfake.txt", "");

  // body-parser is linked into node_modules under two names (`body-parser` and `not-body-parser`), and its
  // a-dep conflicts with the hoisted one, so the linker meets the nested package once per name.
  write(
    "packages/body-parser/package.json",
    JSON.stringify({ name: "body-parser", version: "200.0.0", dependencies: { "a-dep": "1.0.3" } }),
  );
  // `lol` depended on esbuild in the original fixture. optional-native and what-bin keep what esbuild
  // brought into the lockfile: optional platform packages with `os`/`cpu`, and a `bin`.
  const lolDependencies = { "no-deps": "^2.0.0", "optional-native": "1.0.0", "what-bin": "1.0.0" };
  write("packages/lol-package/package.json", JSON.stringify({ name: "lol", dependencies: lolDependencies }));
  write(
    "packages/second/package.json",
    JSON.stringify({
      name: "second",
      version: "3.0.0",
      dependencies: {
        "a-dep": "1.0.5",
        "body-parser": "npm:two-range-deps@1.0.0",
        "express": "npm:a-dep@*",
        "lol": "*",
        "not-body-parser": "*",
      },
    }),
  );
  write(
    "packages/with-postinstall/package.json",
    JSON.stringify({
      name: "with-postinstall",
      version: "1.0.0",
      dependencies: { "a-dep": "1.0.2", "electron": "1.0.0", "lifecycle-postinstall": "1.0.0" },
      scripts: { postinstall: `${JSON.stringify(bunExe())} postinstall.js` },
    }),
  );
  write(
    "packages/with-postinstall/postinstall.js",
    `require("fs").writeFileSync(require("path").join(__dirname, "postinstall.txt"), "i ran!");\n`,
  );

  // `file:` tarball dependency with a transitive dep that resolves against the local registry.
  const helloSrc = tmpdirSync();
  fs.writeFileSync(
    path.join(helloSrc, "package.json"),
    JSON.stringify({ name: "hello", version: "0.3.2", dependencies: { "a-dep": "^1.0.0" } }),
  );
  fs.writeFileSync(path.join(helloSrc, "version.txt"), "0.3.2\n");
  await pack(helloSrc, bunEnv, "--destination", cwd!);
  if (!fs.existsSync(path.join(cwd!, "hello-0.3.2.tgz"))) throw new Error("failed to pack hello");
  const helloIntegrity =
    "sha512-" +
    Buffer.from(await crypto.subtle.digest("SHA-512", fs.readFileSync(path.join(cwd!, "hello-0.3.2.tgz")))).toString(
      "base64",
    );

  write(
    "package-lock.json",
    JSON.stringify(
      {
        name: "root",
        version: "0.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": {
            name: "root",
            version: "0.0.0",
            workspaces: ["packages/*"],
            dependencies: {
              "a-dep": "1.0.10",
              "bar": barUrl,
              "bun-types": "file:bun-types",
              "hello": "file:hello-0.3.2.tgz",
              "is-number": "^1.0.0",
            },
          },
          "bun-types": {
            version: "1.0.0",
            dependencies: { "bun-types": "npm:no-deps@^1.0.0" },
          },
          "bun-types/node_modules/bun-types": {
            name: "no-deps",
            ...registryEntry("no-deps", "1.0.0"),
          },
          "node_modules/@types/is-number": {
            ...registryEntry("@types/is-number", "2.0.0"),
          },
          "node_modules/a-dep": {
            ...registryEntry("a-dep", "1.0.10"),
          },
          "node_modules/bar": {
            version: "0.0.2",
            resolved: barUrl,
            integrity: barIntegrity,
          },
          "node_modules/body-parser": { resolved: "packages/body-parser", link: true },
          "node_modules/bun-types": { resolved: "bun-types", link: true },
          // with-postinstall depended on sharp in the original fixture. The registry's electron is also on the
          // default trusted list, and its preinstall script writes preinstall.txt.
          "node_modules/electron": {
            ...registryEntry("electron", "1.0.0"),
            hasInstallScript: true,
          },
          "node_modules/express": {
            name: "a-dep",
            ...registryEntry("a-dep", "1.0.10"),
          },
          "node_modules/hello": {
            version: "0.3.2",
            resolved: "file:hello-0.3.2.tgz",
            integrity: helloIntegrity,
            dependencies: { "a-dep": "^1.0.0" },
          },
          "node_modules/is-number": {
            ...registryEntry("is-number", "1.0.0"),
          },
          // Not trusted, so its postinstall script is blocked. The install counts it as blocked only because
          // the migrated entry says it has an install script.
          "node_modules/lifecycle-postinstall": {
            ...registryEntry("lifecycle-postinstall", "1.0.0"),
            hasInstallScript: true,
          },
          "node_modules/lol": { resolved: "packages/lol-package", link: true },
          // No platform is named "foo" or "bar", so none of these three may be installed.
          "node_modules/native-bar-x64": {
            ...registryEntry("native-bar-x64", "1.0.0"),
            cpu: ["x64"],
            optional: true,
            os: ["bar"],
          },
          "node_modules/native-foo-x64": {
            ...registryEntry("native-foo-x64", "1.0.0"),
            cpu: ["x64"],
            optional: true,
            os: ["foo"],
          },
          "node_modules/native-foo-x86": {
            ...registryEntry("native-foo-x86", "1.0.0"),
            cpu: ["x86"],
            optional: true,
            os: ["foo"],
          },
          "node_modules/not-body-parser": { resolved: "packages/body-parser", link: true },
          "node_modules/optional-native": {
            ...registryEntry("optional-native", "1.0.0"),
            optionalDependencies: { "native-bar-x64": "1.0.0", "native-foo-x64": "1.0.0", "native-foo-x86": "1.0.0" },
          },
          "node_modules/second": { resolved: "packages/second", link: true },
          "node_modules/what-bin": {
            ...registryEntry("what-bin", "1.0.0"),
            bin: { "what-bin": "what-bin.js" },
          },
          "node_modules/with-postinstall": { resolved: "packages/with-postinstall", link: true },
          "packages/body-parser": { version: "200.0.0", dependencies: { "a-dep": "1.0.3" } },
          "packages/body-parser/node_modules/a-dep": {
            ...registryEntry("a-dep", "1.0.3"),
          },
          "packages/lol-package": { name: "lol", dependencies: lolDependencies },
          "packages/lol-package/node_modules/no-deps": {
            ...registryEntry("no-deps", "2.0.0"),
          },
          "packages/second": {
            version: "3.0.0",
            dependencies: {
              "a-dep": "1.0.5",
              "body-parser": "npm:two-range-deps@1.0.0",
              "express": "npm:a-dep@*",
              "lol": "*",
              "not-body-parser": "*",
            },
          },
          "packages/second/node_modules/a-dep": {
            ...registryEntry("a-dep", "1.0.5"),
          },
          "packages/second/node_modules/body-parser": {
            name: "two-range-deps",
            ...registryEntry("two-range-deps", "1.0.0"),
            // left-pad is listed only here, with no matching `packages` entry, so the migrator has
            // nothing to install for it. The `mustNotExist` checks below make that observable.
            dependencies: { "@types/is-number": ">=1.0.0", "no-deps": "^1.0.0", "left-pad": "1.0.0" },
          },
          // Workspace-rooted entry two node_modules segments deep: exercises the migrator's
          // nested-path walk past the first resolved level.
          "packages/second/node_modules/body-parser/node_modules/no-deps": {
            ...registryEntry("no-deps", "1.0.1"),
          },
          "packages/with-postinstall": {
            version: "1.0.0",
            hasInstallScript: true,
            dependencies: { "a-dep": "1.0.2", "electron": "1.0.0", "lifecycle-postinstall": "1.0.0" },
          },
          "packages/with-postinstall/node_modules/a-dep": {
            ...registryEntry("a-dep", "1.0.2"),
          },
        },
      },
      null,
      2,
    ),
  );

  await registry.writeBunfig(cwd!);
});

afterAll(() => {
  tarballServer?.stop();
  registry.stop();
});

test("the install succeeds", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    cwd = undefined;
    console.error(stderr);
    throw new Error("Failed to install");
  }
  expect(stderr).toContain("migrated lockfile from package-lock.json");
  expect(stdout).toContain("packages installed");
  expect(stdout).toContain("Blocked 1 postinstall. Run `bun pm untrusted` for details.");
});

// bun-types: `file:` folder with a self-named `npm:` alias
validate("node_modules/bun-types", "1.0.0");
mustExist("node_modules/bun-types/isfake.txt");
validate("node_modules/bun-types/node_modules/bun-types", "1.0.0", "no-deps");
mustNotExist("node_modules/bun-types/node_modules/bun-types/isfake.txt");

// a-dep: one hoisted version plus two nested per-workspace versions
validate("node_modules/a-dep", "1.0.10");
validate("packages/second/node_modules/a-dep", "1.0.5");
validate("packages/with-postinstall/node_modules/a-dep", "1.0.2");
validate("node_modules/express", "1.0.10", "a-dep");

// hello: `file:` tarball with a transitive dep
validate("node_modules/hello", "0.3.2");
mustExist("node_modules/hello/version.txt");

// bar: remote tarball URL
validate("node_modules/bar", "0.0.2");

// body-parser workspace and its aliases
validate("node_modules/body-parser", "200.0.0");
validate("node_modules/not-body-parser", "200.0.0", "body-parser");
validate("packages/body-parser/node_modules/a-dep", "1.0.3");
validate("node_modules/not-body-parser/node_modules/a-dep", "1.0.3");
validate("packages/second/node_modules/body-parser", "1.0.0", "two-range-deps");

// @types/is-number: scoped transitive of two-range-deps, hoisted
validate("node_modules/@types/is-number", "2.0.0");
validate("node_modules/is-number", "1.0.0");

// lol: workspace whose folder name differs from its package name. Its `^2.0.0` no-deps
// conflicts with the `1.0.1` pinned two levels deep under the aliased two-range-deps; bun
// hoists 2.0.0 to the root and preserves the pinned 1.0.1 at its nested path.
test("node_modules/lol links to packages/lol-package", () => {
  if (!cwd) throw new Error("install failed");
  expect(fs.realpathSync(path.join(cwd, "node_modules", "lol"))).toBe(
    fs.realpathSync(path.join(cwd, "packages", "lol-package")),
  );
});
validate("node_modules/no-deps", "2.0.0");
validate("packages/second/node_modules/body-parser/node_modules/no-deps", "1.0.1");
mustNotExist("packages/lol-package/node_modules/no-deps");

// optional-native: its optional dependencies are for platforms that do not exist
validate("node_modules/optional-native", "1.0.0");
mustNotExist("node_modules/native-bar-x64");
mustNotExist("node_modules/native-foo-x64");
mustNotExist("node_modules/native-foo-x86");

// what-bin: `bin` from the lockfile entry is linked
validate("node_modules/what-bin", "1.0.0");
mustExist(`node_modules/.bin/what-bin${isWindows ? ".exe" : ""}`);

// with-postinstall: lifecycle script ran
mustExist("packages/with-postinstall/postinstall.txt");

// electron: the install script of a default-trusted registry package ran
validate("node_modules/electron", "1.0.0");
mustExist("node_modules/electron/preinstall.txt");

// lifecycle-postinstall: the install script of a package that is not trusted did not run
validate("node_modules/lifecycle-postinstall", "1.0.0");
mustNotExist("node_modules/lifecycle-postinstall/postinstall.txt");

// left-pad appears in two-range-deps' lockfile `dependencies` with no matching `packages` entry,
// so the migrator must not install it anywhere.
mustNotExist("node_modules/left-pad");
mustNotExist("packages/second/node_modules/left-pad");
mustNotExist("packages/second/node_modules/body-parser/node_modules/left-pad");
