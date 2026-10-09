import { bunEnv, bunExe } from "harness";

test("double connect", () => {
  // bunEnv: the repro's output must not depend on the runner's env (CI exports
  // FORCE_COLOR=1, which would colorize the inspected `true` in the child).
  const output = Bun.spawnSync({
    cmd: [bunExe(), import.meta.dirname + "/double-connect-repro.mjs", "minimal"],
    env: bunEnv,
  });
  const stderr = output.stderr.toString("utf-8");
  // The repro hardcodes one ANSI-colored line; assert content, not presentation.
  const lines = Bun.stripANSI(output.stdout.toString("utf-8")).split(/\r?\n/).filter(Boolean);
  // The listener's accept readiness and the client's connect completion are two
  // fds delivered in the same poll batch, so their relative order is not
  // guaranteed; assert the line set and each socket's own ordering instead.
  expect(lines.toSorted()).toEqual(
    [
      "[parent] server listening on port true",
      "[connection] create",
      "[connection] connected",
      "[parent] got connection",
      "[connection] closed",
    ].toSorted(),
  );
  expect(lines.indexOf("[connection] create")).toBeLessThan(lines.indexOf("[connection] connected"));
  expect(lines.indexOf("[connection] connected")).toBeLessThan(lines.indexOf("[connection] closed"));
  expect(stderr).not.toContain("error");
  expect(output.exitCode).toBe(0);
});
