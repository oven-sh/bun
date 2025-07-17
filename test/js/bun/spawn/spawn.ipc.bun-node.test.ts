import { expect, test } from "bun:test";
import { bunExe } from "harness";
import path from "path";

test("ipc with json serialization still works when bun is parent and not the child", async () => {
  const child = Bun.spawn([bunExe(), path.resolve(import.meta.dir, "fixtures", "ipc-parent-bun.js")], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await child.exited;
  expect(await new Response(child.stdout).text()).toEqual(
    `p start
p end
c start
c end
c I am your father
p I am your father
`,
  );
  expect(await new Response(child.stderr).text()).toEqual("");
});
