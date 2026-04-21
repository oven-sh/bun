import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/29547
//
// YARR JIT's parenContextHead-clearing helper nulled a frame slot that
// aliased a sibling alternative's returnAddress, causing an indirect
// jump to RIP=0 on backtrack. Spawned as a child so the JIT compiles
// fresh (crash only reproduces cold).
test.concurrent("issue/29547: YARR JIT parenContextHead alias SEGV", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const r = /(?:[abc]+(?:.|b)|(?:a)*)*>/;
        const result = r.exec(' x="c" ');
        console.log(result === null ? "null" : result[0]);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // stderr is not asserted empty: ASAN/debug builds can emit signal-handler warnings there.
  expect(stdout).toBe("null\n");
  if (exitCode !== 0) console.error(stderr);
  expect(exitCode).toBe(0);
});
