import { bunEnv, bunExe } from "harness";
import path from "path";

test("works with prompts", async () => {
  var child = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "prompts.js")],
    env: bunEnv,
    stdout: "pipe",
    stdin: "pipe",
  });

  const reader = child.stdout.getReader();

  await reader.read();
  reader.releaseLock();

  child.stdin.write("dylan\n");
  await Bun.sleep(100);
  child.stdin.write("999\n");
  await Bun.sleep(100);
  child.stdin.write("hi\n");
  expect(await child.exited).toBe(0);

  var out = "";
  for await (const chunk of child.stdout) {
    out += new TextDecoder().decode(chunk);
  }

  expect(out).toContain('twitter: "@dylan"');
  expect(out).toContain("age: 999");
  expect(out).toContain('secret: "hi"');
});
