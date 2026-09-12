import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "node:path";

describe("bun run --tsconfig-override", () => {
  test("should use custom tsconfig for path resolution", async () => {
    await using dir = tempDir("run-tsconfig-override", {
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
    await using dir = tempDir("run-tsconfig-relative", {
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
    await using dir = tempDir("run-tsconfig-monorepo", {
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
    await using dir = tempDir("run-tsconfig-nested", {
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
    await using dir = tempDir("run-tsconfig-extends", {
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
    await using dir = tempDir("run-tsconfig-cwd", {
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

  describe.concurrent("path longer than the OS path limit", () => {
    // Longer than PATH_MAX on every platform (4096 on Linux, 1024 on macOS).
    const tooLong = Buffer.alloc(5000, "a").toString();

    for (const [kind, tsconfigArg] of [
      ["absolute", "/" + tooLong],
      ["relative", tooLong],
    ] as const) {
      test(`${kind} path is reported as unreadable instead of crashing`, async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--tsconfig-override", tsconfigArg, "-e", "console.log('ran')"],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        // Windows leaves the verdict on a path this long to the file system.
        if (!isWindows) expect(stderr).toContain(`Cannot read file "${path.resolve(tsconfigArg)}": ENAMETOOLONG`);
        expect(stdout).toBe("ran\n");
        expect(proc.signalCode).toBeNull();
        expect(exitCode).toBe(0);
      });
    }
  });
});

// The override stands in for $cwd/tsconfig.json, so its compilerOptions must
// drive transpilation (not only "paths" resolution). Each fixture prints
// something that comes out differently under the defaults, and ./tsconfig.json
// sets every option to a conflicting value so the override has to win over it.
describe("--tsconfig-override compilerOptions", () => {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        jsx: "react",
        jsxFactory: "wrongFactory",
        jsxFragmentFactory: "wrongFragment",
        experimentalDecorators: false,
        emitDecoratorMetadata: false,
        useDefineForClassFields: true,
      },
    }),
    "config/override.json": JSON.stringify({
      compilerOptions: {
        jsx: "react",
        jsxFactory: "h",
        jsxFragmentFactory: "Frag",
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        useDefineForClassFields: false,
      },
    }),
    // An empty node_modules keeps the default automatic JSX runtime from
    // auto-installing react; it fails to resolve instead.
    "node_modules/.gitkeep": "",
    "jsx.tsx": `
      const h = (tag: unknown, props: unknown, ...children: unknown[]) => ({ tag, props, children });
      const Frag = "fragment";
      console.log(JSON.stringify([<div a="1">hi</div>, <><br /></>]));
    `,
    "decorators.ts": `
      function dec(...args: unknown[]) {
        console.log(JSON.stringify(args.map(arg => typeof arg)));
      }
      class Foo {
        @dec
        method() {}
      }
    `,
    "metadata.ts": `
      const seen: Record<string, string> = {};
      (Reflect as any).metadata = (metadataKey: string, value: any) => (_target: unknown, propertyKey: string) => {
        seen[propertyKey + " " + metadataKey] = [value].flat().map(type => type.name).join(",");
      };
      function dec() {}
      class Dep {}
      class Foo {
        @dec
        prop: Dep;
        @dec
        method(a: string, b: number): boolean {
          return true;
        }
      }
      console.log(JSON.stringify(seen));
    `,
    "class-fields.ts": `
      class Base {
        x = 1;
      }
      class Derived extends Base {
        x;
      }
      console.log(new Derived().x);
    `,
    "jsx.test.tsx": `
      import { expect, test } from "bun:test";
      const h = (tag: unknown, props: unknown) => ({ tag, props });
      test("jsxFactory from the override", () => {
        expect(<div a="1" />).toEqual({ tag: "div", props: { a: "1" } });
      });
    `,
  };

  const override = ["--tsconfig-override", "./config/override.json"];

  async function run(dir: string, args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("jsx, jsxFactory and jsxFragmentFactory", async () => {
    await using dir = tempDir("tsconfig-override-jsx", files);
    const { stdout, exitCode } = await run(dir, [...override, "jsx.tsx"]);

    expect(stdout).toBe(
      JSON.stringify([
        { tag: "div", props: { a: "1" }, children: ["hi"] },
        { tag: "fragment", props: null, children: [{ tag: "br", props: null, children: [] }] },
      ]) + "\n",
    );
    expect(exitCode).toBe(0);
  });

  test.concurrent("experimentalDecorators", async () => {
    await using dir = tempDir("tsconfig-override-decorators", files);
    const { stdout, exitCode } = await run(dir, [...override, "decorators.ts"]);

    // TypeScript's legacy method decorators get (prototype, key, descriptor);
    // standard decorators get (method, context).
    expect(stdout).toBe(JSON.stringify(["object", "string", "object"]) + "\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("emitDecoratorMetadata", async () => {
    await using dir = tempDir("tsconfig-override-metadata", files);
    const { stdout, exitCode } = await run(dir, [...override, "metadata.ts"]);

    expect(JSON.parse(stdout)).toEqual({
      "prop design:type": "Dep",
      "method design:type": "Function",
      "method design:paramtypes": "String,Number",
      "method design:returntype": "Boolean",
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("useDefineForClassFields", async () => {
    await using dir = tempDir("tsconfig-override-class-fields", files);
    const { stdout, exitCode } = await run(dir, [...override, "class-fields.ts"]);

    // With useDefineForClassFields: false, the uninitialized `x;` in Derived
    // is dropped instead of redefining the inherited field as undefined.
    expect(stdout).toBe("1\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("applies to bun test", async () => {
    await using dir = tempDir("tsconfig-override-bun-test", files);
    const { stderr, exitCode } = await run(dir, ["test", ...override, "jsx.test.tsx"]);

    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });
});
