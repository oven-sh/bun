import * as fs from "fs/promises";

test("no double export", async () => {
  await fs.rm(import.meta.dir + "/dist", { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [import.meta.dir + "/a.fixture.ts", import.meta.dir + "/b.fixture.ts"],
    format: "esm",
    sourcemap: "external",
    splitting: true,
    outdir: import.meta.dir + "/dist",
    target: "bun",
    minify: false,
    define: {
      "process.env.NODE_ENV": `"development"`,
    },
  });

  // @ts-ignore
  const { b } = await import("./dist/a.fixture.js");
  expect(b()).toBe("b");
  // should not throw
});
