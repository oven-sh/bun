import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("pnpm comprehensive migration tests", () => {
  test("large single package with many dependencies", async () => {
    const tempDir = tempDirWithFiles("pnpm-large-single", {
      "package.json": JSON.stringify(
        {
          name: "large-app",
          version: "1.0.0",
          dependencies: {
            express: "^4.18.2",
            react: "^18.2.0",
            "react-dom": "^18.2.0",
            next: "^14.0.4",
            "@emotion/react": "^11.11.3",
            "@emotion/styled": "^11.11.0",
            axios: "^1.6.5",
            lodash: "^4.17.21",
            "date-fns": "^3.2.0",
            zod: "^3.22.4",
            "@tanstack/react-query": "^5.17.9",
          },
          devDependencies: {
            "@types/node": "^20.10.8",
            "@types/react": "^18.2.47",
            typescript: "^5.3.3",
            prettier: "^3.1.1",
            eslint: "^8.56.0",
            vitest: "^1.1.3",
          },
          optionalDependencies: {
            fsevents: "^2.3.3",
          },
          peerDependencies: {
            "react-native": ">=0.72.0",
          },
          peerDependenciesMeta: {
            "react-native": {
              optional: true,
            },
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
      '@emotion/react':
        specifier: ^11.11.3
        version: 11.11.3(react@18.2.0)
      '@emotion/styled':
        specifier: ^11.11.0
        version: 11.11.0(@emotion/react@11.11.3)(react@18.2.0)
      '@tanstack/react-query':
        specifier: ^5.17.9
        version: 5.17.9(react@18.2.0)
      axios:
        specifier: ^1.6.5
        version: 1.6.5
      date-fns:
        specifier: ^3.2.0
        version: 3.2.0
      express:
        specifier: ^4.18.2
        version: 4.18.2
      lodash:
        specifier: ^4.17.21
        version: 4.17.21
      next:
        specifier: ^14.0.4
        version: 14.0.4(react-dom@18.2.0)(react@18.2.0)
      react:
        specifier: ^18.2.0
        version: 18.2.0
      react-dom:
        specifier: ^18.2.0
        version: 18.2.0(react@18.2.0)
      zod:
        specifier: ^3.22.4
        version: 3.22.4
      some-very-long-package-name-that-is-really-really-long:
        specifier: 1.2.3-beta.4.5.6.7.8.9.10.11.12.13.14.15.16.17.18.19.20
        version: 1.2.3-beta.4.5.6.7.8.9.10.11.12.13.14.15.16.17.18.19.20
      '@experimental/super-long-scoped-package-name-with-many-words':
        specifier: 0.0.0-experimental-abcdef123456-20250812-build.9876543210
        version: 0.0.0-experimental-abcdef123456-20250812-build.9876543210
    devDependencies:
      '@types/node':
        specifier: ^20.10.8
        version: 20.10.8
      '@types/react':
        specifier: ^18.2.47
        version: 18.2.47
      eslint:
        specifier: ^8.56.0
        version: 8.56.0
      prettier:
        specifier: ^3.1.1
        version: 3.1.1
      typescript:
        specifier: ^5.3.3
        version: 5.3.3
      vitest:
        specifier: ^1.1.3
        version: 1.1.3
    optionalDependencies:
      fsevents:
        specifier: ^2.3.3
        version: 2.3.3

packages:
  '@emotion/react@11.11.3':
    resolution: {integrity: sha512-emotion-react==}
    peerDependencies:
      react: '>=16.8.0'

  '@emotion/styled@11.11.0':
    resolution: {integrity: sha512-emotion-styled==}
    peerDependencies:
      '@emotion/react': ^11.0.0
      react: '>=16.8.0'

  '@tanstack/react-query@5.17.9':
    resolution: {integrity: sha512-tanstack==}
    peerDependencies:
      react: '>=18.0.0'

  axios@1.6.5:
    resolution: {integrity: sha512-axios==}

  date-fns@3.2.0:
    resolution: {integrity: sha512-date-fns==}

  express@4.18.2:
    resolution: {integrity: sha512-express==}
    engines: {node: '>= 0.10.0'}

  lodash@4.17.21:
    resolution: {integrity: sha512-lodash==}

  next@14.0.4:
    resolution: {integrity: sha512-next==}
    engines: {node: '>=18.17.0'}
    hasBin: true
    peerDependencies:
      react: '^18.2.0'
      react-dom: '^18.2.0'

  react@18.2.0:
    resolution: {integrity: sha512-react==}
    engines: {node: '>=0.10.0'}

  react-dom@18.2.0:
    resolution: {integrity: sha512-react-dom==}
    peerDependencies:
      react: ^18.2.0

  zod@3.22.4:
    resolution: {integrity: sha512-zod==}

  '@types/node@20.10.8':
    resolution: {integrity: sha512-types-node==}

  '@types/react@18.2.47':
    resolution: {integrity: sha512-types-react==}

  eslint@8.56.0:
    resolution: {integrity: sha512-eslint==}
    engines: {node: ^12.22.0 || ^14.17.0 || >=16.0.0}
    hasBin: true

  prettier@3.1.1:
    resolution: {integrity: sha512-prettier==}
    engines: {node: '>=14'}
    hasBin: true

  typescript@5.3.3:
    resolution: {integrity: sha512-typescript==}
    engines: {node: '>=14.17'}
    hasBin: true

  vitest@1.1.3:
    resolution: {integrity: sha512-vitest==}
    engines: {node: ^18.0.0 || >=20.0.0}
    hasBin: true

  fsevents@2.3.3:
    resolution: {integrity: sha512-fsevents==}
    engines: {node: ^8.16.0 || ^10.6.0 || >=11.0.0}
    os: [darwin]

  loose-envify@1.4.0:
    resolution: {integrity: sha512-loose==}
    hasBin: true

  js-tokens@4.0.0:
    resolution: {integrity: sha512-tokens==}

  scheduler@0.23.0:
    resolution: {integrity: sha512-scheduler==}
  
  some-very-long-package-name-that-is-really-really-long@1.2.3-beta.4.5.6.7.8.9.10.11.12.13.14.15.16.17.18.19.20:
    resolution: {integrity: sha512-longpackage==}
  
  '@experimental/super-long-scoped-package-name-with-many-words@0.0.0-experimental-abcdef123456-20250812-build.9876543210':
    resolution: {integrity: sha512-experimental==}

  accepts@1.3.8:
    resolution: {integrity: sha512-accepts==}
    engines: {node: '>= 0.6'}

  mime-types@2.1.35:
    resolution: {integrity: sha512-mime-types==}
    engines: {node: '>= 0.6'}

  negotiator@0.6.3:
    resolution: {integrity: sha512-negotiator==}
    engines: {node: '>= 0.6'}

snapshots:
  '@emotion/react@11.11.3(react@18.2.0)':
    dependencies:
      react: 18.2.0

  '@emotion/styled@11.11.0(@emotion/react@11.11.3)(react@18.2.0)':
    dependencies:
      '@emotion/react': 11.11.3(react@18.2.0)
      react: 18.2.0

  '@tanstack/react-query@5.17.9(react@18.2.0)':
    dependencies:
      react: 18.2.0

  axios@1.6.5: {}

  date-fns@3.2.0: {}

  express@4.18.2:
    dependencies:
      accepts: 1.3.8

  lodash@4.17.21: {}

  next@14.0.4(react-dom@18.2.0)(react@18.2.0):
    dependencies:
      react: 18.2.0
      react-dom: 18.2.0(react@18.2.0)

  react@18.2.0:
    dependencies:
      loose-envify: 1.4.0

  react-dom@18.2.0(react@18.2.0):
    dependencies:
      react: 18.2.0
      scheduler: 0.23.0

  zod@3.22.4: {}

  '@types/node@20.10.8': {}

  '@types/react@18.2.47': {}

  eslint@8.56.0: {}

  prettier@3.1.1: {}

  typescript@5.3.3: {}

  vitest@1.1.3: {}

  fsevents@2.3.3:
    optional: true

  loose-envify@1.4.0:
    dependencies:
      js-tokens: 4.0.0

  js-tokens@4.0.0: {}

  scheduler@0.23.0:
    dependencies:
      loose-envify: 1.4.0
  
  some-very-long-package-name-that-is-really-really-long@1.2.3-beta.4.5.6.7.8.9.10.11.12.13.14.15.16.17.18.19.20: {}
  
  '@experimental/super-long-scoped-package-name-with-many-words@0.0.0-experimental-abcdef123456-20250812-build.9876543210': {}

  accepts@1.3.8:
    dependencies:
      mime-types: 2.1.35
      negotiator: 0.6.3

  mime-types@2.1.35: {}

  negotiator@0.6.3: {}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: tempDir,
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
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(fs.existsSync(join(tempDir, "bun.lock"))).toBe(true);

    const bunLockContent = fs.readFileSync(join(tempDir, "bun.lock"), "utf8");
    expect(bunLockContent).toMatchSnapshot("large-single-package");
  }, 200000);

  test("complex monorepo with cross-dependencies", async () => {
    const tempDir = tempDirWithFiles("pnpm-complex-workspace", {
      "package.json": JSON.stringify(
        {
          name: "monorepo-root",
          version: "1.0.0",
          private: true,
          workspaces: ["packages/*", "apps/*", "tools/*"],
          devDependencies: {
            turbo: "^1.11.2",
            prettier: "^3.1.1",
          },
        },
        null,
        2,
      ),
      "pnpm-workspace.yaml": `packages:
  - 'packages/*'
  - 'apps/*'
  - 'tools/*'
`,
      "packages/ui/package.json": JSON.stringify(
        {
          name: "@company/ui",
          version: "1.0.0",
          dependencies: {
            react: "^18.2.0",
            "@radix-ui/react-dialog": "^1.0.5",
            "class-variance-authority": "^0.7.0",
            clsx: "^2.1.0",
          },
          devDependencies: {
            "@types/react": "^18.2.47",
          },
          peerDependencies: {
            react: ">=16.8.0",
          },
        },
        null,
        2,
      ),
      "packages/utils/package.json": JSON.stringify(
        {
          name: "@company/utils",
          version: "1.0.0",
          dependencies: {
            "date-fns": "^3.2.0",
            zod: "^3.22.4",
          },
        },
        null,
        2,
      ),
      "packages/config/package.json": JSON.stringify(
        {
          name: "@company/config",
          version: "1.0.0",
          devDependencies: {
            "@company/utils": "workspace:*",
          },
        },
        null,
        2,
      ),
      "apps/web/package.json": JSON.stringify(
        {
          name: "@company/web",
          version: "1.0.0",
          dependencies: {
            "@company/ui": "workspace:*",
            "@company/utils": "workspace:*",
            next: "^14.0.4",
            react: "^18.2.0",
            "react-dom": "^18.2.0",
          },
          devDependencies: {
            "@company/config": "workspace:*",
            "@types/node": "^20.10.8",
            "@types/react": "^18.2.47",
            typescript: "^5.3.3",
          },
        },
        null,
        2,
      ),
      "apps/api/package.json": JSON.stringify(
        {
          name: "@company/api",
          version: "1.0.0",
          dependencies: {
            "@company/utils": "workspace:*",
            express: "^4.18.2",
            cors: "^2.8.5",
            dotenv: "^16.3.1",
          },
          devDependencies: {
            "@company/config": "workspace:*",
            "@types/express": "^4.17.21",
            "@types/cors": "^2.8.17",
            nodemon: "^3.0.2",
          },
        },
        null,
        2,
      ),
      "tools/cli/package.json": JSON.stringify(
        {
          name: "@company/cli",
          version: "1.0.0",
          bin: {
            "company-cli": "./bin/cli.js",
          },
          dependencies: {
            "@company/utils": "workspace:*",
            commander: "^11.1.0",
            chalk: "^5.3.0",
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
    devDependencies:
      prettier:
        specifier: ^3.1.1
        version: 3.1.1
      turbo:
        specifier: ^1.11.2
        version: 1.11.2

  apps/api:
    dependencies:
      '@company/utils':
        specifier: workspace:*
        version: link:../../packages/utils
      cors:
        specifier: ^2.8.5
        version: 2.8.5
      dotenv:
        specifier: ^16.3.1
        version: 16.3.1
      express:
        specifier: ^4.18.2
        version: 4.18.2
    devDependencies:
      '@company/config':
        specifier: workspace:*
        version: link:../../packages/config
      '@types/cors':
        specifier: ^2.8.17
        version: 2.8.17
      '@types/express':
        specifier: ^4.17.21
        version: 4.17.21
      nodemon:
        specifier: ^3.0.2
        version: 3.0.2

  apps/web:
    dependencies:
      '@company/ui':
        specifier: workspace:*
        version: link:../../packages/ui
      '@company/utils':
        specifier: workspace:*
        version: link:../../packages/utils
      next:
        specifier: ^14.0.4
        version: 14.0.4(react-dom@18.2.0)(react@18.2.0)
      react:
        specifier: ^18.2.0
        version: 18.2.0
      react-dom:
        specifier: ^18.2.0
        version: 18.2.0(react@18.2.0)
    devDependencies:
      '@company/config':
        specifier: workspace:*
        version: link:../../packages/config
      '@types/node':
        specifier: ^20.10.8
        version: 20.10.8
      '@types/react':
        specifier: ^18.2.47
        version: 18.2.47
      typescript:
        specifier: ^5.3.3
        version: 5.3.3

  packages/config:
    devDependencies:
      '@company/utils':
        specifier: workspace:*
        version: link:../utils

  packages/ui:
    dependencies:
      '@radix-ui/react-dialog':
        specifier: ^1.0.5
        version: 1.0.5(react-dom@18.2.0)(react@18.2.0)
      class-variance-authority:
        specifier: ^0.7.0
        version: 0.7.0
      clsx:
        specifier: ^2.1.0
        version: 2.1.0
      react:
        specifier: ^18.2.0
        version: 18.2.0
    devDependencies:
      '@types/react':
        specifier: ^18.2.47
        version: 18.2.47

  packages/utils:
    dependencies:
      date-fns:
        specifier: ^3.2.0
        version: 3.2.0
      zod:
        specifier: ^3.22.4
        version: 3.22.4

  tools/cli:
    dependencies:
      '@company/utils':
        specifier: workspace:*
        version: link:../../packages/utils
      chalk:
        specifier: ^5.3.0
        version: 5.3.0
      commander:
        specifier: ^11.1.0
        version: 11.1.0

packages:
  prettier@3.1.1:
    resolution: {integrity: sha512-prettier==}
    engines: {node: '>=14'}
    hasBin: true

  turbo@1.11.2:
    resolution: {integrity: sha512-turbo==}
    hasBin: true

  cors@2.8.5:
    resolution: {integrity: sha512-cors==}
    engines: {node: '>= 0.10'}

  dotenv@16.3.1:
    resolution: {integrity: sha512-dotenv==}
    engines: {node: '>=12'}

  express@4.18.2:
    resolution: {integrity: sha512-express==}
    engines: {node: '>= 0.10.0'}

  '@types/cors@2.8.17':
    resolution: {integrity: sha512-types-cors==}

  '@types/express@4.17.21':
    resolution: {integrity: sha512-types-express==}

  nodemon@3.0.2:
    resolution: {integrity: sha512-nodemon==}
    engines: {node: '>=10'}
    hasBin: true

  next@14.0.4:
    resolution: {integrity: sha512-next==}
    engines: {node: '>=18.17.0'}
    hasBin: true
    peerDependencies:
      react: '^18.2.0'
      react-dom: '^18.2.0'

  react@18.2.0:
    resolution: {integrity: sha512-react==}
    engines: {node: '>=0.10.0'}

  react-dom@18.2.0:
    resolution: {integrity: sha512-react-dom==}
    peerDependencies:
      react: ^18.2.0

  '@types/node@20.10.8':
    resolution: {integrity: sha512-types-node==}

  '@types/react@18.2.47':
    resolution: {integrity: sha512-types-react==}

  typescript@5.3.3:
    resolution: {integrity: sha512-typescript==}
    engines: {node: '>=14.17'}
    hasBin: true

  '@radix-ui/react-dialog@1.0.5':
    resolution: {integrity: sha512-radix-dialog==}
    peerDependencies:
      react: ^16.8 || ^17.0 || ^18.0
      react-dom: ^16.8 || ^17.0 || ^18.0

  class-variance-authority@0.7.0:
    resolution: {integrity: sha512-cva==}

  clsx@2.1.0:
    resolution: {integrity: sha512-clsx==}
    engines: {node: '>=6'}

  date-fns@3.2.0:
    resolution: {integrity: sha512-date-fns==}

  zod@3.22.4:
    resolution: {integrity: sha512-zod==}

  chalk@5.3.0:
    resolution: {integrity: sha512-chalk==}
    engines: {node: ^12.17.0 || ^14.13 || >=16.0.0}

  commander@11.1.0:
    resolution: {integrity: sha512-commander==}
    engines: {node: '>=16'}

  loose-envify@1.4.0:
    resolution: {integrity: sha512-loose==}
    hasBin: true

  js-tokens@4.0.0:
    resolution: {integrity: sha512-tokens==}

  scheduler@0.23.0:
    resolution: {integrity: sha512-scheduler==}

snapshots:
  prettier@3.1.1: {}

  turbo@1.11.2: {}

  cors@2.8.5: {}

  dotenv@16.3.1: {}

  express@4.18.2: {}

  '@types/cors@2.8.17': {}

  '@types/express@4.17.21': {}

  nodemon@3.0.2: {}

  next@14.0.4(react-dom@18.2.0)(react@18.2.0):
    dependencies:
      react: 18.2.0
      react-dom: 18.2.0(react@18.2.0)

  react@18.2.0:
    dependencies:
      loose-envify: 1.4.0

  react-dom@18.2.0(react@18.2.0):
    dependencies:
      react: 18.2.0
      scheduler: 0.23.0

  '@types/node@20.10.8': {}

  '@types/react@18.2.47': {}

  typescript@5.3.3: {}

  '@radix-ui/react-dialog@1.0.5(react-dom@18.2.0)(react@18.2.0)':
    dependencies:
      react: 18.2.0
      react-dom: 18.2.0(react@18.2.0)

  class-variance-authority@0.7.0: {}

  clsx@2.1.0: {}

  date-fns@3.2.0: {}

  zod@3.22.4: {}

  chalk@5.3.0: {}

  commander@11.1.0: {}

  loose-envify@1.4.0:
    dependencies:
      js-tokens: 4.0.0

  js-tokens@4.0.0: {}

  scheduler@0.23.0:
    dependencies:
      loose-envify: 1.4.0
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: tempDir,
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
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(fs.existsSync(join(tempDir, "bun.lock"))).toBe(true);

    const bunLockContent = fs.readFileSync(join(tempDir, "bun.lock"), "utf8");
    expect(bunLockContent).toMatchSnapshot("complex-monorepo");
  });

  test("pnpm with patches and overrides", async () => {
    const tempDir = tempDirWithFiles("pnpm-patches-overrides", {
      "package.json": JSON.stringify(
        {
          name: "patches-test",
          version: "1.0.0",
          dependencies: {
            express: "^4.18.2",
            "is-number": "^7.0.0",
          },
          pnpm: {
            overrides: {
              "mime-types": "2.1.33",
              "negotiator@>0.6.0": "0.6.2",
            },
            patchedDependencies: {
              "express@4.18.2": "patches/express@4.18.2.patch",
            },
          },
        },
        null,
        2,
      ),
      "patches/express@4.18.2.patch": `diff --git a/lib/application.js b/lib/application.js
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
     value: true
`,
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

overrides:
  mime-types: 2.1.33
  'negotiator@>0.6.0': 0.6.2

patchedDependencies:
  express@4.18.2:
    hash: abc123def456
    path: patches/express@4.18.2.patch

importers:
  .:
    dependencies:
      express:
        specifier: ^4.18.2
        version: 4.18.2(patch_hash=abc123def456)
      is-number:
        specifier: ^7.0.0
        version: 7.0.0

packages:
  express@4.18.2:
    resolution: {integrity: sha512-express==}
    engines: {node: '>= 0.10.0'}
    patched: true

  is-number@7.0.0:
    resolution: {integrity: sha512-is-number==}
    engines: {node: '>=0.12.0'}

  accepts@1.3.8:
    resolution: {integrity: sha512-accepts==}
    engines: {node: '>= 0.6'}

  mime-types@2.1.33:
    resolution: {integrity: sha512-mime-types-override==}
    engines: {node: '>= 0.6'}

  mime-db@1.50.0:
    resolution: {integrity: sha512-mime-db==}
    engines: {node: '>= 0.6'}

  negotiator@0.6.2:
    resolution: {integrity: sha512-negotiator-override==}
    engines: {node: '>= 0.6'}

  array-flatten@1.1.1:
    resolution: {integrity: sha512-array-flatten==}

snapshots:
  express@4.18.2(patch_hash=abc123def456):
    dependencies:
      accepts: 1.3.8
      array-flatten: 1.1.1

  is-number@7.0.0: {}

  accepts@1.3.8:
    dependencies:
      mime-types: 2.1.33
      negotiator: 0.6.2

  mime-types@2.1.33:
    dependencies:
      mime-db: 1.50.0

  mime-db@1.50.0: {}

  negotiator@0.6.2: {}

  array-flatten@1.1.1: {}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: tempDir,
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
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(fs.existsSync(join(tempDir, "bun.lock"))).toBe(true);

    const bunLockContent = fs.readFileSync(join(tempDir, "bun.lock"), "utf8");
    expect(bunLockContent).toMatchSnapshot("patches-overrides");
  });

  test("pnpm v6 format (unsupported)", async () => {
    const tempDir = tempDirWithFiles("pnpm-v6", {
      "package.json": JSON.stringify({
        name: "v6-format-test",
        version: "1.0.0",
        dependencies: {
          "lodash": "^4.17.21",
        },
      }),
      "pnpm-lock.yaml": `lockfileVersion: '6.0'

dependencies:
  lodash:
    specifier: ^4.17.21
    version: 4.17.21

packages:
  /lodash@4.17.21:
    resolution: {integrity: sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: tempDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should fail with error message
    expect(exitCode).toBe(1);
    expect(stderr).toContain("pnpm-lock.yaml version is too old");
    expect(stderr).toContain("Please upgrade using 'pnpm install");
  });

  test("pnpm with peer dependencies and auto-install-peers", async () => {
    const tempDir = tempDirWithFiles("pnpm-peer-deps", {
      "package.json": JSON.stringify(
        {
          name: "peer-deps-test",
          version: "1.0.0",
          dependencies: {
            "@angular/animations": "^17.0.0",
            "@angular/common": "^17.0.0",
            "@angular/core": "^17.0.0",
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
      '@angular/animations':
        specifier: ^17.0.0
        version: 17.0.8(@angular/core@17.0.8)
      '@angular/common':
        specifier: ^17.0.0
        version: 17.0.8(@angular/core@17.0.8)(rxjs@7.8.1)
      '@angular/core':
        specifier: ^17.0.0
        version: 17.0.8(rxjs@7.8.1)(zone.js@0.14.2)
    optionalDependencies:
      rxjs:
        specifier: ^6.5.3 || ^7.4.0
        version: 7.8.1
      tslib:
        specifier: ^2.3.0
        version: 2.6.2
      zone.js:
        specifier: ~0.14.0
        version: 0.14.2

packages:
  '@angular/animations@17.0.8':
    resolution: {integrity: sha512-angular-animations==}
    engines: {node: ^18.13.0 || >=20.9.0}
    peerDependencies:
      '@angular/core': 17.0.8

  '@angular/common@17.0.8':
    resolution: {integrity: sha512-angular-common==}
    engines: {node: ^18.13.0 || >=20.9.0}
    peerDependencies:
      '@angular/core': 17.0.8
      rxjs: ^6.5.3 || ^7.4.0

  '@angular/core@17.0.8':
    resolution: {integrity: sha512-angular-core==}
    engines: {node: ^18.13.0 || >=20.9.0}
    peerDependencies:
      rxjs: ^6.5.3 || ^7.4.0
      zone.js: ~0.14.0

  rxjs@7.8.1:
    resolution: {integrity: sha512-rxjs==}

  tslib@2.6.2:
    resolution: {integrity: sha512-tslib==}

  zone.js@0.14.2:
    resolution: {integrity: sha512-zone==}

snapshots:
  '@angular/animations@17.0.8(@angular/core@17.0.8)':
    dependencies:
      '@angular/core': 17.0.8(rxjs@7.8.1)(zone.js@0.14.2)
      tslib: 2.6.2

  '@angular/common@17.0.8(@angular/core@17.0.8)(rxjs@7.8.1)':
    dependencies:
      '@angular/core': 17.0.8(rxjs@7.8.1)(zone.js@0.14.2)
      rxjs: 7.8.1
      tslib: 2.6.2

  '@angular/core@17.0.8(rxjs@7.8.1)(zone.js@0.14.2)':
    dependencies:
      rxjs: 7.8.1
      tslib: 2.6.2
      zone.js: 0.14.2

  rxjs@7.8.1:
    dependencies:
      tslib: 2.6.2

  tslib@2.6.2: {}

  zone.js@0.14.2: {}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: tempDir,
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
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");
    expect(fs.existsSync(join(tempDir, "bun.lock"))).toBe(true);

    const bunLockContent = fs.readFileSync(join(tempDir, "bun.lock"), "utf8");
    expect(bunLockContent).toMatchSnapshot("peer-deps-auto-install");
  });
});
