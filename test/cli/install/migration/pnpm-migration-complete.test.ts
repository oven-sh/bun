import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("PNPM Migration Complete Test Suite", () => {
  test("comprehensive PNPM migration with all edge cases", async () => {
    // ===== SECTION 1: Basic Dependencies =====
    const basicTest = tempDirWithFiles("pnpm-basic", {
      "package.json": JSON.stringify({
        name: "basic-test",
        version: "1.0.0",
        dependencies: {
          "lodash": "^4.17.21",
          "react": "^18.2.0",
        },
        devDependencies: {
          "typescript": "^5.3.3",
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21
      react:
        specifier: ^18.2.0
        version: 18.2.0
    devDependencies:
      typescript:
        specifier: ^5.3.3
        version: 5.3.3

packages:
  lodash@4.17.21:
    resolution: {integrity: sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==}

  react@18.2.0:
    resolution: {integrity: sha512-/3IjMdb2L9QbBdWiW5e3P2/npwMBaU9mHCSCUzNln0ZCYbcfTsGbTJrU/kGemdH2IWmB2ioZ+zkxtmq6g09fGQ==}
    dependencies:
      loose-envify: 1.4.0

  typescript@5.3.3:
    resolution: {integrity: sha512-pXWcraxM0uxAS+tN0AG/BF2TyqmHO014Z070UsJ+pFvYuRSq8KH8DmWpnbXe0pEPDHXZV3FcAbJkijJ5oNEnWw==}
    engines: {node: '>=14.17'}
    hasBin: true

  loose-envify@1.4.0:
    resolution: {integrity: sha512-lyuxPGr/Wfhrlem2CL/UcnUc1zcqKAImBDzukY7Y5F/yQiNdko6+fRLevlw1HgMySw7f611UIY408EtxRSoK3Q==}
    hasBin: true
    dependencies:
      js-tokens: 4.0.0

  js-tokens@4.0.0:
    resolution: {integrity: sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==}

snapshots:
  lodash@4.17.21: {}

  react@18.2.0:
    dependencies:
      loose-envify: 1.4.0

  typescript@5.3.3: {}

  loose-envify@1.4.0:
    dependencies:
      js-tokens: 4.0.0

  js-tokens@4.0.0: {}`,
    });

    const basicProc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: basicTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [basicStderr, basicExitCode] = await Promise.all([basicProc.stderr.text(), basicProc.exited]);

    expect(basicExitCode).toBe(0);
    expect(basicStderr).toContain("migrated lockfile from pnpm-lock.yaml");

    const basicLockfile = fs.readFileSync(join(basicTest, "bun.lock"), "utf8");
    expect(basicLockfile).toContain('"lodash": "^4.17.21"');
    expect(basicLockfile).toContain('"react": "^18.2.0"');
    expect(basicLockfile).toContain('"typescript": "^5.3.3"');
    expect(basicLockfile).toMatchSnapshot("basic-dependencies");

    // ===== SECTION 2: Canary Versions =====
    const canaryTest = tempDirWithFiles("pnpm-canary", {
      "package.json": JSON.stringify({
        name: "canary-test",
        dependencies: {
          "react": "19.2.0-canary-a96a0f39-20250815",
          "react-dom": "19.2.0-canary-a96a0f39-20250815",
          "scheduler": "0.27.0-canary-a96a0f39-20250815",
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      react:
        specifier: 19.2.0-canary-a96a0f39-20250815
        version: 19.2.0-canary-a96a0f39-20250815
      react-dom:
        specifier: 19.2.0-canary-a96a0f39-20250815
        version: 19.2.0-canary-a96a0f39-20250815
      scheduler:
        specifier: 0.27.0-canary-a96a0f39-20250815
        version: 0.27.0-canary-a96a0f39-20250815

packages:
  react@19.2.0-canary-a96a0f39-20250815:
    resolution: {integrity: sha512-reactcanary==}

  react-dom@19.2.0-canary-a96a0f39-20250815:
    resolution: {integrity: sha512-reactdomcanary==}
    dependencies:
      scheduler: 0.27.0-canary-a96a0f39-20250815

  scheduler@0.27.0-canary-a96a0f39-20250815:
    resolution: {integrity: sha512-schedulercanary==}

snapshots:
  react@19.2.0-canary-a96a0f39-20250815: {}

  react-dom@19.2.0-canary-a96a0f39-20250815:
    dependencies:
      scheduler: 0.27.0-canary-a96a0f39-20250815

  scheduler@0.27.0-canary-a96a0f39-20250815: {}`,
    });

    const canaryProc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: canaryTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [canaryStderr, canaryExitCode] = await Promise.all([canaryProc.stderr.text(), canaryProc.exited]);

    expect(canaryExitCode).toBe(0);
    const canaryLockfile = fs.readFileSync(join(canaryTest, "bun.lock"), "utf8");

    // Verify canary versions are preserved exactly
    expect(canaryLockfile).toContain('"react@19.2.0-canary-a96a0f39-20250815"');
    expect(canaryLockfile).toContain('"scheduler@0.27.0-canary-a96a0f39-20250815"');
    expect(canaryLockfile).not.toContain("canary-a96a0f39-20250815-"); // No corruption
    expect(canaryLockfile).toMatchSnapshot("canary-versions");

    // ===== SECTION 3: Complex Monorepo with Workspaces =====
    const monorepoTest = tempDirWithFiles("pnpm-monorepo", {
      "package.json": JSON.stringify({
        name: "monorepo-root",
        private: true,
        workspaces: ["packages/*", "apps/*"],
        dependencies: {
          "@workspace/shared": "workspace:*",
          "@workspace/utils": "workspace:^",
        },
      }),
      "packages/shared/package.json": JSON.stringify({ name: "shared" }),
      "packages/utils/package.json": JSON.stringify({ name: "utils" }),
      "apps/web/package.json": JSON.stringify({ name: "web" }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      '@workspace/shared':
        specifier: workspace:*
        version: link:packages/shared
      '@workspace/utils':
        specifier: workspace:^
        version: link:packages/utils

  packages/shared:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21
      '@workspace/utils':
        specifier: workspace:*
        version: link:../utils

  packages/utils:
    dependencies:
      axios:
        specifier: ^1.6.0
        version: 1.6.7

  apps/web:
    dependencies:
      '@workspace/shared':
        specifier: workspace:*
        version: link:../../packages/shared
      react:
        specifier: ^18.2.0
        version: 18.2.0

packages:
  lodash@4.17.21:
    resolution: {integrity: sha512-lodash==}

  axios@1.6.7:
    resolution: {integrity: sha512-axios==}

  react@18.2.0:
    resolution: {integrity: sha512-react==}

snapshots:
  lodash@4.17.21: {}
  axios@1.6.7: {}
  react@18.2.0: {}`,
    });

    const monorepoProc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: monorepoTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [monorepoStderr, monorepoExitCode] = await Promise.all([monorepoProc.stderr.text(), monorepoProc.exited]);

    expect(monorepoExitCode).toBe(0);
    const monorepoLockfile = fs.readFileSync(join(monorepoTest, "bun.lock"), "utf8");

    // Verify workspaces are created
    expect(monorepoLockfile).toContain('"packages/shared"');
    expect(monorepoLockfile).toContain('"packages/utils"');
    expect(monorepoLockfile).toContain('"apps/web"');
    expect(monorepoLockfile).toContain('"@workspace/shared": "workspace:*"');
    expect(monorepoLockfile).toMatchSnapshot("monorepo-workspaces");

    // ===== SECTION 4: Patches and Overrides =====
    const patchesTest = tempDirWithFiles("pnpm-patches", {
      "patches/lodash@4.17.21.patch": `diff --git a/lib/application.js b/lib/application.js
index 1234567..abcdefg 100644
--- a/lib/application.js
+++ b/lib/application.js
@@ -123,7 +123,7 @@ app.defaultConfiguration = function defaultConfiguration() {
   this.set('subdomain offset', 2);
   this.set('trust proxy', false);
 
-  // trust proxy inherit back-compat
+  // trust proxy inherit back-compat - PATCHED
   Object.defineProperty(this.settings, trustProxyDefaultSymbol, {
     configurable: true,
     value: true`,
      "package.json": JSON.stringify({
        name: "patches-test",
        dependencies: {
          "lodash": "^4.17.21",
        },
        pnpm: {
          patchedDependencies: {
            "lodash@4.17.21": "patches/lodash@4.17.21.patch",
          },
          overrides: {
            "axios": "1.6.0",
          },
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

patchedDependencies:
  lodash@4.17.21:
    path: patches/lodash@4.17.21.patch
    hash: abc123

overrides:
  axios: 1.6.0

importers:
  .:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21(patch_hash=abc123)

packages:
  lodash@4.17.21:
    resolution: {integrity: sha512-lodash==}
    patched: true

snapshots:
  lodash@4.17.21(patch_hash=abc123): {}`,
    });

    const patchesProc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: patchesTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [patchesStderr, patchesExitCode] = await Promise.all([patchesProc.stderr.text(), patchesProc.exited]);

    expect(patchesExitCode).toBe(0);
    const patchesLockfile = fs.readFileSync(join(patchesTest, "bun.lock"), "utf8");

    expect(patchesLockfile).toContain('"patchedDependencies"');
    expect(patchesLockfile).toContain('"lodash@4.17.21": "patches/lodash@4.17.21.patch"');
    expect(patchesLockfile).toContain('"overrides"');
    expect(patchesLockfile).toContain('"axios": "1.6.0"');
    expect(patchesLockfile).toMatchSnapshot("patches-overrides");

    // ===== SECTION 5: File and Link Dependencies =====
    const fileLinksTest = tempDirWithFiles("pnpm-file-links", {
      "shared/config/package.json": JSON.stringify({ name: "hi" }),
      "local-pkg/package.json": JSON.stringify({ name: "hi2" }),
      "package.json": JSON.stringify({
        name: "file-links-test",
        dependencies: {
          "local-pkg": "file:./local-pkg",
          "config": "file:./shared/config",
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      config:
        specifier: file:./shared/config
        version: hi2@file:shared/config
      local-pkg:
        specifier: file:./local-pkg
        version: hi@file:local-pkg

packages:

  hi2@file:shared/config:
    resolution: {directory: shared/config, type: directory}

  hi@file:local-pkg:
    resolution: {directory: local-pkg, type: directory}

snapshots:

  hi2@file:shared/config: {}

  hi@file:local-pkg: {}
`,
    });

    const fileLinksProc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: fileLinksTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [fileLinksStderr, fileLinksExitCode] = await Promise.all([fileLinksProc.stderr.text(), fileLinksProc.exited]);

    expect(fileLinksExitCode).toBe(0);
    const fileLinksLockfile = fs.readFileSync(join(fileLinksTest, "bun.lock"), "utf8");

    expect(fileLinksLockfile).toContain('"local-pkg": "file:./local-pkg"');
    expect(fileLinksLockfile).toContain('"config": "file:./shared/config"');
    expect(fileLinksLockfile).toMatchSnapshot("file-link-deps");

    // ===== SECTION 6: Custom Registries =====
    const registriesTest = tempDirWithFiles("pnpm-registries", {
      "package.json": JSON.stringify({
        name: "registries-test",
        dependencies: {
          "@company/private-pkg": "^1.0.0",
          "lodash": "^4.17.21",
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      '@company/private-pkg':
        specifier: ^1.0.0
        version: 1.0.5(registry=https://npm.company.com/)
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  '@company/private-pkg@1.0.5':
    resolution: {integrity: sha512-private==, registry: https://npm.company.com/, tarball: https://npm.company.com/@company/private-pkg/-/private-pkg-1.0.5.tgz}

  lodash@4.17.21:
    resolution: {integrity: sha512-lodash==}

snapshots:
  '@company/private-pkg@1.0.5(registry=https://npm.company.com/)': {}
  lodash@4.17.21: {}`,
    });

    const registriesProc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: registriesTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [registriesStderr, registriesExitCode] = await Promise.all([
      registriesProc.stderr.text(),
      registriesProc.exited,
    ]);

    expect(registriesExitCode).toBe(0);
    const registriesLockfile = fs.readFileSync(join(registriesTest, "bun.lock"), "utf8");

    expect(registriesLockfile).toContain('"@company/private-pkg": "^1.0.0"');
    // Registry URLs are stored in the package entries
    expect(registriesLockfile).toContain('"@company/private-pkg"');
    expect(registriesLockfile).toMatchSnapshot("custom-registries");

    // ===== SECTION 7: Peer Dependencies =====
    const peerDepsTest = tempDirWithFiles("pnpm-peer-deps", {
      "package.json": JSON.stringify({
        name: "peer-deps-test",
        dependencies: {
          "react": "^18.2.0",
          "react-dom": "^18.2.0",
          "@mui/material": "^5.15.0",
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:
  .:
    dependencies:
      react:
        specifier: ^18.2.0
        version: 18.2.0
      react-dom:
        specifier: ^18.2.0
        version: 18.2.0(react@18.2.0)
      '@mui/material':
        specifier: ^5.15.0
        version: 5.15.0(@emotion/react@11.11.3)(@emotion/styled@11.11.0)(react-dom@18.2.0)(react@18.2.0)

packages:
  react@18.2.0:
    resolution: {integrity: sha512-react==}

  react-dom@18.2.0:
    resolution: {integrity: sha512-reactdom==}
    peerDependencies:
      react: ^18.2.0

  '@mui/material@5.15.0':
    resolution: {integrity: sha512-mui==}
    peerDependencies:
      '@emotion/react': ^11.5.0
      '@emotion/styled': ^11.3.0
      react: ^17.0.0 || ^18.0.0
      react-dom: ^17.0.0 || ^18.0.0
    peerDependenciesMeta:
      '@emotion/react':
        optional: true
      '@emotion/styled':
        optional: true

  '@emotion/react@11.11.3':
    resolution: {integrity: sha512-emotion-react==}
    peerDependencies:
      react: '>=16.8.0'

  '@emotion/styled@11.11.0':
    resolution: {integrity: sha512-emotion-styled==}
    peerDependencies:
      '@emotion/react': ^11.0.0
      react: '>=16.8.0'

snapshots:
  react@18.2.0: {}

  react-dom@18.2.0(react@18.2.0):
    dependencies:
      react: 18.2.0

  '@mui/material@5.15.0(@emotion/react@11.11.3)(@emotion/styled@11.11.0)(react-dom@18.2.0)(react@18.2.0)':
    dependencies:
      react: 18.2.0
      react-dom: 18.2.0(react@18.2.0)
    optionalDependencies:
      '@emotion/react': 11.11.3(react@18.2.0)
      '@emotion/styled': 11.11.0(@emotion/react@11.11.3)(react@18.2.0)

  '@emotion/react@11.11.3(react@18.2.0)':
    dependencies:
      react: 18.2.0

  '@emotion/styled@11.11.0(@emotion/react@11.11.3)(react@18.2.0)':
    dependencies:
      '@emotion/react': 11.11.3(react@18.2.0)
      react: 18.2.0`,
    });

    const peerDepsProc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: peerDepsTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [peerDepsStderr, peerDepsExitCode] = await Promise.all([peerDepsProc.stderr.text(), peerDepsProc.exited]);

    expect(peerDepsExitCode).toBe(0);
    const peerDepsLockfile = fs.readFileSync(join(peerDepsTest, "bun.lock"), "utf8");

    expect(peerDepsLockfile).toContain('"@mui/material": "^5.15.0"');
    expect(peerDepsLockfile).toContain('"react": "^18.2.0"');
    expect(peerDepsLockfile).toContain('"react-dom": "^18.2.0"');
    expect(peerDepsLockfile).toMatchSnapshot("peer-dependencies");

    // ===== SECTION 9: Duplicate Packages =====
    const duplicatesTest = tempDirWithFiles("pnpm-duplicates", {
      "package.json": JSON.stringify({
        name: "duplicates-test",
        dependencies: {
          "package-a": "^1.0.0",
          "package-b": "^1.0.0",
          "my-lodash": "npm:lodash@^4.17.20",
          "lodash": "^4.17.21",
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      package-a:
        specifier: ^1.0.0
        version: 1.0.0
      package-b:
        specifier: ^1.0.0
        version: 1.0.0
      my-lodash:
        specifier: npm:lodash@^4.17.20
        version: lodash@4.17.20
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  package-a@1.0.0:
    resolution: {integrity: sha512-packageA==}
    dependencies:
      shared-dep: 2.0.0

  package-b@1.0.0:
    resolution: {integrity: sha512-packageB==}
    dependencies:
      shared-dep: 3.0.0

  shared-dep@2.0.0:
    resolution: {integrity: sha512-shared2==}

  shared-dep@3.0.0:
    resolution: {integrity: sha512-shared3==}

  lodash@4.17.20:
    resolution: {integrity: sha512-lodash20==}

  lodash@4.17.21:
    resolution: {integrity: sha512-lodash21==}

snapshots:
  package-a@1.0.0:
    dependencies:
      shared-dep: 2.0.0

  package-b@1.0.0:
    dependencies:
      shared-dep: 3.0.0

  shared-dep@2.0.0: {}
  shared-dep@3.0.0: {}
  lodash@4.17.20: {}
  lodash@4.17.21: {}`,
    });

    const duplicatesProc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: duplicatesTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [duplicatesStderr, duplicatesExitCode] = await Promise.all([
      duplicatesProc.stderr.text(),
      duplicatesProc.exited,
    ]);

    expect(duplicatesExitCode).toBe(0);
    const duplicatesLockfile = fs.readFileSync(join(duplicatesTest, "bun.lock"), "utf8");

    // Both versions of shared-dep should exist
    expect(duplicatesLockfile).toContain('"shared-dep@2.0.0"');
    expect(duplicatesLockfile).toContain('"shared-dep@3.0.0"');
    // Aliased package
    expect(duplicatesLockfile).toContain('"my-lodash": "npm:lodash@^4.17.20"');
    expect(duplicatesLockfile).toContain('"lodash": "^4.17.21"');
    expect(duplicatesLockfile).toMatchSnapshot("duplicate-packages");

    // ===== SECTION 10: Catalogs =====
    const catalogsTest = tempDirWithFiles("pnpm-catalogs", {
      "pnpm-workspace.yaml": `packages: []

catalog:
  react: 18.2.0
  react-dom: 18.2.0

catalogs:
  tools:
    lodash: 4.17.21
    eslint: 8.56.0`,

      "package.json": JSON.stringify({
        name: "catalogs-test",
        dependencies: {
          "react": "catalog:",
          "lodash": "catalog:tools",
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

catalogs:
  default:
    react:
      specifier: 18.2.0
      version: 18.2.0
  tools:
    lodash:
      specifier: 4.17.21
      version: 4.17.21

importers:

  .:
    dependencies:
      lodash:
        specifier: catalog:tools
        version: 4.17.21
      react:
        specifier: 'catalog:'
        version: 18.2.0

packages:

  js-tokens@4.0.0:
    resolution: {integrity: sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==}

  lodash@4.17.21:
    resolution: {integrity: sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==}

  loose-envify@1.4.0:
    resolution: {integrity: sha512-lyuxPGr/Wfhrlem2CL/UcnUc1zcqKAImBDzukY7Y5F/yQiNdko6+fRLevlw1HgMySw7f611UIY408EtxRSoK3Q==}
    hasBin: true

  react@18.2.0:
    resolution: {integrity: sha512-/3IjMdb2L9QbBdWiW5e3P2/npwMBaU9mHCSCUzNln0ZCYbcfTsGbTJrU/kGemdH2IWmB2ioZ+zkxtmq6g09fGQ==}
    engines: {node: '>=0.10.0'}

snapshots:

  js-tokens@4.0.0: {}

  lodash@4.17.21: {}

  loose-envify@1.4.0:
    dependencies:
      js-tokens: 4.0.0

  react@18.2.0:
    dependencies:
      loose-envify: 1.4.0
`,
    });

    const catalogsProc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: catalogsTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [catalogsStderr, catalogsExitCode] = await Promise.all([catalogsProc.stderr.text(), catalogsProc.exited]);

    expect(catalogsExitCode).toBe(0);
    const catalogsLockfile = fs.readFileSync(join(catalogsTest, "bun.lock"), "utf8");

    // Catalogs are resolved to actual versions during migration
    expect(catalogsLockfile).toContain('"react": "18.2.0"');
    expect(catalogsLockfile).toContain('"lodash": "4.17.21"');
    // The actual packages should be in the lockfile
    expect(catalogsLockfile).toContain('"react@18.2.0"');
    expect(catalogsLockfile).toContain('"lodash@4.17.21"');
    expect(catalogsLockfile).toMatchSnapshot("catalogs");

    // ===== SECTION 12: Integrity Hashes =====
    const integrityTest = tempDirWithFiles("pnpm-integrity", {
      "package.json": JSON.stringify({
        name: "integrity-test",
        dependencies: {
          "express": "^4.18.2",
          "axios": "^1.6.0",
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      express:
        specifier: ^4.18.2
        version: 4.18.2
      axios:
        specifier: ^1.6.0
        version: 1.6.7

packages:
  express@4.18.2:
    resolution: {integrity: sha512-5/PsL6iGPdfQ/lKM1UuielYgv3BUoJfz1aUwU9vHZ+J7gyvwdQXFEBIEIaxeGf0GIcreATNyBExtalisDbuMqQ==}
    engines: {node: '>= 0.10.0'}

  axios@1.6.7:
    resolution: {integrity: sha512-/hDJGff6/c7u0hDkvkGxR/oy6CbCs8ziCsC7SqmhjfozqiJGc8Z11wrv9z9lYfY4K8l+H9TpjcMDX0xOZmx+RA==}

snapshots:
  express@4.18.2: {}
  axios@1.6.7: {}`,
    });

    const integrityProc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: integrityTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [integrityStderr, integrityExitCode] = await Promise.all([integrityProc.stderr.text(), integrityProc.exited]);

    expect(integrityExitCode).toBe(0);
    const integrityLockfile = fs.readFileSync(join(integrityTest, "bun.lock"), "utf8");

    // Check integrity hashes are preserved
    expect(integrityLockfile).toContain(
      "sha512-5/PsL6iGPdfQ/lKM1UuielYgv3BUoJfz1aUwU9vHZ+J7gyvwdQXFEBIEIaxeGf0GIcreATNyBExtalisDbuMqQ==",
    );
    expect(integrityLockfile).toContain(
      "sha512-/hDJGff6/c7u0hDkvkGxR/oy6CbCs8ziCsC7SqmhjfozqiJGc8Z11wrv9z9lYfY4K8l+H9TpjcMDX0xOZmx+RA==",
    );
    expect(integrityLockfile).toMatchSnapshot("integrity-hashes");

    // ===== SECTION 13: Version Zero Bug Test =====
    const versionZeroTest = tempDirWithFiles("pnpm-version-zero", {
      "package.json": JSON.stringify({
        name: "version-zero-test",
        dependencies: {
          "package-with-zero": "0.0.0",
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      package-with-zero:
        specifier: 0.0.0
        version: 0.0.0

packages:
  package-with-zero@0.0.0:
    resolution: {integrity: sha512-zero==}

snapshots:
  package-with-zero@0.0.0: {}`,
    });

    const versionZeroProc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: versionZeroTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [versionZeroStderr, versionZeroExitCode] = await Promise.all([
      versionZeroProc.stderr.text(),
      versionZeroProc.exited,
    ]);

    expect(versionZeroExitCode).toBe(0);
    const versionZeroLockfile = fs.readFileSync(join(versionZeroTest, "bun.lock"), "utf8");

    expect(versionZeroLockfile).toContain('"package-with-zero": "0.0.0"');
    expect(versionZeroLockfile).toContain('"package-with-zero@0.0.0"');
    expect(versionZeroLockfile).toMatchSnapshot("version-zero");

    // ===== SECTION 14: Mixed Dependency Types =====
    const mixedDepsTest = tempDirWithFiles("pnpm-mixed-deps", {
      "package.json": JSON.stringify({
        name: "mixed-deps-test",
        dependencies: {
          "react": "^18.2.0",
          "typescript": "^4.0.0",
        },
        devDependencies: {
          "typescript": "^5.3.3",
          "eslint": "^8.56.0",
        },
        optionalDependencies: {
          "fsevents": "^2.3.3",
        },
        peerDependencies: {
          "react": ">=16.0.0",
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      react:
        specifier: ^18.2.0
        version: 18.2.0
      typescript:
        specifier: ^4.0.0
        version: 4.9.5
    devDependencies:
      typescript:
        specifier: ^5.3.3
        version: 5.3.3
      eslint:
        specifier: ^8.56.0
        version: 8.56.0
    optionalDependencies:
      fsevents:
        specifier: ^2.3.3
        version: 2.3.3

packages:
  react@18.2.0:
    resolution: {integrity: sha512-react==}

  typescript@4.9.5:
    resolution: {integrity: sha512-ts4==}

  typescript@5.3.3:
    resolution: {integrity: sha512-ts5==}

  eslint@8.56.0:
    resolution: {integrity: sha512-eslint==}

  fsevents@2.3.3:
    resolution: {integrity: sha512-fsevents==}
    engines: {node: ^8.16.0 || ^10.6.0 || >=11.0.0}
    os: [darwin]
    requiresBuild: true
    optional: true

snapshots:
  react@18.2.0: {}
  typescript@4.9.5: {}
  typescript@5.3.3: {}
  eslint@8.56.0: {}
  fsevents@2.3.3:
    optional: true`,
    });

    const mixedDepsProc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: mixedDepsTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [mixedDepsStderr, mixedDepsExitCode] = await Promise.all([mixedDepsProc.stderr.text(), mixedDepsProc.exited]);

    expect(mixedDepsExitCode).toBe(0);
    const mixedDepsLockfile = fs.readFileSync(join(mixedDepsTest, "bun.lock"), "utf8");

    // Dependencies version should win
    expect(mixedDepsLockfile).toContain('"typescript": "^4.0.0"');
    // But devDeps-only packages should be there
    expect(mixedDepsLockfile).toContain('"eslint": "^8.56.0"');
    expect(mixedDepsLockfile).toContain('"fsevents"');
    expect(mixedDepsLockfile).toMatchSnapshot("mixed-dependency-types");

    // ===== SECTION 15: Circular Workspace Dependencies =====
    const circularTest = tempDirWithFiles("pnpm-circular", {
      "package.json": JSON.stringify({
        name: "circular-test",
        workspaces: ["packages/*"],
        dependencies: {
          "@workspace/pkg1": "workspace:*",
        },
      }),
      "packages/pkg1/package.json": JSON.stringify({
        "name": "@workspace/pkg1",
        "version": "1.0.0",
        "main": "index.js",
        "dependencies": {
          "@workspace/pkg2": "workspace:*",
          "lodash": "^4.17.21",
        },
      }),
      "packages/pkg2/package.json": JSON.stringify({
        "name": "@workspace/pkg2",
        "version": "1.0.0",
        "main": "index.js",
        "dependencies": {
          "@workspace/pkg3": "workspace:*",
        },
      }),
      "packages/pkg3/package.json": JSON.stringify({
        "name": "@workspace/pkg3",
        "version": "1.0.0",
        "main": "index.js",
        "dependencies": {
          "@workspace/pkg1": "workspace:*",
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      '@workspace/pkg1':
        specifier: workspace:*
        version: link:packages/pkg1

  packages/pkg1:
    dependencies:
      '@workspace/pkg2':
        specifier: workspace:*
        version: link:../pkg2
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

  packages/pkg2:
    dependencies:
      '@workspace/pkg3':
        specifier: workspace:*
        version: link:../pkg3

  packages/pkg3:
    dependencies:
      '@workspace/pkg1':
        specifier: workspace:*
        version: link:../pkg1

packages:
  lodash@4.17.21:
    resolution: {integrity: sha512-lodash==}

snapshots:
  lodash@4.17.21: {}`,
    });

    const circularProc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: circularTest,
      env: bunEnv,
      stderr: "pipe",
    });

    const [circularStderr, circularExitCode] = await Promise.all([circularProc.stderr.text(), circularProc.exited]);

    expect(circularExitCode).toBe(0);
    const circularLockfile = fs.readFileSync(join(circularTest, "bun.lock"), "utf8");

    // All workspaces should be created despite circular dependencies
    expect(circularLockfile).toContain('"packages/pkg1"');
    expect(circularLockfile).toContain('"packages/pkg2"');
    expect(circularLockfile).toContain('"packages/pkg3"');
    expect(circularLockfile).toContain('"@workspace/pkg1": "workspace:*"');
    expect(circularLockfile).toMatchSnapshot("circular-workspaces");
  });
});
