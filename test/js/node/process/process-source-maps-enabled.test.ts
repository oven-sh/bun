import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("process.sourceMapsEnabled reflects setSourceMapsEnabled", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const out = [];
       out.push(process.sourceMapsEnabled);
       const desc = Object.getOwnPropertyDescriptor(process, "sourceMapsEnabled");
       out.push(typeof desc.get);
       out.push(desc.set === undefined);
       let strictThrew = false;
       try {
         (function () {
           "use strict";
           process.sourceMapsEnabled = true;
         })();
       } catch (e) {
         strictThrew = e instanceof TypeError;
       }
       out.push(strictThrew);
       out.push(process.sourceMapsEnabled);
       process.setSourceMapsEnabled(true);
       out.push(process.sourceMapsEnabled);
       process.setSourceMapsEnabled(false);
       out.push(process.sourceMapsEnabled);
       console.log(JSON.stringify(out));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual([false, "function", true, true, false, true, false]);
  expect(exitCode).toBe(0);
});
