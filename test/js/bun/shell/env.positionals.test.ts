import { $, spawn } from "bun";
import { describe, test, expect } from "bun:test";
import { TestBuilder } from "./test_builder";
import { bunEnv, bunExe } from "harness";
import * as path from "node:path";

describe("$ argv", async () => {
  for (let i = 0; i < process.argv.length; i++) {
    const element = process.argv[i];
    TestBuilder.command`echo $${i}`
      .exitCode(0)
      .stdout(process.argv[i] + "\n")
      .runAsTest(`$${i} should equal process.argv[${i}]`);
  }
});

test("$ argv: standalone", async () => {
  const script = path.join(import.meta.dir, "fixtures", "positionals.bun.sh");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "run", script, "a", "b", "c"],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toBeEmpty();

  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.split("\n")).toEqual([script, "a", "bb", ""]);
});

test("$ argv: standalone: not enough args", async () => {
  const script = path.join(import.meta.dir, "fixtures", "positionals.bun.sh");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "run", script],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toBeEmpty();

  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.split("\n")).toEqual([script, "", "", ""]);
});
