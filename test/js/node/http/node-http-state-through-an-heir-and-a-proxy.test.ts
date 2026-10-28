import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

async function expectOutput(program: string, expected: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "../../../aot/programs/node-http-probes", program)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.split("\n")).toEqual((await Bun.file(join(import.meta.dir, expected)).text()).split("\n"));
  expect(exitCode).toBe(0);
}

test("what a Proxy of a response traps and what an heir of one gets while headers are stored, read and sent", async () => {
  await expectOutput(
    "headers-of-a-response-through-a-proxy-and-an-heir.ts",
    "node-http-headers-through-an-heir-and-a-proxy.expected.txt",
  );
});

test("what a Proxy of a response traps and what an heir of one gets until the connection is free again", async () => {
  await expectOutput(
    "state-of-a-response-through-a-proxy-and-an-heir.ts",
    "node-http-state-through-an-heir-and-a-proxy.expected.txt",
  );
});
