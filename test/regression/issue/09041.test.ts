import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("09041", async () => {
  let { exited, stderr, stdout } = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dirname + "/09041/09041-fixture.ts"],
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderrText = await stderr.text();
  const stdoutText = await stdout.text();
  const exitCode = await exited;

  console.log(`
====== stderr ======
${stderrText}
====== stdout ======  
${stdoutText}
====== exit code ======
${exitCode}
`);

  expect(exitCode).toBe(0);
  const err = stderrText;
  expect(err).toContain("1 pass");
  expect(err).toContain("0 fail");
}, 30000);
