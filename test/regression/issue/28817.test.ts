// https://github.com/oven-sh/bun/issues/28817
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

  test("bare required-value flag does not hijack the entrypoint", async () => {
    // Regression guard for a `--require` / `--dns-result-order` etc. with no
    // value following in NODE_OPTIONS. A bare required-value flag must be
    // DROPPED; otherwise clap would bind the user's -e script (or entrypoint)
    // as the flag's value and the script would never run.
    const r = await runWith("--dns-result-order", 'console.log("ran");');
    expect(r.stdout).toBe("ran");
    expect(r.exitCode).toBe(0);

    // Same with --require — must not consume the -e script as the path.
    const r2 = await runWith("--require", 'console.log("still ran");');
    expect(r2.stdout).toBe("still ran");
    expect(r2.exitCode).toBe(0);
  });

  test("bare required-value flag followed by another flag is dropped", async () => {
    // `--dns-result-order` has no value, then `--expose-gc` follows — which
    // starts with `-`, so the first flag must not consume it. Result: the
    // first flag is dropped; --expose-gc still takes effect.
    const r = await runWith("--dns-result-order --expose-gc", "console.log(typeof gc);");
    expect(r.stdout).toBe("function");
    expect(r.exitCode).toBe(0);
  });
});
