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
  // Both processes write to the same stdout. Nothing orders the parent's "p end" against the
  // child's lines, so compare the lines of each process on their own.
  const lines = (await new Response(child.stdout).text()).trimEnd().split("\n");
  expect(Object.groupBy(lines, line => line[0])).toEqual({
    p: ["p start", "p end", "p I am your father"],
    c: ["c start", "c end", "c I am your father"],
  });
});
