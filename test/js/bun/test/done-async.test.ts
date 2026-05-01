import { expect, test } from "bun:test";

import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path from "path";

test("done() causes the test to fail when it should", async () => {
  const dir = tempDirWithFiles("done", {
    "done.test.ts": await Bun.file(path.join(import.meta.dir, "done-infinity.fixture.ts")).text(),
    "package.json": JSON.stringify({
      name: "done",
      version: "0.0.0",
      scripts: {
        test: "bun test",
      },
    }),
  });

  const $$ = new Bun.$.Shell();
  $$.nothrow();
  $$.cwd(dir);
  $$.env(bunEnv);
  const result = await $$`${bunExe()} test`;

  console.log(result.stdout.toString());
  console.log(result.stderr.toString());

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain(" 7 fail\n");
  expect(result.stderr.toString()).toContain(" 0 pass\n");
});
