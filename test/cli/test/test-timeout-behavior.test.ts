import { test, expect } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux } from "harness";
import path from "path";

if (isFlaky && isLinux) {
  test.todo("processes get killed");
} else {
  test.each([true, false])("processes get killed", async sync => {
    const { exited, stdout, stderr } = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        path.join(import.meta.dir, sync ? "process-kill-fixture-sync.ts" : "process-kill-fixture.ts"),
      ],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
      env: bunEnv,
    });
    const [out, err, exitCode] = await Promise.all([new Response(stdout).text(), new Response(stderr).text(), exited]);
    console.log(out);
    console.log(err);
    // TODO: figure out how to handle terminatio nexception from spawn sync properly.
    expect(exitCode).not.toBe(0);
    expect(out).not.toContain("This should not be printed!");
    expect(err).toContain("killed 1 dangling process");
  });
}
