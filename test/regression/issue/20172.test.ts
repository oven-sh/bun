import { expect, test } from "bun:test";
import { bunRun, tempDirWithFiles } from "harness";
import { join } from "path";

test("tsconfig references resolves paths from referenced configs", () => {
  const dir = tempDirWithFiles("tsconfig-refs", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.node.json" }],
    }),
    "tsconfig.app.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["./src/*"],
        },
      },
      include: ["src/**/*"],
    }),
    "tsconfig.node.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@server/*": ["./server/*"],
        },
      },
      include: ["server/**/*"],
    }),
    "server/index.ts": `import { foo } from '@server/lib/foo';
console.log(foo);`,
    "server/lib/foo.ts": `export const foo = 123;`,
    "src/main.ts": `import { bar } from '@/lib/bar';
console.log(bar);`,
    "src/lib/bar.ts": `export const bar = 456;`,
  });

  // Test @server/* paths from tsconfig.node.json
  const serverResult = bunRun(join(dir, "server/index.ts"));
  expect(serverResult.stdout).toBe("123");

  // Test @/* paths from tsconfig.app.json
  const appResult = bunRun(join(dir, "src/main.ts"));
  expect(appResult.stdout).toBe("456");
});

test("tsconfig references resolves directory references", () => {
  const dir = tempDirWithFiles("tsconfig-dir-refs", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./app" }],
    }),
    "app/tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: "..",
        paths: {
          "#utils/*": ["./src/utils/*"],
        },
      },
    }),
    "src/index.ts": `import { helper } from '#utils/helper';
console.log(helper);`,
    "src/utils/helper.ts": `export const helper = "works";`,
  });

  const result = bunRun(join(dir, "src/index.ts"));
  expect(result.stdout).toBe("works");
});

test("tsconfig references with extends in referenced config", () => {
  const dir = tempDirWithFiles("tsconfig-refs-extends", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    }),
    "tsconfig.app.json": JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: {
        paths: {
          "@app/*": ["./src/*"],
        },
      },
    }),
    "tsconfig.base.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
      },
    }),
    "src/index.ts": `import { val } from '@app/lib/val';
console.log(val);`,
    "src/lib/val.ts": `export const val = "extended";`,
  });

  const result = bunRun(join(dir, "src/index.ts"));
  expect(result.stdout).toBe("extended");
});
