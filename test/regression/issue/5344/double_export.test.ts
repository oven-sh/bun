import * as fs from "fs/promises";

test("no double export", async () => {
  await fs.rm(import.meta.dir + "/dist", { recursive: true, force: true });

  await Bun.build({
    entrypoints: [import.meta.dir + "/a.fixture.ts", import.meta.dir + "/b.fixture.ts"],
    splitting: true,
    outdir: import.meta.dir + "/dist",
  });

  // @ts-ignore
  const { b } = await import("./dist/a.fixture.js");
  expect(b()).toBe("b");
  // should not throw
});
