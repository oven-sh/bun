import path from "path";
import { bunExe, bunEnv } from "harness";

test("works with prompts", async () => {
  var child = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "prompts.js")],
    env: bunEnv,
    stdout: "pipe",
    stdin: "pipe",
  });

  child.stdin.write("dylan\n");
  Bun.sleepSync(100);
  child.stdin.write("999\n");
  Bun.sleepSync(100);
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
