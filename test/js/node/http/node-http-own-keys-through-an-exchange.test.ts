import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

const program = join(
  import.meta.dir,
  "../../../aot/programs/library-modules/own-keys-of-responses-sockets-and-emitters-through-their-lives",
);

test("the own keys of responses, requests, sockets and emitters through their lives", async () => {
  await using proc = Bun.spawn({ cmd: [bunExe(), program + ".js"], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.split("\n")).toEqual((await Bun.file(program + ".expected.txt").text()).split("\n"));
  expect(exitCode).toBe(0);
});
