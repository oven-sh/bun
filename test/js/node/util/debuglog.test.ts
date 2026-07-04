// https://nodejs.org/api/util.html#utildebuglogsection-callback
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import util from "node:util";

async function run(script: string, nodeDebug?: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    // Always set the key so an ambient NODE_DEBUG cannot leak into the child.
    env: { ...bunEnv, NODE_DEBUG: nodeDebug },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("util.debuglog", () => {
  // The value of `enabled` depends on this process's NODE_DEBUG, so the true and
  // false cases live in the subprocess tests below.
  test("returns a function exposing an enumerable `enabled` boolean", () => {
    const log = util.debuglog("some-section");
    expect(typeof log).toBe("function");
    expect(typeof log.enabled).toBe("boolean");
    expect(Object.keys(log)).toEqual(["enabled"]);
  });

  test("util.debug is util.debuglog", () => {
    expect(util.debug).toBe(util.debuglog);
  });

  test("a disabled section writes nothing", async () => {
    const result = await run(`require("util").debuglog("quiet")("hello");`);
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  test("an enabled section writes SECTION pid: message to stderr", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const log = require("util").debuglog("noisy");
       process.stdout.write(String(log.enabled));
       log("hello %s", "world");`,
      "noisy",
    );
    expect(stdout).toBe("true");
    expect(stderr.trim()).toMatch(/^NOISY \d+: hello world$/);
    expect(exitCode).toBe(0);
  });

  test("enabled reflects NODE_DEBUG", async () => {
    const script = `const util = require("util");
      process.stdout.write(JSON.stringify([util.debuglog("a").enabled, util.debuglog("b").enabled]));`;
    const results = await Promise.all([run(script, "a"), run(script, "b"), run(script, "a,b"), run(script)]);
    expect(results.map(r => r.stdout)).toEqual(["[true,false]", "[false,true]", "[true,true]", "[false,false]"]);
  });

  test("section matching is case-insensitive and supports wildcards", async () => {
    const script = `const util = require("util");
      process.stdout.write(JSON.stringify([util.debuglog("FOO").enabled, util.debuglog("foobar").enabled]));`;
    const results = await Promise.all([run(script, "foo"), run(script, "foo*")]);
    expect(results.map(r => r.stdout)).toEqual(["[true,false]", "[true,true]"]);
  });

  test("the callback runs once, on the first call, with the logging function", async () => {
    const { stdout, exitCode } = await run(
      `const util = require("util");
       const seen = [];
       const log = util.debuglog("cb", fn => seen.push(typeof fn));
       const beforeFirstCall = seen.length;
       log("one");
       log("two");
       process.stdout.write(JSON.stringify({ beforeFirstCall, seen }));`,
      "cb",
    );
    expect(stdout).toBe(`{"beforeFirstCall":0,"seen":["function"]}`);
    expect(exitCode).toBe(0);
  });

  test("the logging function handed to the callback also reports enabled", async () => {
    const { stdout } = await run(
      `const util = require("util");
       let enabled;
       util.debuglog("cb2", fn => { enabled = fn.enabled; })("x");
       process.stdout.write(String(enabled));`,
      "cb2",
    );
    expect(stdout).toBe("true");
  });

  test("a non-function callback is ignored", async () => {
    const result = await run(`require("util").debuglog("ignored", 42)("x");`, "ignored");
    expect(result.stderr.trim()).toMatch(/^IGNORED \d+: x$/);
    expect(result.exitCode).toBe(0);
  });

  test("NODE_DEBUG=http warns that it can expose sensitive data", async () => {
    const { stderr, exitCode } = await run(`require("util").debuglog("http");`, "http");
    expect(stderr).toContain("can expose sensitive data");
    expect(exitCode).toBe(0);
  });
});
