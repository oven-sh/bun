import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir, normalizeBunSnapshot } from "harness";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";

describe("Yarn Berry migration", () => {
  test("simple package with conditions (v8 format)", async () => {
    using dir = tempDir("yarn-berry-conditions", {
      "package.json": JSON.stringify({
        name: "test-conditions",
        dependencies: {
          fsevents: "^2.3.2",
          "@esbuild/darwin-arm64": "^0.21.5",
        },
      }),
      "yarn.lock": `__metadata:
  version: 8
  cacheKey: 10c0

"fsevents@npm:^2.3.2":
  version: 2.3.2
  resolution: "fsevents@npm:2.3.2"
  conditions: os=darwin
  checksum: 10/6b5b6f5692372446ff81cf9501c76e3e0459a4852b3b5f1fc72c103198c125a6b8c72f5f166bdd76ffb2fca261e7f6ee5565daf80dca6e571e55bcc589cc1256
  languageName: node
  linkType: hard

"@esbuild/darwin-arm64@npm:^0.21.5":
  version: 0.21.5
  resolution: "@esbuild/darwin-arm64@npm:0.21.5"
  conditions: os=darwin & cpu=arm64
  languageName: node
  linkType: hard
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const lockContents = await Bun.file(join(String(dir), "bun.lock")).text();
    expect(lockContents).toContain("fsevents");
    expect(lockContents).toContain("@esbuild/darwin-arm64");
    expect(lockContents).toMatchSnapshot();
  });

  test("optional peer dependencies", async () => {
    using dir = tempDir("yarn-berry-peer-meta", {
      "package.json": JSON.stringify({
        name: "test-peer-meta",
        dependencies: {
          react: "^18.0.0",
        },
      }),
      "yarn.lock": `__metadata:
  version: 8
  cacheKey: 10c0

"react@npm:^18.0.0":
  version: 18.2.0
  resolution: "react@npm:18.2.0"
  dependencies:
    loose-envify: ^1.1.0
  checksum: 10/6b5b6f5692372446ff81cf9501c76e3e0459a4852b3b5f1fc72c103198c125a6b8c72f5f166bdd76ffb2fca261e7f6ee5565daf80dca6e571e55bcc589cc1256
  languageName: node
  linkType: hard

"loose-envify@npm:^1.1.0":
  version: 1.4.0
  resolution: "loose-envify@npm:1.4.0"
  peerDependencies:
    typescript: "*"
  peerDependenciesMeta:
    typescript:
      optional: true
  bin:
    loose-envify: cli.js
  checksum: 10/32f74fa2efb0a67def376a0a040b553c9109fb0891f6d4dd525048388b613a6ea1440aeff672b7b67da47b0b584f40c37826c34b5346f0a35bd64c08d559acb6
  languageName: node
  linkType: hard
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    const lockContents = await Bun.file(join(String(dir), "bun.lock")).text();
    expect(lockContents).toMatchSnapshot();
  });

  test("optional dependencies via dependenciesMeta", async () => {
    using dir = tempDir("yarn-berry-deps-meta", {
      "package.json": JSON.stringify({
        name: "test-deps-meta",
        dependencies: {
          sharp: "^0.32.0",
        },
      }),
      "yarn.lock": `__metadata:
  version: 8
  cacheKey: 10c0

"sharp@npm:^0.32.0":
  version: 0.32.6
  resolution: "sharp@npm:0.32.6"
  dependencies:
    "@img/sharp-darwin-arm64": 0.32.6
    "@img/sharp-linux-x64": 0.32.6
  dependenciesMeta:
    "@img/sharp-darwin-arm64":
      optional: true
    "@img/sharp-linux-x64":
      optional: true
  checksum: 10/cc2fe6c822819de5d453fa25aa9f32096bf70dde215d481faa1ad84a283dfb264e33988ed8f6d36bc803dd0b16dbe943efa311a798ef76d5b3892a05dfbfd628
  languageName: node
  linkType: hard

"@img/sharp-darwin-arm64@npm:0.32.6":
  version: 0.32.6
  resolution: "@img/sharp-darwin-arm64@npm:0.32.6"
  conditions: os=darwin & cpu=arm64
  languageName: node
  linkType: hard

"@img/sharp-linux-x64@npm:0.32.6":
  version: 0.32.6
  resolution: "@img/sharp-linux-x64@npm:0.32.6"
  conditions: os=linux & cpu=x64
  languageName: node
  linkType: hard
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    const lockContents = await Bun.file(join(String(dir), "bun.lock")).text();
    expect(lockContents).toMatchSnapshot();
  });

  test("bin definitions", async () => {
    using dir = tempDir("yarn-berry-bins", {
      "package.json": JSON.stringify({
        name: "test-bins",
        dependencies: {
          typescript: "^5.9.2",
        },
      }),
      "yarn.lock": `__metadata:
  version: 8
  cacheKey: 10c0

"typescript@npm:^5.9.2":
  version: 5.9.2
  resolution: "typescript@npm:5.9.2"
  bin:
    tsc: bin/tsc
    tsserver: bin/tsserver
  checksum: 10/cc2fe6c822819de5d453fa25aa9f32096bf70dde215d481faa1ad84a283dfb264e33988ed8f6d36bc803dd0b16dbe943efa311a798ef76d5b3892a05dfbfd628
  languageName: node
  linkType: hard
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    const lockContents = await Bun.file(join(String(dir), "bun.lock")).text();
    expect(lockContents).toMatchSnapshot();
  });

  test("workspace:* protocol", async () => {
    using dir = tempDir("yarn-berry-workspaces", {
      "package.json": JSON.stringify({
        name: "test-workspaces",
        workspaces: ["packages/*"],
        dependencies: {
          "lib-a": "workspace:*",
        },
      }),
      "yarn.lock": `__metadata:
  version: 8
  cacheKey: 10c0

"lib-a@workspace:packages/lib-a":
  version: 0.0.0-use.local
  resolution: "lib-a@workspace:packages/lib-a"
  languageName: unknown
  linkType: soft

"test-workspaces@workspace:.":
  version: 0.0.0-use.local
  resolution: "test-workspaces@workspace:."
  dependencies:
    lib-a: "workspace:*"
  languageName: unknown
  linkType: soft
`,
    });

    mkdirSync(join(String(dir), "packages", "lib-a"), { recursive: true });
    writeFileSync(
      join(String(dir), "packages", "lib-a", "package.json"),
      JSON.stringify({
        name: "lib-a",
        version: "1.0.0",
      }),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    const lockContents = await Bun.file(join(String(dir), "bun.lock")).text();
    expect(lockContents).toMatchSnapshot();
  });

  test("v6 format fallback with os/cpu arrays", async () => {
    using dir = tempDir("yarn-berry-v6", {
      "package.json": JSON.stringify({
        name: "test-v6",
        dependencies: {
          fsevents: "^2.3.2",
        },
      }),
      "yarn.lock": `__metadata:
  version: 6
  cacheKey: 8

"fsevents@npm:^2.3.2":
  version: 2.3.2
  resolution: "fsevents@npm:2.3.2"
  os:
    - darwin
  checksum: 8/6b5b6f5692372446ff81cf9501c76e3e0459a4852b3b5f1fc72c103198c125a6
  languageName: node
  linkType: hard
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    const lockContents = await Bun.file(join(String(dir), "bun.lock")).text();
    expect(lockContents).toMatchSnapshot();
  });

  test("real-world monorepo with Next.js, workspace:^ deps, optional peers, and platform-specific bins", async () => {
    using dir = tempDir("yarn-berry-nextjs-monorepo", {
      "package.json": JSON.stringify({
        name: "nextjs-monorepo",
        private: true,
        workspaces: ["packages/*", "apps/*"],
        devDependencies: {
          typescript: "^5.0.0",
        },
      }),
      "yarn.lock": `__metadata:
  version: 8
  cacheKey: 10c0

"@next/env@npm:14.1.0":
  version: 14.1.0
  resolution: "@next/env@npm:14.1.0"
  checksum: 10/abc123
  languageName: node
  linkType: hard

"@next/swc-darwin-arm64@npm:14.1.0":
  version: 14.1.0
  resolution: "@next/swc-darwin-arm64@npm:14.1.0"
  conditions: os=darwin & cpu=arm64
  languageName: node
  linkType: hard

"@next/swc-linux-x64-gnu@npm:14.1.0":
  version: 14.1.0
  resolution: "@next/swc-linux-x64-gnu@npm:14.1.0"
  conditions: os=linux & cpu=x64 & libc=glibc
  languageName: node
  linkType: hard

"@ui/shared@workspace:^, @ui/shared@workspace:packages/shared":
  version: 0.0.0-use.local
  resolution: "@ui/shared@workspace:packages/shared"
  dependencies:
    react: "npm:^18.2.0"
  languageName: unknown
  linkType: soft

"js-tokens@npm:^4.0.0":
  version: 4.0.0
  resolution: "js-tokens@npm:4.0.0"
  checksum: 10/abc456
  languageName: node
  linkType: hard

"loose-envify@npm:^1.1.0":
  version: 1.4.0
  resolution: "loose-envify@npm:1.4.0"
  dependencies:
    js-tokens: "npm:^4.0.0"
  bin:
    loose-envify: cli.js
  checksum: 10/def789
  languageName: node
  linkType: hard

"next@npm:14.1.0":
  version: 14.1.0
  resolution: "next@npm:14.1.0"
  dependencies:
    "@next/env": "npm:14.1.0"
    "@next/swc-darwin-arm64": "npm:14.1.0"
    "@next/swc-linux-x64-gnu": "npm:14.1.0"
    busboy: "npm:1.6.0"
    styled-jsx: "npm:5.1.1"
  peerDependencies:
    "@opentelemetry/api": ^1.1.0
    react: ^18.2.0
    react-dom: ^18.2.0
    sass: ^1.3.0
  peerDependenciesMeta:
    "@opentelemetry/api":
      optional: true
    sass:
      optional: true
  bin:
    next: dist/bin/next
  checksum: 10/ghi012
  languageName: node
  linkType: hard

"nextjs-app@workspace:apps/web":
  version: 0.0.0-use.local
  resolution: "nextjs-app@workspace:apps/web"
  dependencies:
    "@ui/shared": "workspace:^"
    next: "npm:14.1.0"
    react: "npm:^18.2.0"
    react-dom: "npm:^18.2.0"
  languageName: unknown
  linkType: soft

"nextjs-monorepo@workspace:.":
  version: 0.0.0-use.local
  resolution: "nextjs-monorepo@workspace:."
  dependencies:
    typescript: "npm:^5.0.0"
  languageName: unknown
  linkType: soft

"busboy@npm:1.6.0":
  version: 1.6.0
  resolution: "busboy@npm:1.6.0"
  dependencies:
    streamsearch: "npm:^1.1.0"
  checksum: 10/jkl345
  languageName: node
  linkType: hard

"react@npm:^18.2.0":
  version: 18.2.0
  resolution: "react@npm:18.2.0"
  dependencies:
    loose-envify: "npm:^1.1.0"
  checksum: 10/mno678
  languageName: node
  linkType: hard

"react-dom@npm:^18.2.0":
  version: 18.2.0
  resolution: "react-dom@npm:18.2.0"
  dependencies:
    loose-envify: "npm:^1.1.0"
    react: "npm:^18.2.0"
    scheduler: "npm:^0.23.0"
  peerDependencies:
    react: ^18.2.0
  checksum: 10/pqr901
  languageName: node
  linkType: hard

"scheduler@npm:^0.23.0":
  version: 0.23.0
  resolution: "scheduler@npm:0.23.0"
  dependencies:
    loose-envify: "npm:^1.1.0"
  checksum: 10/stu234
  languageName: node
  linkType: hard

"streamsearch@npm:^1.1.0":
  version: 1.1.0
  resolution: "streamsearch@npm:1.1.0"
  checksum: 10/vwx567
  languageName: node
  linkType: hard

"styled-jsx@npm:5.1.1":
  version: 5.1.1
  resolution: "styled-jsx@npm:5.1.1"
  dependencies:
    client-only: "npm:0.0.1"
  peerDependencies:
    react: "*"
  checksum: 10/yza890
  languageName: node
  linkType: hard

"client-only@npm:0.0.1":
  version: 0.0.1
  resolution: "client-only@npm:0.0.1"
  checksum: 10/bcd123
  languageName: node
  linkType: hard

"typescript@npm:^5.0.0":
  version: 5.3.3
  resolution: "typescript@npm:5.3.3"
  bin:
    tsc: bin/tsc
    tsserver: bin/tsserver
  checksum: 10/efg456
  languageName: node
  linkType: hard
`,
    });

    // Create workspace packages
    mkdirSync(join(String(dir), "packages", "shared"), { recursive: true });
    writeFileSync(
      join(String(dir), "packages", "shared", "package.json"),
      JSON.stringify({
        name: "@ui/shared",
        version: "1.0.0",
        dependencies: {
          react: "^18.2.0",
        },
      }),
    );

    mkdirSync(join(String(dir), "apps", "web"), { recursive: true });
    writeFileSync(
      join(String(dir), "apps", "web", "package.json"),
      JSON.stringify({
        name: "nextjs-app",
        version: "1.0.0",
        dependencies: {
          "@ui/shared": "workspace:^",
          next: "14.1.0",
          react: "^18.2.0",
          "react-dom": "^18.2.0",
        },
      }),
    );

    // Test migration
    await using procMigrate = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdoutMigrate, stderrMigrate, exitCodeMigrate] = await Promise.all([
      procMigrate.stdout.text(),
      procMigrate.stderr.text(),
      procMigrate.exited,
    ]);

    expect(exitCodeMigrate).toBe(0);
    const lockContents = await Bun.file(join(String(dir), "bun.lock")).text();
    expect(lockContents).toMatchSnapshot();

    // Test that bun install --frozen-lockfile works (bun ci)
    await using procInstall = Bun.spawn({
      cmd: [bunExe(), "install", "--frozen-lockfile"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdoutInstall, stderrInstall, exitCodeInstall] = await Promise.all([
      procInstall.stdout.text(),
      procInstall.stderr.text(),
      procInstall.exited,
    ]);

    expect(exitCodeInstall).toBe(0);
    expect(stderrInstall).not.toContain("lockfile had changes");
    expect(stderrInstall).not.toContain("failed to resolve");
    expect(stderrInstall).not.toContain("failed to parse");
  });
});
