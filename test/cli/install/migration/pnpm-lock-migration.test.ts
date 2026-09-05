import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
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

  test("file: dependency of a workspace member is stored relative to the root", async () => {
    // pnpm writes `link:../utils` relative to the importer; bun.lock stores it
    // relative to the root, otherwise the install below looks for <root>/../utils.
    await using tmpDir = tempDir("pnpm-migrate-importer-link", {
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/app"] }),
      "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { utils: "file:../utils" } }),
      "packages/utils/package.json": JSON.stringify({ name: "utils", version: "1.0.0", main: "index.js" }),
      "packages/utils/index.js": `module.exports = "utils";`,
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:

  .: {}

  packages/app:
    dependencies:
      utils:
        specifier: file:../utils
        version: link:../utils
`,
    });

    await using migrate = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, migrateStderr, migrateExit] = await Promise.all([
      migrate.stdout.text(),
      migrate.stderr.text(),
      migrate.exited,
    ]);
    expect(migrateStderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(migrateExit).toBe(0);

    expect(fs.readFileSync(join(tmpDir, "bun.lock"), "utf8")).toContain('"utils@link:./packages/utils"');

    await using install = Bun.spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, installStderr, installExit] = await Promise.all([
      install.stdout.text(),
      install.stderr.text(),
      install.exited,
    ]);
    expect(installStderr).not.toContain("error:");
    expect(installExit).toBe(0);

    await using run = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log(require("utils"))`],
      cwd: join(tmpDir, "packages", "app"),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [runOut, runErr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(runErr).toBe("");
    expect(runOut.trim()).toBe("utils");
    expect(runExit).toBe(0);
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
