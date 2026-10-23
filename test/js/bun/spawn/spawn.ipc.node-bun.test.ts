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
  // "p end" is the only line with no fixed place: the parent prints it right after it spawns the
  // child, on the stdout both processes share. Every other line can only follow the one before it.
  const lines = (await new Response(child.stdout).text()).trimEnd().split("\n");
  expect({
    parent: lines.filter(line => line.startsWith("p ")),
    withoutParentEnd: lines.filter(line => line !== "p end"),
  }).toEqual({
    parent: ["p start", "p end", "p I am your father"],
    withoutParentEnd: ["p start", "c start", "c end", "c I am your father", "p I am your father"],
  });
});
