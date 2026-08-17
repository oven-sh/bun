import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

describe("pnpm-lock.yaml migration", () => {
  test("simple pnpm lockfile migration produces correct bun.lock", async () => {
    await using tmpDir = tempDir("pnpm-migrate-simple", {
      "package.json": JSON.stringify(
        {
          name: "simple-pnpm-test",
          version: "1.0.0",
          dependencies: {
            "is-number": "^7.0.0",
            "left-pad": "^1.3.0",
          },
        },
        null,
        2,
      ),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      is-number:
        specifier: ^7.0.0
        version: 7.0.0
      left-pad:
        specifier: ^1.3.0
        version: 1.3.0

packages:

  is-number@7.0.0:
    resolution: {integrity: sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==}
    engines: {node: '>=0.12.0'}

  left-pad@1.3.0:
    resolution: {integrity: sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQGinBN9yTQT3bFlCBy/aVx2HrNcqQGsdot8ghrjyrvMCoEA==}
    deprecated: use String.prototype.padStart()

snapshots:

  is-number@7.0.0: {}

  left-pad@1.3.0: {}
`,
    });

    // Run bun pm migrate
    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }
    expect(exitCode).toBe(0);

    // Check migration message in stderr
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");

    // Check that bun.lock was created
    expect(fs.existsSync(join(tmpDir, "bun.lock"))).toBe(true);

    // Read and snapshot the migrated lockfile
    const bunLockContent = fs.readFileSync(join(tmpDir, "bun.lock"), "utf8");
    expect(bunLockContent).toMatchSnapshot("simple-pnpm-migration");

    // Verify install works with migrated lockfile
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [installStdout, installStderr, installExitCode] = await Promise.all([
      installProc.stdout.text(),
      installProc.stderr.text(),
      installProc.exited,
    ]);

    if (installExitCode !== 0) {
      console.log("Install stdout:", installStdout);
      console.log("Install stderr:", installStderr);
      console.log("Lockfile content:", bunLockContent);
    }
    expect(installExitCode).toBe(0);

    // Verify packages were installed
    expect(fs.existsSync(join(tmpDir, "node_modules/is-number"))).toBe(true);
    expect(fs.existsSync(join(tmpDir, "node_modules/left-pad"))).toBe(true);
  });

  test("pnpm workspace lockfile migration", async () => {
    await using tmpDir = tempDir("pnpm-migrate-workspace", {
      "package.json": JSON.stringify(
        {
          name: "monorepo-root",
          version: "1.0.0",
          private: true,
          workspaces: ["packages/*", "apps/*"],
        },
        null,
        2,
      ),
      "pnpm-workspace.yaml": `packages:
  - 'packages/*'
  - 'apps/*'
`,
      "packages/ui/package.json": JSON.stringify(
        {
          name: "@repo/ui",
          version: "1.0.0",
          dependencies: {
            react: "^18.2.0",
          },
        },
        null,
        2,
      ),
      "packages/utils/package.json": JSON.stringify(
        {
          name: "@repo/utils",
          version: "1.0.0",
          dependencies: {
            lodash: "^4.17.21",
          },
        },
        null,
        2,
      ),
      "apps/web/package.json": JSON.stringify(
        {
          name: "@repo/web",
          version: "1.0.0",
          dependencies: {
            "@repo/ui": "workspace:*",
            "@repo/utils": "workspace:*",
            next: "^14.0.0",
          },
        },
        null,
        2,
      ),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies: {}

  apps/web:
    dependencies:
      '@repo/ui':
        specifier: workspace:*
        version: link:../../packages/ui
      '@repo/utils':
        specifier: workspace:*
        version: link:../../packages/utils
      next:
        specifier: ^14.0.0
        version: 14.0.4

  packages/ui:
    dependencies:
      react:
        specifier: ^18.2.0
        version: 18.2.0

  packages/utils:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:

  react@18.2.0:
    resolution: {integrity: sha512-/3IjMdb2L9QbBdWiW5e3P2/npwMBaU9mHCSCUzNln0ZCYbcfTsGbTJrU/kGemdH2IWmB2ioZ+zkxtmq6g09fGQ==}
    engines: {node: '>=0.10.0'}

  lodash@4.17.21:
    resolution: {integrity: sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==}

  next@14.0.4:
    resolution: {integrity: sha512-qbwypnM7327SadwFtxXnQdGiKpkuhaRLE2uq62/nRul9cj9KhQ5LhHmlziTNqUidZotw/Q1I9OjirBROdUJNgA==}
    engines: {node: '>=18.17.0'}
    hasBin: true

  loose-envify@1.4.0:
    resolution: {}
    hasBin: true

  js-tokens@4.0.0:
    resolution: {integrity: sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==}

snapshots:

  react@18.2.0:
    dependencies:
      loose-envify: 1.4.0

  lodash@4.17.21: {}

  next@14.0.4:
    dependencies:
      react: 18.2.0

  loose-envify@1.4.0:
    dependencies:
      js-tokens: 4.0.0

  js-tokens@4.0.0: {}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }
    expect(exitCode).toBe(0);

    // Check migration message in stderr
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");

    expect(fs.existsSync(join(tmpDir, "bun.lock"))).toBe(true);

    const bunLockContent = fs.readFileSync(join(tmpDir, "bun.lock"), "utf8");
    expect(bunLockContent).toMatchSnapshot("workspace-pnpm-migration");
    const packageJson = JSON.parse(fs.readFileSync(join(tmpDir, "package.json"), "utf8"));
    expect(packageJson).toMatchSnapshot("workspace-pnpm-migration-package-json");
  });

  test("pnpm with npm protocol aliases", async () => {
    await using tmpDir = tempDir("pnpm-migrate-npm-aliases", {
      "package.json": JSON.stringify(
        {
          name: "alias-test",
          dependencies: {
            "my-react": "npm:react@^17.0.0",
            "my-lodash": "npm:lodash@latest",
          },
        },
        null,
        2,
      ),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      my-react:
        specifier: npm:react@^17.0.0
        version: react@17.0.2
      my-lodash:
        specifier: npm:lodash@latest
        version: lodash@4.17.21

packages:
  react@17.0.2:
    resolution: {integrity: sha512-gnhPt75i/dq/z3/6q/0asP78D0u592D5L1pd7M8P+dck6Fu/jJeL6iVVK23fptSUZj8Vjf++7wXA8UNclGQcbA==}
    engines: {node: '>=0.10.0'}

  lodash@4.17.21:
    resolution: {integrity: sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==}

  loose-envify@1.4.0:
    resolution: {integrity: sha512-lyuxPGr/Wfhrlem2CL/tNVBQAZ8HW+WqwP25nGsjKeMZk13HGBF7YbJSi1KyeKwGAteWUa/ZKPUKAZNiIrUqZg==}
    hasBin: true

  js-tokens@4.0.0:
    resolution: {integrity: sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==}

  object-assign@4.1.1:
    resolution: {integrity: sha512-rJgTQnkUnkjVqfO3E+1Q45hXf64UF+6eWwJJCTNJN7q7vfVQqPJZsB/1/vb9TuT9e2vYfqvnMqGCDJ5x6+WUJA==}

snapshots:
  react@17.0.2:
    dependencies:
      loose-envify: 1.4.0
      object-assign: 4.1.1

  lodash@4.17.21: {}

  loose-envify@1.4.0:
    dependencies:
      js-tokens: 4.0.0

  js-tokens@4.0.0: {}

  object-assign@4.1.1: {}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }
    expect(exitCode).toBe(0);

    // Check migration message in stderr
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");

    expect(fs.existsSync(join(tmpDir, "bun.lock"))).toBe(true);

    const bunLockContent = fs.readFileSync(join(tmpDir, "bun.lock"), "utf8");
    expect(bunLockContent).toMatchSnapshot("npm-aliases-pnpm-migration");
  });

  test("handles different pnpm lockfile versions", async () => {
    // Test version 8
    await using v8Dir = tempDir("pnpm-v8", {
      "package.json": JSON.stringify({ name: "v8-test", dependencies: { "lodash": "^4.17.21" } }),
      "pnpm-lock.yaml": `lockfileVersion: '8.0'
importers:
  .:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21
packages:
  lodash@4.17.21:
    resolution: {integrity: sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==}
snapshots:
  lodash@4.17.21: {}`,
    });

    await using v8Proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: v8Dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const v8ExitCode = await v8Proc.exited;
    expect(v8ExitCode).toBe(0);
    expect(fs.existsSync(join(v8Dir, "bun.lock"))).toBe(true);
  });

  test("handles missing pnpm-lock.yaml gracefully", async () => {
    await using tmpDir = tempDir("pnpm-migrate-missing", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should return an error when no lockfile is found
    expect(exitCode).toBe(1);
    expect(stderr).toContain("could not find any other lockfile");
    expect(stderr).not.toContain("migrated lockfile from pnpm-lock.yaml");
  });
});

// Everything below resolves only workspace packages, so it never touches a registry.
describe.concurrent("pnpm-workspace.yaml is imported into package.json", () => {
  const rootPackageJson = { name: "root", private: true };
  const workspaceYaml = `packages:\n  - "packages/*"\n`;
  const workspacePackages = {
    "packages/a/package.json": JSON.stringify({ name: "@w/a", version: "1.2.3" }),
    "packages/b/package.json": JSON.stringify({
      name: "@w/b",
      version: "0.0.1",
      dependencies: { "@w/a": "workspace:*" },
    }),
  };
  const movedWorkspaces = "copied pnpm-workspace.yaml to workspaces in package.json";

  async function runBun(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  function readPackageJson(dir: string) {
    return JSON.parse(fs.readFileSync(join(dir, "package.json"), "utf8"));
  }

  // `@w/b` can only see `@w/a` if the install knew `packages/*` were workspaces.
  async function versionOfAResolvedFromB(dir: string) {
    const { stdout, stderr, exitCode } = await runBun(
      join(dir, "packages/b"),
      "-e",
      `console.log(require("@w/a/package.json").version)`,
    );
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "1.2.3\n", stderr: "", exitCode: 0 });
  }

  // Quoted yaml scalars are stored differently from plain ones by the parser; cover both.
  const catalogFixture = {
    "package.json": JSON.stringify({ ...rootPackageJson, pnpm: { overrides: { "from-package-json": "1.0.0" } } }),
    "pnpm-workspace.yaml": `packages:
  - 'packages/*'
catalog:
  "@w/a": "workspace:*"
  left-pad: ^1.3.0
catalogs:
  build:
    '@scope/quoted': '~2.0.0'
overrides:
  "@scope/quoted": "2.0.1"
  plain: 3.0.0
`,
    ...workspacePackages,
    "packages/b/package.json": JSON.stringify({
      name: "@w/b",
      version: "0.0.1",
      dependencies: { "@w/a": "catalog:" },
    }),
  };
  const catalogFixtureMoved =
    "copied pnpm.overrides to overrides, pnpm-workspace.yaml to workspaces, pnpm-workspace.yaml overrides to overrides in package.json";
  // The `pnpm` block stays: pnpm itself keeps reading it.
  const catalogFixtureImported = {
    ...rootPackageJson,
    workspaces: {
      packages: ["packages/*"],
      catalog: { "@w/a": "workspace:*", "left-pad": "^1.3.0" },
      catalogs: { build: { "@scope/quoted": "~2.0.0" } },
    },
    overrides: { "from-package-json": "1.0.0", "@scope/quoted": "2.0.1", plain: "3.0.0" },
    pnpm: { overrides: { "from-package-json": "1.0.0" } },
  };

  test("by bun install when there is no lockfile at all", async () => {
    await using dir = tempDir("pnpm-workspace-yaml-no-lockfile", {
      "package.json": JSON.stringify(rootPackageJson, null, 2) + "\n",
      "pnpm-workspace.yaml": workspaceYaml,
      ...workspacePackages,
    });

    const first = await runBun(dir, "install");
    expect(first.stderr).toContain(movedWorkspaces);
    expect(first.exitCode).toBe(0);

    expect(readPackageJson(dir)).toEqual({ ...rootPackageJson, workspaces: ["packages/*"] });
    const lockfile = fs.readFileSync(join(dir, "bun.lock"), "utf8");
    expect(lockfile).toContain(`"@w/a": ["@w/a@workspace:packages/a"]`);
    expect(lockfile).toContain(`"@w/b": ["@w/b@workspace:packages/b"]`);
    await versionOfAResolvedFromB(dir);

    // package.json now declares the workspaces and bun.lock exists: nothing left to import.
    const second = await runBun(dir, "install");
    expect(second.stderr).not.toContain("copied pnpm");
    expect(second.exitCode).toBe(0);
    expect(readPackageJson(dir)).toEqual({ ...rootPackageJson, workspaces: ["packages/*"] });
  });

  test("with its catalogs and overrides when there is no lockfile", async () => {
    await using dir = tempDir("pnpm-workspace-yaml-catalog", catalogFixture);

    const { stderr, exitCode } = await runBun(dir, "install");
    expect(stderr).toContain(catalogFixtureMoved);
    expect(exitCode).toBe(0);

    expect(readPackageJson(dir)).toEqual(catalogFixtureImported);
    expect(fs.readFileSync(join(dir, "bun.lock"), "utf8")).toContain(`"@w/b": ["@w/b@workspace:packages/b"]`);
    await versionOfAResolvedFromB(dir);
  });

  test("with its catalogs and overrides while migrating pnpm-lock.yaml", async () => {
    await using dir = tempDir("pnpm-workspace-yaml-catalog-lockfile", {
      ...catalogFixture,
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

catalogs:
  default:
    '@w/a':
      specifier: workspace:*
      version: link:packages/a

importers:

  .: {}

  packages/a: {}

  packages/b:
    dependencies:
      '@w/a':
        specifier: 'catalog:'
        version: link:../a
`,
    });

    const { stderr, exitCode } = await runBun(dir, "install");
    expect(stderr).toContain(catalogFixtureMoved);
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(exitCode).toBe(0);

    expect(readPackageJson(dir)).toEqual(catalogFixtureImported);
    await versionOfAResolvedFromB(dir);
  });

  test("when pnpm-lock.yaml is too old to migrate", async () => {
    await using dir = tempDir("pnpm-workspace-yaml-old-lockfile", {
      "package.json": JSON.stringify(rootPackageJson),
      "pnpm-workspace.yaml": workspaceYaml,
      "pnpm-lock.yaml": `lockfileVersion: '6.0'\n\nimporters:\n\n  .: {}\n`,
      ...workspacePackages,
    });

    const { stderr, exitCode } = await runBun(dir, "install");
    expect(stderr).toContain("pnpm-lock.yaml is lockfileVersion 6.0, which bun cannot migrate");
    expect(stderr).toContain(movedWorkspaces);
    expect(exitCode).toBe(0);

    expect(readPackageJson(dir)).toEqual({ ...rootPackageJson, workspaces: ["packages/*"] });
    await versionOfAResolvedFromB(dir);
  });

  test("by bun add, alongside the added dependency", async () => {
    await using dir = tempDir("pnpm-workspace-yaml-add", {
      "package.json": JSON.stringify(rootPackageJson),
      "pnpm-workspace.yaml": workspaceYaml,
      "lib/c/package.json": JSON.stringify({ name: "c", version: "0.0.1" }),
      ...workspacePackages,
    });

    const { stderr, exitCode } = await runBun(dir, "add", "file:lib/c");
    expect(stderr).toContain(movedWorkspaces);
    expect(exitCode).toBe(0);

    expect(readPackageJson(dir)).toEqual({
      ...rootPackageJson,
      dependencies: { c: "file:lib/c" },
      workspaces: ["packages/*"],
    });
    await versionOfAResolvedFromB(dir);
  });

  test("by bun remove, surviving its package.json write-back", async () => {
    await using dir = tempDir("pnpm-workspace-yaml-remove", {
      "package.json": JSON.stringify({ ...rootPackageJson, dependencies: { c: "file:lib/c" } }),
      "pnpm-workspace.yaml": workspaceYaml,
      "lib/c/package.json": JSON.stringify({ name: "c", version: "0.0.1" }),
      ...workspacePackages,
    });

    const { stderr, exitCode } = await runBun(dir, "remove", "c");
    expect(stderr).toContain(movedWorkspaces);
    expect(exitCode).toBe(0);

    expect(readPackageJson(dir)).toEqual({ ...rootPackageJson, workspaces: ["packages/*"] });
    await versionOfAResolvedFromB(dir);
  });

  test("not when package.json already declares workspaces", async () => {
    const declared = { ...rootPackageJson, workspaces: ["packages/a"] };
    await using dir = tempDir("pnpm-workspace-yaml-declared", {
      "package.json": JSON.stringify(declared),
      "pnpm-workspace.yaml": workspaceYaml,
      ...workspacePackages,
    });

    const { stderr, exitCode } = await runBun(dir, "install");
    expect(stderr).not.toContain("copied pnpm");
    expect(exitCode).toBe(0);

    expect(readPackageJson(dir)).toEqual(declared);
    const lockfile = fs.readFileSync(join(dir, "bun.lock"), "utf8");
    expect(lockfile).toContain(`"@w/a": ["@w/a@workspace:packages/a"]`);
    expect(lockfile).not.toContain("@w/b");
  });

  test("not when a bun.lock exists", async () => {
    const single = { ...rootPackageJson, dependencies: { c: "file:lib/c" } };
    await using dir = tempDir("pnpm-workspace-yaml-has-bun-lock", {
      "package.json": JSON.stringify(single),
      "lib/c/package.json": JSON.stringify({ name: "c", version: "0.0.1" }),
      ...workspacePackages,
    });
    expect((await runBun(dir, "install")).exitCode).toBe(0);
    expect(fs.existsSync(join(dir, "bun.lock"))).toBe(true);

    fs.writeFileSync(join(dir, "pnpm-workspace.yaml"), workspaceYaml);
    const { stderr, exitCode } = await runBun(dir, "install");
    expect(stderr).not.toContain("copied pnpm");
    expect(exitCode).toBe(0);

    expect(readPackageJson(dir)).toEqual(single);
    expect(fs.readFileSync(join(dir, "bun.lock"), "utf8")).not.toContain("@w/a");
  });

  // A 0444 package.json does not stop root from writing it, and the mode bits mean something else on Windows.
  test.skipIf(isWindows || process.getuid?.() === 0).each([
    ["without a lockfile", {}],
    [
      "while migrating pnpm-lock.yaml",
      {
        "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .: {}

  packages/a: {}

  packages/b:
    dependencies:
      '@w/a':
        specifier: workspace:*
        version: link:../a
`,
      },
    ],
  ])("and the install fails when package.json cannot be written back, %s", async (_, lockfile) => {
    const original = JSON.stringify(rootPackageJson);
    await using dir = tempDir("pnpm-workspace-yaml-readonly", {
      "package.json": original,
      "pnpm-workspace.yaml": workspaceYaml,
      ...workspacePackages,
      ...lockfile,
    });
    fs.chmodSync(join(dir, "package.json"), 0o444);

    const { stderr, exitCode } = await runBun(dir, "install");
    expect(stderr).toContain("failed to move pnpm-workspace.yaml to workspaces in package.json");
    expect(stderr).not.toContain("copied pnpm");
    expect(exitCode).toBe(1);

    expect(fs.readFileSync(join(dir, "package.json"), "utf8")).toBe(original);
    expect(fs.existsSync(join(dir, "bun.lock"))).toBe(false);
  });
});
