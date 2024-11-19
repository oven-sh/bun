import { $ } from "bun";

test("$ does not segfault", async () => {
  await $`echo ${Array(1000000).fill("a")}`;
});
