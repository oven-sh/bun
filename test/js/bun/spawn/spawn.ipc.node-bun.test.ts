import { expect, test } from "bun:test";
import { bunExe } from "harness";
import path from "path";

test("ipc with json serialization still works when bun is not the parent and the child", async () => {
  // prettier-ignore
  const child = Bun.spawn(["node", "--no-warnings", path.resolve(import.meta.dir, "fixtures", "ipc-parent-node.js"), bunExe()], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await child.exited;
  expect(await new Response(child.stderr).text()).toEqual("");
  expect(await new Response(child.stdout).text()).toEqual(
    `p start
p end
c start
c end
c I am your father
p I am your father
`,
  );
});
