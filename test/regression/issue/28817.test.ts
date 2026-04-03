// Regression test for https://github.com/oven-sh/bun/issues/28817
// Bun should honor NODE_OPTIONS=--dns-result-order and other Node-compatible
// flags set via the NODE_OPTIONS environment variable.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function run(nodeOptions: string, script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, NODE_OPTIONS: nodeOptions },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("NODE_OPTIONS", () => {
  test("--dns-result-order=ipv4first sets default order via env", async () => {
    const { stdout, exitCode } = await run(
      "--dns-result-order=ipv4first",
      'import dns from "node:dns"; console.log(dns.getDefaultResultOrder());',
    );
    expect(stdout.trim()).toBe("ipv4first");
    expect(exitCode).toBe(0);
  });

  test("--dns-result-order ipv6first (space separated) also works", async () => {
    const { stdout, exitCode } = await run(
      "--dns-result-order ipv6first",
      'import dns from "node:dns"; console.log(dns.getDefaultResultOrder());',
    );
    expect(stdout.trim()).toBe("ipv6first");
    expect(exitCode).toBe(0);
  });

  test("default order is verbatim without NODE_OPTIONS", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", 'import dns from "node:dns"; console.log(dns.getDefaultResultOrder());'],
      env: { ...bunEnv, NODE_OPTIONS: "" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("verbatim");
    expect(exitCode).toBe(0);
  });

  test("getDefaultResultOrder returns a string, not a function", async () => {
    const { stdout, exitCode } = await run(
      "--dns-result-order=ipv4first",
      'import dns from "node:dns"; console.log(typeof dns.getDefaultResultOrder());',
    );
    expect(stdout.trim()).toBe("string");
    expect(exitCode).toBe(0);
  });

  test("unknown flags are silently ignored", async () => {
    const { stdout, exitCode } = await run(
      "--unknown-flag --dns-result-order=ipv4first",
      'import dns from "node:dns"; console.log(dns.getDefaultResultOrder());',
    );
    expect(stdout.trim()).toBe("ipv4first");
    expect(exitCode).toBe(0);
  });

  test("positional args cannot inject scripts via NODE_OPTIONS", async () => {
    // Even though the user put a positional-looking arg in, the entrypoint
    // should still be the -e script, not the injected positional.
    const { stdout, exitCode } = await run(
      "/etc/passwd",
      'console.log("safe");',
    );
    expect(stdout.trim()).toBe("safe");
    expect(exitCode).toBe(0);
  });

  test("--eval is not injectable via NODE_OPTIONS", async () => {
    // --eval is not in the allowlist, so this must not execute.
    const { stdout, exitCode } = await run(
      "--eval console.log('HIJACKED')",
      'console.log("original");',
    );
    expect(stdout).not.toContain("HIJACKED");
    expect(stdout.trim()).toBe("original");
    expect(exitCode).toBe(0);
  });

  test("--expose-gc exposes gc()", async () => {
    const { stdout, exitCode } = await run(
      "--expose-gc",
      'console.log(typeof gc);',
    );
    expect(stdout.trim()).toBe("function");
    expect(exitCode).toBe(0);
  });

  test("--title sets process.title", async () => {
    const { stdout, exitCode } = await run(
      "--title=my-bun-app",
      'console.log(process.title);',
    );
    expect(stdout.trim()).toBe("my-bun-app");
    expect(exitCode).toBe(0);
  });

  test("quoted values are parsed correctly", async () => {
    const { stdout, exitCode } = await run(
      `--dns-result-order='ipv4first'`,
      'import dns from "node:dns"; console.log(dns.getDefaultResultOrder());',
    );
    expect(stdout.trim()).toBe("ipv4first");
    expect(exitCode).toBe(0);
  });
});
