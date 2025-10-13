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

  test("deeply nested workspace dependencies with multiple conflicting versions", async () => {
    // This test uses a real yarn.lock generated by Yarn Berry 4.0.2
    // It has deeply nested workspace deps (pkg-e -> pkg-d -> pkg-c -> pkg-b -> pkg-a)
    // and multiple versions of the same package (react 16, 17, 18) (lodash 4.17.19, 4.17.20, 4.17.21)
    using dir = tempDir("yarn-berry-nested-conflicts", {
      "package.json": JSON.stringify({
        name: "complex-deps-monorepo",
        private: true,
        workspaces: ["packages/*"],
      }),
      "yarn.lock": `# This file is generated by running "yarn install" inside your project.
# Manual changes might be lost - proceed with caution!

__metadata:
  version: 8
  cacheKey: 10c0

"complex-deps-monorepo@workspace:.":
  version: 0.0.0-use.local
  resolution: "complex-deps-monorepo@workspace:."
  languageName: unknown
  linkType: soft

"js-tokens@npm:^3.0.0 || ^4.0.0":
  version: 4.0.0
  resolution: "js-tokens@npm:4.0.0"
  checksum: e248708d377aa058eacf2037b07ded847790e6de892bbad3dac0abba2e759cb9f121b00099a65195616badcb6eca8d14d975cb3e89eb1cfda644756402c8aeed
  languageName: node
  linkType: hard

"lodash@npm:^4.17.19, lodash@npm:^4.17.20, lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
  checksum: d8cbea072bb08655bb4c989da418994b073a608dffa608b09ac04b43a791b12aeae7cd7ad919aa4c925f33b48490b5cfe6c1f71d827956071dae2e7bb3a6b74c
  languageName: node
  linkType: hard

"loose-envify@npm:^1.1.0, loose-envify@npm:^1.4.0":
  version: 1.4.0
  resolution: "loose-envify@npm:1.4.0"
  dependencies:
    js-tokens: "npm:^3.0.0 || ^4.0.0"
  bin:
    loose-envify: cli.js
  checksum: 655d110220983c1a4b9c0c679a2e8016d4b67f6e9c7b5435ff5979ecdb20d0813f4dec0a08674fcbdd4846a3f07edbb50a36811fd37930b94aaa0d9daceb017e
  languageName: node
  linkType: hard

"object-assign@npm:^4.1.1":
  version: 4.1.1
  resolution: "object-assign@npm:4.1.1"
  checksum: 1f4df9945120325d041ccf7b86f31e8bcc14e73d29171e37a7903050e96b81323784ec59f93f102ec635bcf6fa8034ba3ea0a8c7e69fa202b87ae3b6cec5a414
  languageName: node
  linkType: hard

"pkg-a@workspace:^, pkg-a@workspace:packages/pkg-a":
  version: 0.0.0-use.local
  resolution: "pkg-a@workspace:packages/pkg-a"
  dependencies:
    lodash: "npm:^4.17.20"
    react: "npm:^18.0.0"
  languageName: unknown
  linkType: soft

"pkg-b@workspace:^, pkg-b@workspace:packages/pkg-b":
  version: 0.0.0-use.local
  resolution: "pkg-b@workspace:packages/pkg-b"
  dependencies:
    lodash: "npm:^4.17.21"
    pkg-a: "workspace:^"
    react: "npm:^17.0.0"
  languageName: unknown
  linkType: soft

"pkg-c@workspace:^, pkg-c@workspace:packages/pkg-c":
  version: 0.0.0-use.local
  resolution: "pkg-c@workspace:packages/pkg-c"
  dependencies:
    pkg-a: "workspace:^"
    pkg-b: "workspace:^"
    react: "npm:^18.2.0"
  languageName: unknown
  linkType: soft

"pkg-d@workspace:^, pkg-d@workspace:packages/pkg-d":
  version: 0.0.0-use.local
  resolution: "pkg-d@workspace:packages/pkg-d"
  dependencies:
    lodash: "npm:^4.17.19"
    pkg-c: "workspace:^"
    react: "npm:^16.14.0"
  languageName: unknown
  linkType: soft

"pkg-e@workspace:packages/pkg-e":
  version: 0.0.0-use.local
  resolution: "pkg-e@workspace:packages/pkg-e"
  dependencies:
    pkg-a: "workspace:^"
    pkg-d: "workspace:^"
    react: "npm:^18.0.0"
  languageName: unknown
  linkType: soft

"prop-types@npm:^15.6.2":
  version: 15.8.1
  resolution: "prop-types@npm:15.8.1"
  dependencies:
    loose-envify: "npm:^1.4.0"
    object-assign: "npm:^4.1.1"
    react-is: "npm:^16.13.1"
  checksum: 59ece7ca2fb9838031d73a48d4becb9a7cc1ed10e610517c7d8f19a1e02fa47f7c27d557d8a5702bec3cfeccddc853579832b43f449e54635803f277b1c78077
  languageName: node
  linkType: hard

"react-is@npm:^16.13.1":
  version: 16.13.1
  resolution: "react-is@npm:16.13.1"
  checksum: 33977da7a5f1a287936a0c85639fec6ca74f4f15ef1e59a6bc20338fc73dc69555381e211f7a3529b8150a1f71e4225525b41b60b52965bda53ce7d47377ada1
  languageName: node
  linkType: hard

"react@npm:^16.14.0":
  version: 16.14.0
  resolution: "react@npm:16.14.0"
  dependencies:
    loose-envify: "npm:^1.1.0"
    object-assign: "npm:^4.1.1"
    prop-types: "npm:^15.6.2"
  checksum: df8faae43e01387013900e8f8fb3c4ce9935b7edbcbaa77e12999c913eb958000a0a8750bf9a0886dae0ad768dd4a4ee983752d5bade8d840adbe0ce890a2438
  languageName: node
  linkType: hard

"react@npm:^17.0.0":
  version: 17.0.2
  resolution: "react@npm:17.0.2"
  dependencies:
    loose-envify: "npm:^1.1.0"
    object-assign: "npm:^4.1.1"
  checksum: 07ae8959acf1596f0550685102fd6097d461a54a4fd46a50f88a0cd7daaa97fdd6415de1dcb4bfe0da6aa43221a6746ce380410fa848acc60f8ac41f6649c148
  languageName: node
  linkType: hard

"react@npm:^18.0.0, react@npm:^18.2.0":
  version: 18.3.1
  resolution: "react@npm:18.3.1"
  dependencies:
    loose-envify: "npm:^1.1.0"
  checksum: 283e8c5efcf37802c9d1ce767f302dd569dd97a70d9bb8c7be79a789b9902451e0d16334b05d73299b20f048cbc3c7d288bbbde10b701fa194e2089c237dbea3
  languageName: node
  linkType: hard
`,
    });

    // Create workspace packages
    mkdirSync(join(String(dir), "packages", "pkg-a"), { recursive: true });
    writeFileSync(
      join(String(dir), "packages", "pkg-a", "package.json"),
      JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          react: "^18.0.0",
          lodash: "^4.17.20",
        },
      }),
    );

    mkdirSync(join(String(dir), "packages", "pkg-b"), { recursive: true });
    writeFileSync(
      join(String(dir), "packages", "pkg-b", "package.json"),
      JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        dependencies: {
          react: "^17.0.0",
          lodash: "^4.17.21",
          "pkg-a": "workspace:^",
        },
      }),
    );

    mkdirSync(join(String(dir), "packages", "pkg-c"), { recursive: true });
    writeFileSync(
      join(String(dir), "packages", "pkg-c", "package.json"),
      JSON.stringify({
        name: "pkg-c",
        version: "1.0.0",
        dependencies: {
          react: "^18.2.0",
          "pkg-a": "workspace:^",
          "pkg-b": "workspace:^",
        },
      }),
    );

    mkdirSync(join(String(dir), "packages", "pkg-d"), { recursive: true });
    writeFileSync(
      join(String(dir), "packages", "pkg-d", "package.json"),
      JSON.stringify({
        name: "pkg-d",
        version: "1.0.0",
        dependencies: {
          react: "^16.14.0",
          lodash: "^4.17.19",
          "pkg-c": "workspace:^",
        },
      }),
    );

    mkdirSync(join(String(dir), "packages", "pkg-e"), { recursive: true });
    writeFileSync(
      join(String(dir), "packages", "pkg-e", "package.json"),
      JSON.stringify({
        name: "pkg-e",
        version: "1.0.0",
        dependencies: {
          react: "^18.0.0",
          "pkg-a": "workspace:^",
          "pkg-d": "workspace:^",
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

    // Verify multiple versions are preserved
    expect(lockContents).toContain("react@16.14.0");
    expect(lockContents).toContain("react@17.0.2");
    expect(lockContents).toContain("react@18.3.1");

    // Test that bun install --frozen-lockfile works
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
  });
});
