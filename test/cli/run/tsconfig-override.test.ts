import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { createHash } from "node:crypto";
import path from "node:path";

// Build a minimal npm tarball containing the given files under `package/`.
function buildTarball(files: Record<string, string>) {
  function header(name: string, size: number) {
    const buf = Buffer.alloc(512, 0);
    buf.write(name, 0, 100, "utf8");
    buf.write("0000644\0", 100);
    buf.write("0000000\0", 108);
    buf.write("0000000\0", 116);
    buf.write(size.toString(8).padStart(11, "0") + "\0", 124);
    buf.write("00000000000\0", 136);
    buf.fill(" ", 148, 156);
    buf.write("0", 156);
    buf.write("ustar\0", 257);
    buf.write("00", 263);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += buf[i];
    buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    return buf;
  }
  const blocks: Buffer[] = [];
  for (const [name, body] of Object.entries(files)) {
    const data = Buffer.from(body);
    blocks.push(header("package/" + name, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  const tgz = Buffer.from(Bun.gzipSync(Buffer.concat(blocks)));
  return {
    tgz,
    shasum: createHash("sha1").update(tgz).digest("hex"),
    integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64"),
  };
}

describe("bun run --tsconfig-override", () => {
  test("should use custom tsconfig for path resolution", async () => {
    const dir = tempDirWithFiles("run-tsconfig-override", {
      "index.ts": `
        import { helper } from '@helpers/math';
        console.log(helper());
      `,
      "src/math.ts": `
        export function helper() {
          return "success from custom tsconfig";
        }
      `,
      "tsconfig.json": `
        {
          "compilerOptions": {
            "paths": {
              "@helpers/*": ["./wrong/*"]
            }
          }
        }
      `,
      "custom-tsconfig.json": `
        {
          "compilerOptions": {
            "paths": {
              "@helpers/*": ["./src/*"]
            }
          }
        }
      `,
    });

    await using failProc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(dir, "index.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [failStderr, failExitCode] = await Promise.all([failProc.stderr.text(), failProc.exited]);

    expect(failStderr).toContain("Cannot find module");
    expect(failExitCode).not.toBe(0);

    await using successProc = Bun.spawn({
      cmd: [bunExe(), "run", "--tsconfig-override", path.join(dir, "custom-tsconfig.json"), path.join(dir, "index.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [successStdout, successStderr, successExitCode] = await Promise.all([
      successProc.stdout.text(),
      successProc.stderr.text(),
      successProc.exited,
    ]);

    expect(successStdout).toContain("success from custom tsconfig");

    if (!successStderr.includes("Internal error: directory mismatch")) {
      expect(successStderr).toBe("");
    }
    expect(successExitCode).toBe(0);
  });

  test("should work with relative tsconfig path", async () => {
    const dir = tempDirWithFiles("run-tsconfig-relative", {
      "src/main.ts": `
        import { lib } from '@lib/util';
        console.log(lib());
      `,
      "lib/util.ts": `
        export function lib() {
          return 42;
        }
      `,
      "config/custom.json": `
        {
          "compilerOptions": {
            "baseUrl": "../",
            "paths": {
              "@lib/*": ["lib/*"]
            }
          }
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--tsconfig-override", "./config/custom.json", "./src/main.ts"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("42");

    if (!stderr.includes("Internal error: directory mismatch")) {
      expect(stderr).toBe("");
    }
    expect(exitCode).toBe(0);
  });

  test("should work with monorepo-style paths", async () => {
    const dir = tempDirWithFiles("run-tsconfig-monorepo", {
      "apps/web/src/index.ts": `
        import { Button } from '@ui/components';
        import { config } from '@shared/config';
        console.log('App loaded with', Button(), config);
      `,
      "packages/ui/components/index.ts": `
        export function Button() {
          return 'Button component';
        }
      `,
      "packages/shared/config.ts": `
        export const config = { name: 'monorepo-app' };
      `,
      "apps/web/tsconfig.json": `
        {
          "compilerOptions": {
            "baseUrl": "../../",
            "paths": {
              "@ui/*": ["packages/ui/*"],
              "@shared/*": ["packages/shared/*"]
            }
          }
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--tsconfig-override", "./apps/web/tsconfig.json", "./apps/web/src/index.ts"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("Button component");
    expect(stdout).toContain("monorepo-app");

    if (!stderr.includes("Internal error: directory mismatch")) {
      expect(stderr).toBe("");
    }
    expect(exitCode).toBe(0);
  });

  test("should work with nested directories and complex paths", async () => {
    const dir = tempDirWithFiles("run-tsconfig-nested", {
      "frontend/src/pages/home.ts": `
        import { api } from '~/api/client';
        import { utils } from '#/utils/helpers';
        console.log(api.getHome(), utils.format('test'));
      `,
      "frontend/src/api/client.ts": `
        export const api = {
          getHome: () => 'home-data'
        };
      `,
      "frontend/src/utils/helpers.ts": `
        export const utils = {
          format: (str: string) => \`formatted-\${str}\`
        };
      `,
      "frontend/tsconfig.json": `
        {
          "compilerOptions": {
            "baseUrl": "./src",
            "paths": {
              "~/*": ["./*"],
              "#/*": ["./*"]
            }
          }
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--tsconfig-override", "./frontend/tsconfig.json", "./frontend/src/pages/home.ts"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("home-data");
    expect(stdout).toContain("formatted-test");

    if (!stderr.includes("Internal error: directory mismatch")) {
      expect(stderr).toBe("");
    }
    expect(exitCode).toBe(0);
  });

  test("should handle extending tsconfig with overrides", async () => {
    const dir = tempDirWithFiles("run-tsconfig-extends", {
      "src/app.ts": `
        import { core } from '@core/main';
        import { feature } from '@features/auth';
        console.log('Loaded:', core, feature);
      `,
      "packages/core/main.ts": `
        export const core = 'core-module';
      `,
      "features/auth/index.ts": `
        export const feature = 'auth-feature';
      `,
      "tsconfig.base.json": `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "@core/*": ["packages/core/*"]
            }
          }
        }
      `,
      "tsconfig.dev.json": `
        {
          "extends": "./tsconfig.base.json",
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "@core/*": ["packages/core/*"],
              "@features/*": ["features/*"]
            }
          }
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--tsconfig-override", "./tsconfig.dev.json", "./src/app.ts"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("core-module");
    expect(stdout).toContain("auth-feature");

    if (!stderr.includes("Internal error: directory mismatch")) {
      expect(stderr).toBe("");
    }
    expect(exitCode).toBe(0);
  });

  test("should work from different working directories", async () => {
    const dir = tempDirWithFiles("run-tsconfig-cwd", {
      "project/src/main.ts": `
        import { helper } from '@utils/math';
        console.log('Result:', helper(5, 3));
      `,
      "project/utils/math.ts": `
        export function helper(a: number, b: number) {
          return a + b;
        }
      `,
      "project/tsconfig.json": `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "@utils/*": ["utils/*"]
            }
          }
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--tsconfig-override", "project/tsconfig.json", "project/src/main.ts"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("Result: 8");

    if (!stderr.includes("Internal error: directory mismatch")) {
      expect(stderr).toBe("");
    }
    expect(exitCode).toBe(0);
  });

  // `--tsconfig-override` stores the resolved absolute path in the resolver
  // options. That path was previously a slice into joinAbsString's
  // threadlocal scratch buffer. The first root-level DirInfo read (for `/`)
  // happens before any overwrite so the common case worked, but auto-install
  // resolves packages from the global cache via `dirInfoForResolution`, which
  // calls `dirInfoUncached` with `parent == null` for a directory that *does*
  // contain a package.json — so the package.json parse (fs.abs) clobbers the
  // buffer before the subsequent tsconfig_override read, leaving a garbage
  // path and dropping the override's path mappings for that tree.
  test("path survives threadlocal buffer reuse when auto-installing", async () => {
    const pkg = "dummy-pkg-tsconfig-override-buffer";
    const tarball = buildTarball({
      "package.json": JSON.stringify({ name: pkg, version: "1.0.0", main: "index.js" }),
      // This import is resolved from inside the global-cache directory, whose
      // DirInfo only has the override's path mappings if the override path
      // survived until the second parent==null read.
      "index.js": "module.exports.hello = require('@utils/math').value;\n",
    });

    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === `/${pkg}`) {
          return Response.json({
            name: pkg,
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: pkg,
                version: "1.0.0",
                dist: {
                  tarball: `${server.url}${pkg}/-/${pkg}-1.0.0.tgz`,
                  shasum: tarball.shasum,
                  integrity: tarball.integrity,
                },
              },
            },
          });
        }
        if (url.pathname === `/${pkg}/-/${pkg}-1.0.0.tgz`) {
          return new Response(tarball.tgz, { headers: { "content-type": "application/octet-stream" } });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const dir = tempDirWithFiles("run-tsconfig-override-buffer-reuse", {
      "package.json": JSON.stringify({
        name: "tsconfig-override-buffer-reuse",
        version: "1.0.0",
        dependencies: { [pkg]: "1.0.0" },
      }),
      "custom-tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@utils/*": ["./src/*"] },
        },
      }),
      "src/math.ts": `export const value = 42;\n`,
      "index.ts": `
        import { hello } from "${pkg}";
        console.log("hello=" + hello);
      `,
      "cache/.keep": "",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--install=force", "--tsconfig-override", "./custom-tsconfig.json", "./index.ts"],
      env: {
        ...bunEnv,
        BUN_CONFIG_REGISTRY: server.url.href,
        NPM_CONFIG_REGISTRY: server.url.href,
        BUN_INSTALL_CACHE_DIR: path.join(dir, "cache"),
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Cannot find module '@utils/math'");
    expect(stdout).toContain("hello=42");
    expect(exitCode).toBe(0);
  }, 60_000);
});
