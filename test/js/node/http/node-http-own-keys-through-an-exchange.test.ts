import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

async function expectOutput(program: string, expected: string) {
  await using proc = Bun.spawn({ cmd: [bunExe(), program], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.split("\n")).toEqual((await Bun.file(join(import.meta.dir, expected)).text()).split("\n"));
  expect(exitCode).toBe(0);
}

test("the own keys of responses, requests, sockets and emitters through their lives", async () => {
  await expectOutput(
    join(import.meta.dir, "../../../aot/parallel/library-modules/keys-responses-sockets-emitters-lives.js"),
    "node-http-own-keys-through-an-exchange.expected.txt",
  );
});

test("what the own properties of a response and its socket hold through their lives", async () => {
  await expectOutput(
    join(import.meta.dir, "node-http-own-values-through-an-exchange-fixture.js"),
    "node-http-own-values-through-an-exchange.expected.txt",
  );
});
