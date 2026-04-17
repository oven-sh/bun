import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// A property decorator that reports how it was invoked. When Bun correctly
// inherits experimentalDecorators/emitDecoratorMetadata from an extended
// tsconfig, the decorator is called with legacy semantics
// (target = prototype, propertyKey = string). When the extended config is
// ignored, TC39 standard decorator lowering is used and target is undefined.
const decoratorFixture = `
function Prop(target: any, propertyKey: any) {
  console.log(JSON.stringify({
    targetType: typeof target,
    propertyKey: typeof propertyKey === "string" ? propertyKey : "<context-object>",
  }));
}
class Entity {
  @Prop
  name: string = "test";
}
new Entity();
`;

async function run(cwd: string, entry: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", path.join(cwd, entry)],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("tsconfig extends with package specifiers", () => {
  test("resolves extends from node_modules (explicit subpath)", async () => {
    using dir = tempDir("issue-6326", {
      "node_modules/@acme/configuration/tsconfig.base.json": JSON.stringify({
        compilerOptions: {
          jsxFactory: "h",
        },
      }),
      "tsconfig.json": JSON.stringify({
        extends: "@acme/configuration/tsconfig.base.json",
        compilerOptions: {
          jsx: "react",
        },
      }),
      // h() is only used as jsxFactory if the extends is properly resolved
      "index.tsx": `
function h(tag: string, props: any, ...children: any[]) {
  return { tag, props, children };
}
console.log(JSON.stringify(<div id="test" />));
`,
    });

    const { stdout, exitCode } = await run(String(dir), "index.tsx");

    // If jsxFactory "h" was inherited, we get our custom element object.
    // If not inherited, React.createElement is used and fails.
    expect(stdout).toContain('"tag":"div"');
    expect(exitCode).toBe(0);
  });

  test("resolves extends for scoped package (explicit subpath)", async () => {
    using dir = tempDir("issue-6326-scoped", {
      "node_modules/@acme/configuration/tsconfig.base.json": JSON.stringify({
        compilerOptions: {
          jsxFactory: "h",
          jsxFragmentFactory: "Fragment",
        },
      }),
      "tsconfig.json": JSON.stringify({
        extends: "@acme/configuration/tsconfig.base.json",
        compilerOptions: {
          jsx: "react",
        },
      }),
      "index.tsx": `
function h(tag: any, props: any, ...children: any[]) {
  return { tag: typeof tag === 'function' ? 'fragment' : tag, props, children };
}
function Fragment(props: any) { return props; }
console.log(JSON.stringify(<><span /></>));
`,
    });

    const { stdout, exitCode } = await run(String(dir), "index.tsx");

    expect(stdout).toContain('"tag":"fragment"');
    expect(exitCode).toBe(0);
  });

  test("resolves extends for unscoped package (explicit subpath)", async () => {
    using dir = tempDir("issue-6326-unscoped", {
      "node_modules/my-config/tsconfig.json": JSON.stringify({
        compilerOptions: {
          jsxFactory: "h",
        },
      }),
      "tsconfig.json": JSON.stringify({
        extends: "my-config/tsconfig.json",
        compilerOptions: {
          jsx: "react",
        },
      }),
      "index.tsx": `
function h(tag: string, props: any, ...children: any[]) {
  return { tag, props, children };
}
console.log(JSON.stringify(<div />));
`,
    });

    const { stdout, exitCode } = await run(String(dir), "index.tsx");

    expect(stdout).toContain('"tag":"div"');
    expect(exitCode).toBe(0);
  });

  test("relative extends still works", async () => {
    using dir = tempDir("issue-6326-relative", {
      "base/tsconfig.base.json": JSON.stringify({
        compilerOptions: {
          jsxFactory: "h",
        },
      }),
      "tsconfig.json": JSON.stringify({
        extends: "./base/tsconfig.base.json",
        compilerOptions: {
          jsx: "react",
        },
      }),
      "index.tsx": `
function h(tag: string, props: any, ...children: any[]) {
  return { tag, props, children };
}
console.log(JSON.stringify(<div />));
`,
    });

    const { stdout, exitCode } = await run(String(dir), "index.tsx");

    expect(stdout).toContain('"tag":"div"');
    expect(exitCode).toBe(0);
  });

  // The original bug report: experimentalDecorators + emitDecoratorMetadata
  // inherited from an extended tsconfig in node_modules. If the extends is
  // not resolved, Bun falls back to TC39 standard decorators and the
  // decorator's first argument (target) is undefined — which breaks TypeORM,
  // MikroORM, NestJS, etc.
  describe("inherits experimentalDecorators from extended config", () => {
    const baseConfig = JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    });

    const expected = JSON.stringify({ targetType: "object", propertyKey: "name" });

    test("scoped package with explicit file", async () => {
      using dir = tempDir("issue-6326-dec-a", {
        "node_modules/@repo/typescript-config/tsconfig.json": baseConfig,
        "node_modules/@repo/typescript-config/package.json": JSON.stringify({ name: "@repo/typescript-config" }),
        "tsconfig.json": JSON.stringify({ extends: "@repo/typescript-config/tsconfig.json" }),
        "index.ts": decoratorFixture,
      });

      const { stdout, exitCode } = await run(String(dir), "index.ts");
      expect(stdout.trim()).toBe(expected);
      expect(exitCode).toBe(0);
    });

    test("scoped package, bare name (implicit tsconfig.json)", async () => {
      using dir = tempDir("issue-6326-dec-b", {
        "node_modules/@repo/typescript-config/tsconfig.json": baseConfig,
        "node_modules/@repo/typescript-config/package.json": JSON.stringify({ name: "@repo/typescript-config" }),
        "tsconfig.json": JSON.stringify({ extends: "@repo/typescript-config" }),
        "index.ts": decoratorFixture,
      });

      const { stdout, exitCode } = await run(String(dir), "index.ts");
      expect(stdout.trim()).toBe(expected);
      expect(exitCode).toBe(0);
    });

    test("unscoped package, bare name (implicit tsconfig.json)", async () => {
      using dir = tempDir("issue-6326-dec-c", {
        "node_modules/base-config/tsconfig.json": baseConfig,
        "node_modules/base-config/package.json": JSON.stringify({ name: "base-config" }),
        "tsconfig.json": JSON.stringify({ extends: "base-config" }),
        "index.ts": decoratorFixture,
      });

      const { stdout, exitCode } = await run(String(dir), "index.ts");
      expect(stdout.trim()).toBe(expected);
      expect(exitCode).toBe(0);
    });

    test("scoped package, extensionless subpath", async () => {
      using dir = tempDir("issue-6326-dec-d", {
        "node_modules/@repo/typescript-config/base.json": baseConfig,
        "node_modules/@repo/typescript-config/package.json": JSON.stringify({ name: "@repo/typescript-config" }),
        "tsconfig.json": JSON.stringify({ extends: "@repo/typescript-config/base" }),
        "index.ts": decoratorFixture,
      });

      const { stdout, exitCode } = await run(String(dir), "index.ts");
      expect(stdout.trim()).toBe(expected);
      expect(exitCode).toBe(0);
    });

    test("scoped package, subpath is a directory (implicit tsconfig.json)", async () => {
      using dir = tempDir("issue-6326-dec-e", {
        "node_modules/@repo/typescript-config/configs/tsconfig.json": baseConfig,
        "node_modules/@repo/typescript-config/package.json": JSON.stringify({ name: "@repo/typescript-config" }),
        "tsconfig.json": JSON.stringify({ extends: "@repo/typescript-config/configs" }),
        "index.ts": decoratorFixture,
      });

      const { stdout, exitCode } = await run(String(dir), "index.ts");
      expect(stdout.trim()).toBe(expected);
      expect(exitCode).toBe(0);
    });

    test("node_modules in a parent directory", async () => {
      using dir = tempDir("issue-6326-dec-f", {
        "node_modules/@repo/typescript-config/tsconfig.json": baseConfig,
        "node_modules/@repo/typescript-config/package.json": JSON.stringify({ name: "@repo/typescript-config" }),
        "packages/app/tsconfig.json": JSON.stringify({ extends: "@repo/typescript-config" }),
        "packages/app/index.ts": decoratorFixture,
      });

      const { stdout, exitCode } = await run(path.join(String(dir), "packages", "app"), "index.ts");
      expect(stdout.trim()).toBe(expected);
      expect(exitCode).toBe(0);
    });

    test("inherits emitDecoratorMetadata (design:type is emitted)", async () => {
      // Use a minimal Reflect.metadata polyfill so we can observe the
      // __metadata("design:type", String) call that Bun injects when
      // emitDecoratorMetadata is active, without depending on the
      // reflect-metadata package.
      const metadataFixture = `
const store = new Map<any, Map<string, Map<string, any>>>();
(Reflect as any).metadata = (key: string, value: any) => (target: any, prop: string) => {
  const byTarget = store.get(target) ?? new Map();
  const byProp = byTarget.get(prop) ?? new Map();
  byProp.set(key, value);
  byTarget.set(prop, byProp);
  store.set(target, byTarget);
};
function Prop(_t: any, _k: string) {}
class Entity {
  @Prop
  name: string = "test";
}
const designType = store.get(Entity.prototype)?.get("name")?.get("design:type");
console.log(designType === String ? "String" : String(designType));
`;
      using dir = tempDir("issue-6326-dec-meta", {
        "node_modules/@repo/typescript-config/tsconfig.json": baseConfig,
        "node_modules/@repo/typescript-config/package.json": JSON.stringify({ name: "@repo/typescript-config" }),
        "tsconfig.json": JSON.stringify({ extends: "@repo/typescript-config" }),
        "index.ts": metadataFixture,
      });

      const { stdout, exitCode } = await run(String(dir), "index.ts");
      expect(stdout.trim()).toBe("String");
      expect(exitCode).toBe(0);
    });

    test("child config can override experimentalDecorators back to false", async () => {
      // TypeScript semantics: child overrides parent. When the child sets
      // experimentalDecorators:false, TC39 standard decorators are used even
      // though the extended base enables legacy decorators.
      using dir = tempDir("issue-6326-dec-g", {
        "node_modules/@repo/typescript-config/tsconfig.json": baseConfig,
        "node_modules/@repo/typescript-config/package.json": JSON.stringify({ name: "@repo/typescript-config" }),
        "tsconfig.json": JSON.stringify({
          extends: "@repo/typescript-config",
          compilerOptions: {
            experimentalDecorators: false,
            emitDecoratorMetadata: false,
          },
        }),
        "index.ts": decoratorFixture,
      });

      const { stdout, exitCode } = await run(String(dir), "index.ts");
      // Standard decorators: target is undefined, second arg is context object.
      expect(stdout.trim()).toBe(JSON.stringify({ targetType: "undefined", propertyKey: "<context-object>" }));
      expect(exitCode).toBe(0);
    });
  });
});
