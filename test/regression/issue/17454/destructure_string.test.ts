import { $ } from "bun";
test("destructure string does not become string", async () => {
  const result = await $`bun build --target=node f2.ts | bun -`.cwd(import.meta.dir).text();
  expect(result).toBe("[Function: replace]\n");
});
