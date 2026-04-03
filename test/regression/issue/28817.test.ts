// Regression test for https://github.com/oven-sh/bun/issues/28817
// Bun should honor NODE_OPTIONS=--dns-result-order and other Node-compatible
// flags set via the NODE_OPTIONS environment variable.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

async function runWith(nodeOptions: string, script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, NODE_OPTIONS: nodeOptions },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

describe("NODE_OPTIONS", () => {
  test("--dns-result-order honored via env (= and space forms)", async () => {
    const getOrder = 'import dns from "node:dns"; console.log(dns.getDefaultResultOrder());';

    // --flag=value form
    const eq = await runWith("--dns-result-order=ipv4first", getOrder);
    expect(eq.stdout).toBe("ipv4first");
    expect(eq.exitCode).toBe(0);

    // --flag value (space separated) form
    const sp = await runWith("--dns-result-order ipv6first", getOrder);
    expect(sp.stdout).toBe("ipv6first");
    expect(sp.exitCode).toBe(0);

    // quoted value
    const q = await runWith(`--dns-result-order='verbatim'`, getOrder);
    expect(q.stdout).toBe("verbatim");
    expect(q.exitCode).toBe(0);
  });

  test("default order is verbatim without NODE_OPTIONS", async () => {
    const r = await runWith("", 'import dns from "node:dns"; console.log(dns.getDefaultResultOrder());');
    expect(r.stdout).toBe("verbatim");
    expect(r.exitCode).toBe(0);
  });

  test("getDefaultResultOrder returns a string, not a function", async () => {
    const r = await runWith(
      "--dns-result-order=ipv4first",
      'import dns from "node:dns"; const v = dns.getDefaultResultOrder(); console.log(typeof v, v);',
    );
    expect(r.stdout).toBe("string ipv4first");
    expect(r.exitCode).toBe(0);
  });

  test("unknown flags and positional args are dropped", async () => {
    // Unknown flag is ignored; known flag still works.
    const r1 = await runWith(
      "--unknown-flag --dns-result-order=ipv4first",
      'import dns from "node:dns"; console.log(dns.getDefaultResultOrder());',
    );
    expect(r1.stdout).toBe("ipv4first");
    expect(r1.exitCode).toBe(0);

    // Positional arg (non-flag) cannot inject a script/entrypoint.
    const r2 = await runWith("/etc/passwd", 'console.log("safe");');
    expect(r2.stdout).toBe("safe");
    expect(r2.exitCode).toBe(0);

    // --eval is not in the allowlist, so this must not execute injected code.
    const r3 = await runWith("--eval console.log('HIJACKED')", 'console.log("original");');
    expect(r3.stdout).not.toContain("HIJACKED");
    expect(r3.stdout).toBe("original");
    expect(r3.exitCode).toBe(0);
  });

  test("--expose-gc exposes gc() via env", async () => {
    const r = await runWith("--expose-gc", "console.log(typeof gc);");
    expect(r.stdout).toBe("function");
    expect(r.exitCode).toBe(0);
  });

  test.skipIf(isWindows)("--title sets process.title via env", async () => {
    // process.title is unreliable on Windows (varies by OS version); skip there.
    const r = await runWith("--title=my-bun-app", "console.log(process.title);");
    expect(r.stdout).toBe("my-bun-app");
    expect(r.exitCode).toBe(0);
  });
});
