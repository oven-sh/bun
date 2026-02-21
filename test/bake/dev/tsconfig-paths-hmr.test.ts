// Regression test for https://github.com/oven-sh/bun/issues/23907
// HMR fails to resolve aliased imports from tsconfig "paths"
import { devTest, emptyHtmlFile } from "../bake-harness";

devTest("hmr resolves tsconfig path aliases after file change", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["src/index.ts"],
    }),
    "src/index.ts": `
      import { greet } from "@/lib/utils";
      console.log(greet("World"));
      import.meta.hot.accept();
    `,
    "src/lib/utils.ts": `
      export function greet(name: string) {
        return "Hello, " + name + "!";
      }
    `,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["./src/*"],
        },
      },
    }),
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("Hello, World!");

    // Modify the file that uses the tsconfig path alias.
    // Before the fix, this would fail with:
    //   error: Could not resolve: "@/lib/utils". Maybe you need to "bun install"?
    await dev.write(
      "src/index.ts",
      `
        import { greet } from "@/lib/utils";
        console.log(greet("Bun"));
        import.meta.hot.accept();
      `,
    );
    await c.expectMessage("Hello, Bun!");
  },
});

devTest("directory cache bust with tsconfig path aliases", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["src/index.ts"],
    }),
    "src/index.ts": `
      console.log("initial");
      import.meta.hot.accept();
    `,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["./src/*"],
        },
      },
    }),
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("initial");

    // Create a new file in the aliased directory
    await c.expectNoWebSocketActivity(async () => {
      await dev.write("src/lib/helper.ts", `export const value = 42;`);
    });

    // Now import the new file via the tsconfig path alias.
    // This tests that bustDirCacheFromSpecifier correctly busts
    // the cache for the tsconfig-aliased path so the new file is found.
    await dev.write(
      "src/index.ts",
      `
        import { value } from "@/lib/helper";
        console.log("value=" + value);
      `,
    );
    await c.expectMessage("value=42");
  },
});

devTest("delete and recreate file imported via tsconfig alias recovers", {
  skip: [
    "win32", // unlinkSync is having weird behavior
  ],
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["src/index.ts"],
    }),
    "src/index.ts": `
      import { value } from "@/lib/data";
      console.log("data=" + value);
    `,
    "src/lib/data.ts": `
      export const value = 123;
    `,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["./src/*"],
        },
      },
    }),
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("data=123");

    // Delete the file imported via tsconfig alias - expect resolution error
    await dev.delete("src/lib/data.ts", {
      errors: ['src/index.ts:1:23: error: Could not resolve: "@/lib/data". Maybe you need to "bun install"?'],
    });

    // Recreate the file - the trackResolutionFailure fix ensures
    // the directory watcher was set up for the tsconfig-resolved path,
    // so the resolution can be retried and succeed.
    await c.expectReload(async () => {
      await dev.write("src/lib/data.ts", `export const value = 456;`);
    });
    await c.expectMessage("data=456");
  },
});
