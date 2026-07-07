import { describe, expect, test } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "path";

// Helper: spawn bun with multi-run flags, returns { stdout, stderr, exitCode }
async function runMulti(
  args: string[],
  dir: string,
  extraEnv?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: { ...bunEnv, NO_COLOR: "1", ...extraEnv },
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/**
 * Assert that `output` contains a multi-run prefixed line: `label | content`.
 * Pass r.stdout for child stdout content, r.stderr for child stderr / status messages.
 */
function expectPrefixed(output: string, label: string, content: string) {
  const re = new RegExp(`^${escapeRe(label)}\\s+\\| .*${escapeRe(content)}`, "m");
  expect(output).toMatch(re);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Assert that stderr contains `label | Done in Xms` or `label | Done in Xs`. */
function expectDone(stderr: string, label: string) {
  expect(stderr).toMatch(new RegExp(`^${escapeRe(label)}\\s+\\| Done`, "m"));
}

/** Assert that stderr contains `label | Exited with code N`. */
function expectExited(stderr: string, label: string, code: number) {
  expect(stderr).toMatch(new RegExp(`^${escapeRe(label)}\\s+\\| Exited with code ${code}`, "m"));
}

// ─── PARALLEL: BASIC ──────────────────────────────────────────────────────────

describe.concurrent("parallel: basic", () => {
  test("runs two scripts in parallel", async () => {
    using dir = tempDir("mr-par-basic", {
      "package.json": JSON.stringify({
        scripts: {
          a: `echo output-a`,
          b: `echo output-b`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "a", "b"], String(dir));
    expectPrefixed(r.stdout, "a", "output-a");
    expectPrefixed(r.stdout, "b", "output-b");
    expect(r.exitCode).toBe(0);
  });

  test("runs a single script", async () => {
    using dir = tempDir("mr-par-single", {
      "package.json": JSON.stringify({
        scripts: { only: `echo single` },
      }),
    });
    const r = await runMulti(["run", "--parallel", "only"], String(dir));
    expectPrefixed(r.stdout, "only", "single");
    expectDone(r.stderr, "only");
    expect(r.exitCode).toBe(0);
  });

  test("runs many scripts (10+)", async () => {
    const scripts: Record<string, string> = {};
    for (let i = 0; i < 12; i++) {
      scripts[`s${i}`] = `echo out-${i}`;
    }
    using dir = tempDir("mr-par-many", {
      "package.json": JSON.stringify({ scripts }),
    });
    const names = Object.keys(scripts);
    const r = await runMulti(["run", "--parallel", ...names], String(dir));
    for (let i = 0; i < 12; i++) {
      expectPrefixed(r.stdout, `s${i}`, `out-${i}`);
    }
    expect(r.exitCode).toBe(0);
  });

  test("all scripts exit 0", async () => {
    using dir = tempDir("mr-par-all-ok", {
      "package.json": JSON.stringify({
        scripts: {
          a: `exit 0`,
          b: `exit 0`,
          c: `exit 0`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "a", "b", "c"], String(dir));
    expectDone(r.stderr, "a");
    expectDone(r.stderr, "b");
    expectDone(r.stderr, "c");
    expect(r.exitCode).toBe(0);
  });
});

// ─── PARALLEL: FILE SCRIPTS ───────────────────────────────────────────────────

describe.concurrent("parallel: file scripts", () => {
  test("runs .ts files in parallel", async () => {
    using dir = tempDir("mr-par-ts", {
      "a.ts": "console.log('file-a')",
      "b.ts": "console.log('file-b')",
    });
    const r = await runMulti(["run", "--parallel", "./a.ts", "./b.ts"], String(dir));
    expectPrefixed(r.stdout, "./a.ts", "file-a");
    expectPrefixed(r.stdout, "./b.ts", "file-b");
    expect(r.exitCode).toBe(0);
  });

  test("runs .js files in parallel", async () => {
    using dir = tempDir("mr-par-js", {
      "x.js": "console.log('js-x')",
      "y.js": "console.log('js-y')",
    });
    const r = await runMulti(["run", "--parallel", "./x.js", "./y.js"], String(dir));
    expectPrefixed(r.stdout, "./x.js", "js-x");
    expectPrefixed(r.stdout, "./y.js", "js-y");
    expect(r.exitCode).toBe(0);
  });

  test("runs file without ./ prefix if it has runnable extension", async () => {
    using dir = tempDir("mr-par-ext", {
      "script.ts": "console.log('ext-match')",
    });
    const r = await runMulti(["run", "--parallel", "script.ts"], String(dir));
    expectPrefixed(r.stdout, "script.ts", "ext-match");
    expect(r.exitCode).toBe(0);
  });

  test("mixes package.json scripts and file scripts", async () => {
    using dir = tempDir("mr-par-mix", {
      "package.json": JSON.stringify({
        scripts: { greet: `echo from-pkg` },
      }),
      "standalone.ts": "console.log('from-file')",
    });
    const r = await runMulti(["run", "--parallel", "greet", "./standalone.ts"], String(dir));
    expectPrefixed(r.stdout, "greet", "from-pkg");
    expectPrefixed(r.stdout, "./standalone.ts", "from-file");
    expect(r.exitCode).toBe(0);
  });
});

// ─── PARALLEL: ERROR HANDLING ─────────────────────────────────────────────────

describe.concurrent("parallel: error handling", () => {
  test("failure kills other scripts by default", async () => {
    using dir = tempDir("mr-par-fail", {
      "package.json": JSON.stringify({
        scripts: {
          fail: `exit 1`,
          ok: `echo ok-output`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "fail", "ok"], String(dir));
    expectExited(r.stderr, "fail", 1);
    expect(r.exitCode).not.toBe(0);
  });

  test("propagates specific non-zero exit code", async () => {
    using dir = tempDir("mr-par-code", {
      "package.json": JSON.stringify({
        scripts: {
          // Deliberately a real subprocess: proves a grandchild's non-zero
          // status round-trips through the shell to multi-run.
          bad: `${bunExe()} -e "process.exit(42)"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "bad"], String(dir));
    expectExited(r.stderr, "bad", 42);
    expect(r.exitCode).toBe(42);
  });

  test("exit code is from first failed script (handle order)", async () => {
    using dir = tempDir("mr-par-first-code", {
      "package.json": JSON.stringify({
        scripts: {
          a: `exit 7`,
          b: `exit 0`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "a", "b"], String(dir));
    expectExited(r.stderr, "a", 7);
    expect(r.exitCode).toBe(7);
  });

  test("--no-exit-on-error lets all finish", async () => {
    using dir = tempDir("mr-par-noexit", {
      "package.json": JSON.stringify({
        scripts: {
          fail: `exit 1`,
          ok: `echo ok-ran`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "--no-exit-on-error", "fail", "ok"], String(dir));
    expectPrefixed(r.stdout, "ok", "ok-ran");
    expectExited(r.stderr, "fail", 1);
    expect(r.exitCode).not.toBe(0);
  });

  test("--no-exit-on-error still reports failure exit code", async () => {
    using dir = tempDir("mr-par-noexit-code", {
      "package.json": JSON.stringify({
        scripts: {
          fail: `exit 3`,
          ok: `exit 0`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "--no-exit-on-error", "fail", "ok"], String(dir));
    expectExited(r.stderr, "fail", 3);
    expectDone(r.stderr, "ok");
    expect(r.exitCode).toBe(3);
  });

  test("unknown script falls through to shell (exits non-zero)", async () => {
    using dir = tempDir("mr-par-unknown", {
      "package.json": JSON.stringify({ scripts: {} }),
    });
    const r = await runMulti(["run", "--parallel", "nonexistent-command-xyz123"], String(dir));
    // Must see the multi-run prefix format even for unknown commands
    expect(r.stderr).toMatch(/nonexistent-command-xyz123\s+\|/);
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── PARALLEL: OUTPUT FORMATTING ──────────────────────────────────────────────

describe.concurrent("parallel: output formatting", () => {
  test("each line has prefix label", async () => {
    using dir = tempDir("mr-par-prefix", {
      "package.json": JSON.stringify({
        scripts: { hello: `echo hello-world` },
      }),
    });
    const r = await runMulti(["run", "--parallel", "hello"], String(dir));
    expect(r.stdout).toContain("hello | hello-world");
    expectDone(r.stderr, "hello");
    expect(r.exitCode).toBe(0);
  });

  test("labels are padded to equal width", async () => {
    using dir = tempDir("mr-par-pad", {
      "package.json": JSON.stringify({
        scripts: {
          a: `echo short`,
          longname: `echo long`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "a", "longname"], String(dir));
    expectPrefixed(r.stdout, "a", "short");
    expectPrefixed(r.stdout, "longname", "long");
    // Both prefixes should have same width up to the " | "
    const stdoutLines = r.stdout.split("\n");
    const aLines = stdoutLines.filter(l => l.includes("| short"));
    const longLines = stdoutLines.filter(l => l.includes("| long"));
    expect(aLines.length).toBeGreaterThan(0);
    expect(longLines.length).toBeGreaterThan(0);
    const aPrefix = aLines[0].split(" | ")[0];
    const longPrefix = longLines[0].split(" | ")[0];
    expect(aPrefix.length).toBe(longPrefix.length);
    expect(r.exitCode).toBe(0);
  });

  test("multi-line output gets each line prefixed", async () => {
    using dir = tempDir("mr-par-multiline", {
      "package.json": JSON.stringify({
        scripts: {
          multi: `${bunExe()} -e "console.log('line1'); console.log('line2'); console.log('line3')"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "multi"], String(dir));
    expect(r.stdout).toContain("multi | line1");
    expect(r.stdout).toContain("multi | line2");
    expect(r.stdout).toContain("multi | line3");
    expectDone(r.stderr, "multi");
    expect(r.exitCode).toBe(0);
  });

  test("stderr output is also captured and prefixed", async () => {
    using dir = tempDir("mr-par-stderr", {
      "package.json": JSON.stringify({
        scripts: {
          err: `${bunExe()} -e "console.error('err-msg')"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "err"], String(dir));
    expect(r.stderr).toContain("err | err-msg");
    expectDone(r.stderr, "err");
    expect(r.exitCode).toBe(0);
  });

  test("output without trailing newline is flushed on exit", async () => {
    using dir = tempDir("mr-par-notrnl", {
      "package.json": JSON.stringify({
        scripts: {
          partial: `${bunExe()} -e "process.stdout.write('no-newline')"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "partial"], String(dir));
    expectPrefixed(r.stdout, "partial", "no-newline");
    expectDone(r.stderr, "partial");
    expect(r.exitCode).toBe(0);
  });

  test("very long output lines are not truncated", async () => {
    const longStr = Buffer.alloc(8000, "X").toString();
    using dir = tempDir("mr-par-long", {
      "package.json": JSON.stringify({
        scripts: {
          big: `${bunExe()} -e "console.log('${longStr}')"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "big"], String(dir));
    expectPrefixed(r.stdout, "big", longStr);
    expect(r.exitCode).toBe(0);
  });

  test("empty output script still shows exit status", async () => {
    using dir = tempDir("mr-par-empty", {
      "package.json": JSON.stringify({
        scripts: {
          silent: `exit 0`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "silent"], String(dir));
    expectDone(r.stderr, "silent");
    expect(r.exitCode).toBe(0);
  });

  test("no color codes when NO_COLOR=1", async () => {
    using dir = tempDir("mr-par-nocolor", {
      "package.json": JSON.stringify({
        scripts: { x: `echo nc` },
      }),
    });
    const r = await runMulti(["run", "--parallel", "x"], String(dir));
    expectPrefixed(r.stdout, "x", "nc");
    expect(r.stdout).not.toContain("\x1b[");
    expect(r.stderr).not.toContain("\x1b[");
    expect(r.exitCode).toBe(0);
  });

  test("shows 'Done in Xms' for successful scripts", async () => {
    using dir = tempDir("mr-par-done", {
      "package.json": JSON.stringify({
        scripts: { fast: `exit 0` },
      }),
    });
    const r = await runMulti(["run", "--parallel", "fast"], String(dir));
    expectDone(r.stderr, "fast");
    expect(r.exitCode).toBe(0);
  });

  test("shows 'Exited with code N' for failed scripts", async () => {
    using dir = tempDir("mr-par-exitcode", {
      "package.json": JSON.stringify({
        scripts: { bad: `exit 5` },
      }),
    });
    const r = await runMulti(["run", "--parallel", "bad"], String(dir));
    expectExited(r.stderr, "bad", 5);
    expect(r.exitCode).toBe(5);
  });

  test("lines are not interleaved mid-line", async () => {
    using dir = tempDir("mr-par-interleave", {
      "package.json": JSON.stringify({
        scripts: {
          aa: `${bunExe()} -e "for(let i=0;i<20;i++) console.log('aaa-'+i)"`,
          bb: `${bunExe()} -e "for(let i=0;i<20;i++) console.log('bbb-'+i)"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "aa", "bb"], String(dir));
    const lines = r.stdout.split("\n").filter(l => l.includes(" | "));
    for (const line of lines) {
      expect(line).toMatch(/^(aa|bb)\s+\|/);
    }
    expect(r.exitCode).toBe(0);
  });
});

// ─── STDOUT / STDERR SEPARATION ──────────────────────────────────────────────

describe.concurrent("stdout/stderr separation", () => {
  test("child stdout goes to parent stdout with prefix", async () => {
    using dir = tempDir("mr-sep-stdout", {
      "package.json": JSON.stringify({
        scripts: { out: `${bunExe()} -e "console.log('to-stdout')"` },
      }),
    });
    const r = await runMulti(["run", "--parallel", "out"], String(dir));
    expectPrefixed(r.stdout, "out", "to-stdout");
    // stdout content should NOT appear in stderr
    expect(r.stderr).not.toContain("to-stdout");
    expect(r.exitCode).toBe(0);
  });

  test("child stderr goes to parent stderr with prefix", async () => {
    using dir = tempDir("mr-sep-stderr", {
      "package.json": JSON.stringify({
        scripts: { err: `${bunExe()} -e "console.error('to-stderr')"` },
      }),
    });
    const r = await runMulti(["run", "--parallel", "err"], String(dir));
    expectPrefixed(r.stderr, "err", "to-stderr");
    // stderr content should NOT appear in stdout
    expect(r.stdout).not.toContain("to-stderr");
    expect(r.exitCode).toBe(0);
  });

  test("mixed stdout and stderr go to their respective streams", async () => {
    using dir = tempDir("mr-sep-mixed", {
      "package.json": JSON.stringify({
        scripts: {
          both: `${bunExe()} -e "console.log('OUT'); console.error('ERR')"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "both"], String(dir));
    expectPrefixed(r.stdout, "both", "OUT");
    expectPrefixed(r.stderr, "both", "ERR");
    // Verify they don't leak into the wrong stream
    expect(r.stderr).not.toMatch(/both\s+\| OUT/);
    expect(r.stdout).not.toMatch(/both\s+\| ERR/);
    expect(r.exitCode).toBe(0);
  });

  test("status messages always go to stderr", async () => {
    using dir = tempDir("mr-sep-status", {
      "package.json": JSON.stringify({
        scripts: { ok: `${bunExe()} -e "console.log('data')"` },
      }),
    });
    const r = await runMulti(["run", "--parallel", "ok"], String(dir));
    // Done message is on stderr
    expectDone(r.stderr, "ok");
    // Stdout has the data, not Done
    expect(r.stdout).not.toContain("Done");
    expect(r.exitCode).toBe(0);
  });
});

// ─── SEQUENTIAL: BASIC ───────────────────────────────────────────────────────

describe.concurrent("sequential: basic", () => {
  test("runs scripts in order", async () => {
    using dir = tempDir("mr-seq-order", {
      "package.json": JSON.stringify({
        scripts: {
          first: `echo first-output`,
          second: `echo second-output`,
          third: `echo third-output`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "first", "second", "third"], String(dir));
    expectPrefixed(r.stdout, "first", "first-output");
    expectPrefixed(r.stdout, "second", "second-output");
    expectPrefixed(r.stdout, "third", "third-output");
    const i1 = r.stdout.search(/first\s+\|.*first-output/);
    const i2 = r.stdout.search(/second\s+\|.*second-output/);
    const i3 = r.stdout.search(/third\s+\|.*third-output/);
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(-1);
    expect(i3).toBeGreaterThan(-1);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    expect(r.exitCode).toBe(0);
  });

  test("sequential with single script", async () => {
    using dir = tempDir("mr-seq-single", {
      "package.json": JSON.stringify({
        scripts: { only: `echo seq-single` },
      }),
    });
    const r = await runMulti(["run", "--sequential", "only"], String(dir));
    expectPrefixed(r.stdout, "only", "seq-single");
    expectDone(r.stderr, "only");
    expect(r.exitCode).toBe(0);
  });

  test("sequential stops on first failure", async () => {
    using dir = tempDir("mr-seq-stop", {
      "package.json": JSON.stringify({
        scripts: {
          fail: `exit 1`,
          never: `echo should-not-run`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "fail", "never"], String(dir));
    expectExited(r.stderr, "fail", 1);
    expect(r.stdout).not.toContain("should-not-run");
    expect(r.exitCode).not.toBe(0);
  });

  test("sequential propagates exit code from failed script", async () => {
    using dir = tempDir("mr-seq-code", {
      "package.json": JSON.stringify({
        scripts: {
          ok: `echo ok`,
          bad: `exit 13`,
          never: `echo nope`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "ok", "bad", "never"], String(dir));
    expectPrefixed(r.stdout, "ok", "ok");
    expectExited(r.stderr, "bad", 13);
    expect(r.stdout).not.toContain("nope");
    expect(r.exitCode).toBe(13);
  });

  test("sequential --no-exit-on-error continues after failure", async () => {
    using dir = tempDir("mr-seq-noexit", {
      "package.json": JSON.stringify({
        scripts: {
          fail: `exit 2`,
          after: `echo ran-after`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "--no-exit-on-error", "fail", "after"], String(dir));
    expectExited(r.stderr, "fail", 2);
    expectPrefixed(r.stdout, "after", "ran-after");
    expect(r.exitCode).not.toBe(0);
  });

  test("sequential file scripts run in order", async () => {
    using dir = tempDir("mr-seq-files", {
      "first.ts": "console.log('wrote');",
      "second.ts": "console.log('second-ran');",
    });
    const r = await runMulti(["run", "--sequential", "./first.ts", "./second.ts"], String(dir));
    expectPrefixed(r.stdout, "./first.ts", "wrote");
    expectPrefixed(r.stdout, "./second.ts", "second-ran");
    expect(r.exitCode).toBe(0);
  });
});

// ─── PRE/POST SCRIPTS ────────────────────────────────────────────────────────

describe.concurrent("pre/post scripts", () => {
  test("runs pre, main, post in order", async () => {
    using dir = tempDir("mr-prepost-order", {
      "package.json": JSON.stringify({
        scripts: {
          prebuild: `echo pre-ran`,
          build: `echo build-ran`,
          postbuild: `echo post-ran`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "build"], String(dir));
    expectPrefixed(r.stdout, "build", "pre-ran");
    expectPrefixed(r.stdout, "build", "build-ran");
    expectPrefixed(r.stdout, "build", "post-ran");
    const preIdx = r.stdout.search(/build\s+\|.*pre-ran/);
    const buildIdx = r.stdout.search(/build\s+\|.*build-ran/);
    const postIdx = r.stdout.search(/build\s+\|.*post-ran/);
    expect(preIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(postIdx).toBeGreaterThan(-1);
    expect(preIdx).toBeLessThan(buildIdx);
    expect(buildIdx).toBeLessThan(postIdx);
    expect(r.exitCode).toBe(0);
  });

  test("only pre script (no post)", async () => {
    using dir = tempDir("mr-preonly", {
      "package.json": JSON.stringify({
        scripts: {
          pretest: `echo pre-only`,
          test: `echo test-main`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "test"], String(dir));
    expectPrefixed(r.stdout, "test", "pre-only");
    expectPrefixed(r.stdout, "test", "test-main");
    const preIdx = r.stdout.search(/test\s+\|.*pre-only/);
    const mainIdx = r.stdout.search(/test\s+\|.*test-main/);
    expect(preIdx).toBeGreaterThan(-1);
    expect(mainIdx).toBeGreaterThan(-1);
    expect(preIdx).toBeLessThan(mainIdx);
    expect(r.exitCode).toBe(0);
  });

  test("only post script (no pre)", async () => {
    using dir = tempDir("mr-postonly", {
      "package.json": JSON.stringify({
        scripts: {
          deploy: `echo deploy-main`,
          postdeploy: `echo post-only`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "deploy"], String(dir));
    expectPrefixed(r.stdout, "deploy", "deploy-main");
    expectPrefixed(r.stdout, "deploy", "post-only");
    expect(r.exitCode).toBe(0);
  });

  test("pre failure prevents main and post from running", async () => {
    using dir = tempDir("mr-prefail", {
      "package.json": JSON.stringify({
        scripts: {
          prebuild: `exit 1`,
          build: `echo main-shouldnt-run`,
          postbuild: `echo post-shouldnt-run`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "build"], String(dir));
    expectExited(r.stderr, "build", 1);
    expect(r.stdout).not.toContain("main-shouldnt-run");
    expect(r.stdout).not.toContain("post-shouldnt-run");
    expect(r.exitCode).not.toBe(0);
  });

  test("main failure prevents post from running", async () => {
    using dir = tempDir("mr-mainfail", {
      "package.json": JSON.stringify({
        scripts: {
          prebuild: `echo pre-ok`,
          build: `exit 1`,
          postbuild: `echo post-shouldnt-run`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "build"], String(dir));
    expectPrefixed(r.stdout, "build", "pre-ok");
    expectExited(r.stderr, "build", 1);
    expect(r.stdout).not.toContain("post-shouldnt-run");
    expect(r.exitCode).not.toBe(0);
  });

  test("parallel: pre/post chained per group, groups run concurrently", async () => {
    using dir = tempDir("mr-prepost-par", {
      "package.json": JSON.stringify({
        scripts: {
          prebuild: `echo pre-build`,
          build: `echo main-build`,
          postbuild: `echo post-build`,
          pretest: `echo pre-test`,
          test: `echo main-test`,
          posttest: `echo post-test`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "build", "test"], String(dir));
    for (const s of ["pre-build", "main-build", "post-build", "pre-test", "main-test", "post-test"]) {
      expectPrefixed(r.stdout, s.includes("build") ? "build" : "test", s);
    }
    // Within each group, order must be preserved
    const findPrefixed = (label: string, content: string) => {
      const re = new RegExp(`^${escapeRe(label)}\\s+\\| .*${escapeRe(content)}`, "m");
      const m = r.stdout.match(re);
      return m ? r.stdout.indexOf(m[0]) : -1;
    };
    expect(findPrefixed("build", "pre-build")).toBeLessThan(findPrefixed("build", "main-build"));
    expect(findPrefixed("build", "main-build")).toBeLessThan(findPrefixed("build", "post-build"));
    expect(findPrefixed("test", "pre-test")).toBeLessThan(findPrefixed("test", "main-test"));
    expect(findPrefixed("test", "main-test")).toBeLessThan(findPrefixed("test", "post-test"));
    expect(r.exitCode).toBe(0);
  });

  test("sequential: pre/post chained and groups run in order", async () => {
    using dir = tempDir("mr-prepost-seq", {
      "package.json": JSON.stringify({
        scripts: {
          prebuild: `echo pre-b`,
          build: `echo main-b`,
          postbuild: `echo post-b`,
          pretest: `echo pre-t`,
          test: `echo main-t`,
          posttest: `echo post-t`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "build", "test"], String(dir));
    for (const s of ["pre-b", "main-b", "post-b", "pre-t", "main-t", "post-t"]) {
      expectPrefixed(r.stdout, s.includes("-b") ? "build" : "test", s);
    }
    // Full sequential ordering (check in stdout)
    const ordered = ["pre-b", "main-b", "post-b", "pre-t", "main-t", "post-t"];
    const indices = ordered.map(s => r.stdout.indexOf(s));
    for (let i = 0; i < indices.length - 1; i++) {
      expect(indices[i]).toBeLessThan(indices[i + 1]);
    }
    expect(r.exitCode).toBe(0);
  });

  test("all pre/post handles share the same label", async () => {
    using dir = tempDir("mr-prepost-label", {
      "package.json": JSON.stringify({
        scripts: {
          prebuild: `echo p`,
          build: `echo m`,
          postbuild: `echo o`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "build"], String(dir));
    expectPrefixed(r.stdout, "build", "p");
    expectPrefixed(r.stdout, "build", "m");
    expectPrefixed(r.stdout, "build", "o");
    // No other label should appear in stdout
    const prefixedLines = r.stdout.split("\n").filter(l => l.includes(" | "));
    for (const line of prefixedLines) {
      expect(line).toMatch(/^build\s+\|/);
    }
    expect(r.exitCode).toBe(0);
  });
});

// ─── VALIDATION & ERROR MESSAGES ──────────────────────────────────────────────

describe.concurrent("validation", () => {
  test("error when both --parallel and --sequential", async () => {
    using dir = tempDir("mr-val-both", {
      "package.json": JSON.stringify({ scripts: { a: "echo a" } }),
    });
    const r = await runMulti(["run", "--parallel", "--sequential", "a"], String(dir));
    expect(r.stderr).toContain("--parallel and --sequential cannot be used together");
    expect(r.exitCode).not.toBe(0);
  });

  test("error when no script names with --parallel", async () => {
    using dir = tempDir("mr-val-nonames-par", {
      "package.json": JSON.stringify({ scripts: {} }),
    });
    const r = await runMulti(["run", "--parallel"], String(dir));
    expect(r.stderr).toContain("--parallel/--sequential requires at least one script name");
    expect(r.exitCode).not.toBe(0);
  });

  test("error when no script names with --sequential", async () => {
    using dir = tempDir("mr-val-nonames-seq", {
      "package.json": JSON.stringify({ scripts: {} }),
    });
    const r = await runMulti(["run", "--sequential"], String(dir));
    expect(r.stderr).toContain("--parallel/--sequential requires at least one script name");
    expect(r.exitCode).not.toBe(0);
  });

  test("raw commands work without package.json", async () => {
    using dir = tempDir("mr-val-nopkg", {});
    const r = await runMulti(["run", "--parallel", "echo no-pkg-works"], String(dir));
    expectPrefixed(r.stdout, "echo no-pkg-works", "no-pkg-works");
    expect(r.exitCode).toBe(0);
  });
});

// ─── MIXED STDOUT / STDERR ────────────────────────────────────────────────────

describe.concurrent("output streams", () => {
  test("captures both stdout and stderr", async () => {
    using dir = tempDir("mr-streams", {
      "package.json": JSON.stringify({
        scripts: {
          both: `${bunExe()} -e "console.log('out'); console.error('err')"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "both"], String(dir));
    expectPrefixed(r.stdout, "both", "out");
    expectPrefixed(r.stderr, "both", "err");
    expectDone(r.stderr, "both");
    expect(r.exitCode).toBe(0);
  });

  test("script that produces only stderr output", async () => {
    using dir = tempDir("mr-stderr-only", {
      "package.json": JSON.stringify({
        scripts: {
          erronly: `${bunExe()} -e "console.error('only-err')"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "erronly"], String(dir));
    expectPrefixed(r.stderr, "erronly", "only-err");
    expectDone(r.stderr, "erronly");
    expect(r.exitCode).toBe(0);
  });
});

// ─── SCRIPTS WITH SHELL FEATURES ──────────────────────────────────────────────

describe.concurrent("shell features", () => {
  test("scripts with pipes work", async () => {
    using dir = tempDir("mr-shell-pipe", {
      "package.json": JSON.stringify({
        scripts: {
          piped: `echo "hello world" | cat`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "piped"], String(dir));
    expectPrefixed(r.stdout, "piped", "hello world");
    expect(r.exitCode).toBe(0);
  });

  test("scripts with environment variables work", async () => {
    using dir = tempDir("mr-shell-env", {
      "package.json": JSON.stringify({
        scripts: {
          env: `${bunExe()} -e "console.log(process.env.MY_VAR)"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "env"], String(dir), { MY_VAR: "test-value" });
    expectPrefixed(r.stdout, "env", "test-value");
    expect(r.exitCode).toBe(0);
  });

  test("scripts with semicolons work", async () => {
    using dir = tempDir("mr-shell-semi", {
      "package.json": JSON.stringify({
        scripts: {
          multi: `echo first; echo second`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "multi"], String(dir));
    expectPrefixed(r.stdout, "multi", "first");
    expectPrefixed(r.stdout, "multi", "second");
    expect(r.exitCode).toBe(0);
  });

  test("scripts with && work", async () => {
    using dir = tempDir("mr-shell-and", {
      "package.json": JSON.stringify({
        scripts: {
          chained: `echo step1 && echo step2`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "chained"], String(dir));
    expectPrefixed(r.stdout, "chained", "step1");
    expectPrefixed(r.stdout, "chained", "step2");
    expect(r.exitCode).toBe(0);
  });
});

// ─── SCRIPT NAMES WITH SPECIAL CHARACTERS ─────────────────────────────────────

describe.concurrent("script name edge cases", () => {
  test("script names with colons", async () => {
    using dir = tempDir("mr-colon", {
      "package.json": JSON.stringify({
        scripts: {
          "dev:server": `echo server`,
          "dev:client": `echo client`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "dev:server", "dev:client"], String(dir));
    expectPrefixed(r.stdout, "dev:server", "server");
    expectPrefixed(r.stdout, "dev:client", "client");
    expect(r.exitCode).toBe(0);
  });

  test("script names with hyphens", async () => {
    using dir = tempDir("mr-hyphen", {
      "package.json": JSON.stringify({
        scripts: {
          "build-prod": `echo prod`,
          "build-dev": `echo dev`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "build-prod", "build-dev"], String(dir));
    expectPrefixed(r.stdout, "build-prod", "prod");
    expectPrefixed(r.stdout, "build-dev", "dev");
    expect(r.exitCode).toBe(0);
  });

  test("duplicate script names run the script multiple times", async () => {
    using dir = tempDir("mr-dup", {
      "package.json": JSON.stringify({
        scripts: {
          greet: `echo hello`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "greet", "greet"], String(dir));
    // Both instances should produce prefixed output -- count "Done" lines in stderr
    const doneLines = r.stderr.split("\n").filter(l => /^greet\s+\| Done/.test(l));
    expect(doneLines.length).toBe(2);
    expect(r.exitCode).toBe(0);
  });
});

// ─── RAPID EXIT / TIMING ─────────────────────────────────────────────────────

describe.concurrent("timing edge cases", () => {
  test("scripts that exit immediately", async () => {
    using dir = tempDir("mr-instant", {
      "package.json": JSON.stringify({
        scripts: {
          a: `exit 0`,
          b: `exit 0`,
          c: `exit 0`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "a", "b", "c"], String(dir));
    expectDone(r.stderr, "a");
    expectDone(r.stderr, "b");
    expectDone(r.stderr, "c");
    expect(r.exitCode).toBe(0);
  });

  test("sequential: rapid scripts complete in order", async () => {
    using dir = tempDir("mr-seq-rapid", {
      "package.json": JSON.stringify({
        scripts: {
          a: `echo rapid-a`,
          b: `echo rapid-b`,
          c: `echo rapid-c`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "a", "b", "c"], String(dir));
    expectPrefixed(r.stdout, "a", "rapid-a");
    expectPrefixed(r.stdout, "b", "rapid-b");
    expectPrefixed(r.stdout, "c", "rapid-c");
    const ia = r.stdout.indexOf("rapid-a");
    const ib = r.stdout.indexOf("rapid-b");
    const ic = r.stdout.indexOf("rapid-c");
    expect(ia).toBeLessThan(ib);
    expect(ib).toBeLessThan(ic);
    expect(r.exitCode).toBe(0);
  });
});

// ─── EXIT CODE PROPAGATION ───────────────────────────────────────────────────

describe.concurrent("exit code propagation", () => {
  test("parallel: first handle with non-zero code wins", async () => {
    using dir = tempDir("mr-exitprop", {
      "package.json": JSON.stringify({
        scripts: {
          a: `exit 0`,
          b: `exit 99`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "--no-exit-on-error", "a", "b"], String(dir));
    expectDone(r.stderr, "a");
    expectExited(r.stderr, "b", 99);
    expect(r.exitCode).toBe(99);
  });

  test("all zero means exit 0", async () => {
    using dir = tempDir("mr-allzero", {
      "package.json": JSON.stringify({
        scripts: {
          a: `exit 0`,
          b: `exit 0`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "a", "b"], String(dir));
    expectDone(r.stderr, "a");
    expectDone(r.stderr, "b");
    expect(r.exitCode).toBe(0);
  });

  test("sequential: exit code of the failed script", async () => {
    using dir = tempDir("mr-seq-exitcode", {
      "package.json": JSON.stringify({
        scripts: {
          ok: `exit 0`,
          bad: `exit 77`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "ok", "bad"], String(dir));
    expectDone(r.stderr, "ok");
    expectExited(r.stderr, "bad", 77);
    expect(r.exitCode).toBe(77);
  });
});

// ─── CWD / WORKING DIRECTORY ────────────────────────────────────────────────

describe.concurrent("working directory", () => {
  test("scripts run in the package.json directory", async () => {
    using dir = tempDir("mr-cwd", {
      "package.json": JSON.stringify({
        scripts: {
          pwd: `${bunExe()} -e "console.log(process.cwd())"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "pwd"], String(dir));
    const realDir = realpathSync(String(dir));
    // On Windows, process.cwd() returns backslash paths; normalize for comparison
    const lines = r.stdout.split("\n").filter(l => /pwd\s+\|/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    const cwdOutput = lines[0].split(" | ").slice(1).join(" | ").trim();
    expect(path.normalize(cwdOutput)).toBe(path.normalize(realDir));
    expect(r.exitCode).toBe(0);
  });
});

// ─── EXPLICIT RUN COMMAND ───────────────────────────────────────────────────

describe.concurrent("explicit run command", () => {
  test("'bun run --parallel' with run keyword", async () => {
    using dir = tempDir("mr-run-explicit", {
      "package.json": JSON.stringify({
        scripts: {
          x: `echo explicit-run`,
          y: `echo explicit-run2`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "x", "y"], String(dir));
    expectPrefixed(r.stdout, "x", "explicit-run");
    expectPrefixed(r.stdout, "y", "explicit-run2");
    expect(r.exitCode).toBe(0);
  });
});

// ─── LARGE OUTPUT / STRESS ──────────────────────────────────────────────────

describe.concurrent("stress tests", () => {
  test("handles large number of output lines", async () => {
    using dir = tempDir("mr-stress-lines", {
      "package.json": JSON.stringify({
        scripts: {
          flood: `${bunExe()} -e "for(let i=0;i<500;i++) console.log('line-'+i)"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "flood"], String(dir));
    expectPrefixed(r.stdout, "flood", "line-0");
    expectPrefixed(r.stdout, "flood", "line-499");
    expect(r.exitCode).toBe(0);
  });

  test("handles output from multiple concurrent scripts", async () => {
    const scripts: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      scripts[`s${i}`] = `${bunExe()} -e "for(let j=0;j<50;j++) console.log('s${i}-'+j)"`;
    }
    using dir = tempDir("mr-stress-multi", {
      "package.json": JSON.stringify({ scripts }),
    });
    const r = await runMulti(["run", "--parallel", "s0", "s1", "s2", "s3", "s4"], String(dir));
    for (let i = 0; i < 5; i++) {
      expectPrefixed(r.stdout, `s${i}`, `s${i}-0`);
      expectPrefixed(r.stdout, `s${i}`, `s${i}-49`);
    }
    expect(r.exitCode).toBe(0);
  });
});

// ─── RAW COMMANDS (NOT IN PACKAGE.JSON) ─────────────────────────────────────

describe.concurrent("raw shell commands", () => {
  test("runs raw command not in package.json", async () => {
    using dir = tempDir("mr-raw", {
      "package.json": JSON.stringify({ scripts: {} }),
    });
    const r = await runMulti(["run", "--parallel", "echo raw-command-test"], String(dir));
    expectPrefixed(r.stdout, "echo raw-command-test", "raw-command-test");
    expect(r.exitCode).toBe(0);
  });

  test("runs multiple raw commands", async () => {
    using dir = tempDir("mr-raw-multi", {
      "package.json": JSON.stringify({ scripts: {} }),
    });
    const r = await runMulti(["run", "--parallel", "echo first-raw", "echo second-raw"], String(dir));
    expectPrefixed(r.stdout, "echo first-raw", "first-raw");
    expectPrefixed(r.stdout, "echo second-raw", "second-raw");
    expect(r.exitCode).toBe(0);
  });

  test("mixes raw commands and package.json scripts", async () => {
    using dir = tempDir("mr-raw-mix", {
      "package.json": JSON.stringify({
        scripts: {
          pkg: `echo from-pkg`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "pkg", "echo from-raw"], String(dir));
    expectPrefixed(r.stdout, "pkg", "from-pkg");
    expectPrefixed(r.stdout, "echo from-raw", "from-raw");
    expect(r.exitCode).toBe(0);
  });
});

// ─── SEQUENTIAL: SIDE EFFECTS ORDERING ──────────────────────────────────────

describe.concurrent("sequential: side effects ordering", () => {
  test("later scripts can see files created by earlier scripts", async () => {
    using dir = tempDir("mr-seq-sideeffect", {
      "package.json": JSON.stringify({
        scripts: {
          create: `${bunExe()} -e "require('fs').writeFileSync('marker.txt', 'created'); console.log('created')"`,
          check: `${bunExe()} -e "const d = require('fs').readFileSync('marker.txt','utf8'); console.log('found:'+d)"`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "create", "check"], String(dir));
    expectPrefixed(r.stdout, "create", "created");
    expectPrefixed(r.stdout, "check", "found:created");
    expect(r.exitCode).toBe(0);
  });
});

// ─── NO PACKAGE.JSON ────────────────────────────────────────────────────────

describe.concurrent("no package.json", () => {
  test("file scripts work without package.json", async () => {
    using dir = tempDir("mr-nopkg-files", {
      "hello.ts": "console.log('no-pkg-hello')",
    });
    const r = await runMulti(["run", "--parallel", "./hello.ts"], String(dir));
    expectPrefixed(r.stdout, "./hello.ts", "no-pkg-hello");
    expect(r.exitCode).toBe(0);
  });

  test("raw commands work without package.json", async () => {
    using dir = tempDir("mr-nopkg-raw", {});
    const r = await runMulti(["run", "--parallel", "echo no-pkg-raw"], String(dir));
    expectPrefixed(r.stdout, "echo no-pkg-raw", "no-pkg-raw");
    expect(r.exitCode).toBe(0);
  });
});

// ─── ABORT / SIGNAL HANDLING ────────────────────────────────────────────────

describe("abort: failure kills long-running processes", () => {
  test("parallel: fast failure kills a slow script", async () => {
    using dir = tempDir("mr-abort-slow", {
      "package.json": JSON.stringify({
        scripts: {
          slow: `${bunExe()} -e "await Bun.sleep(30000); console.log('should-not-appear')"`,
          fail: `exit 1`,
        },
      }),
    });
    const start = Date.now();
    const r = await runMulti(["run", "--parallel", "slow", "fail"], String(dir));
    const elapsed = Date.now() - start;
    expectExited(r.stderr, "fail", 1);
    expect(r.stdout).not.toContain("should-not-appear");
    expect(r.exitCode).not.toBe(0);
    expect(elapsed).toBeLessThan(15000);
  });

  test.skipIf(isWindows)("parallel: signaled process shows Signaled message", async () => {
    using dir = tempDir("mr-abort-signal", {
      "package.json": JSON.stringify({
        scripts: {
          suicide: `${bunExe()} -e "process.kill(process.pid, 'SIGKILL')"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "suicide"], String(dir));
    expect(r.stderr).toMatch(/suicide\s+\| Signaled/);
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── PARTIAL LINE BUFFERING ─────────────────────────────────────────────────

describe.concurrent("partial line buffering", () => {
  test("chunked writes are assembled into complete lines", async () => {
    using dir = tempDir("mr-chunk", {
      "package.json": JSON.stringify({
        scripts: {
          chunky: `${bunExe()} -e "
            const chars = 'CHUNKED-LINE\\n';
            for (const c of chars) {
              process.stdout.write(c);
            }
          "`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "chunky"], String(dir));
    expectPrefixed(r.stdout, "chunky", "CHUNKED-LINE");
    expectDone(r.stderr, "chunky");
    expect(r.exitCode).toBe(0);
  });

  test("multiple partial writes coalesce into one line", async () => {
    using dir = tempDir("mr-partial-coalesce", {
      "package.json": JSON.stringify({
        scripts: {
          parts: `${bunExe()} -e "
            process.stdout.write('part1-');
            process.stdout.write('part2-');
            process.stdout.write('part3\\n');
          "`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "parts"], String(dir));
    expectPrefixed(r.stdout, "parts", "part1-part2-part3");
    expect(r.exitCode).toBe(0);
  });

  test("mixed complete and partial lines", async () => {
    using dir = tempDir("mr-partial-mixed", {
      "package.json": JSON.stringify({
        scripts: {
          mixed: `${bunExe()} -e "
            process.stdout.write('complete-line\\npartial');
            process.stdout.write('-rest\\n');
          "`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "mixed"], String(dir));
    expectPrefixed(r.stdout, "mixed", "complete-line");
    expectPrefixed(r.stdout, "mixed", "partial-rest");
    expect(r.exitCode).toBe(0);
  });

  test("output with only carriage returns (no newline)", async () => {
    using dir = tempDir("mr-cr", {
      "package.json": JSON.stringify({
        scripts: {
          cr: `${bunExe()} -e "process.stdout.write('before\\\\rafter')"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "cr"], String(dir));
    // \r is not \n, so it stays in the line buffer and gets flushed on exit
    expectPrefixed(r.stdout, "cr", "before");
    expectDone(r.stderr, "cr");
    expect(r.exitCode).toBe(0);
  });

  test("empty lines are preserved", async () => {
    using dir = tempDir("mr-emptylines", {
      "package.json": JSON.stringify({
        scripts: {
          blanks: `${bunExe()} -e "console.log('above'); console.log(''); console.log('below')"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "blanks"], String(dir));
    expectPrefixed(r.stdout, "blanks", "above");
    expectPrefixed(r.stdout, "blanks", "below");
    // The empty line should also be prefixed (in stdout)
    expect(r.stdout).toMatch(/blanks\s+\| \n/);
    expectDone(r.stderr, "blanks");
    expect(r.exitCode).toBe(0);
  });
});

// ─── MULTIPLE FAILURES WITH --no-exit-on-error ──────────────────────────────

describe.concurrent("--no-exit-on-error: multiple failures", () => {
  test("parallel: first handle's non-zero code wins in finalize", async () => {
    using dir = tempDir("mr-noexit-multi", {
      "package.json": JSON.stringify({
        scripts: {
          a: `exit 11`,
          b: `exit 22`,
          c: `exit 0`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "--no-exit-on-error", "a", "b", "c"], String(dir));
    expectExited(r.stderr, "a", 11);
    expectExited(r.stderr, "b", 22);
    expectDone(r.stderr, "c");
    expect(r.exitCode).toBe(11);
  });

  test("parallel: all fail, first code wins", async () => {
    using dir = tempDir("mr-noexit-allfail", {
      "package.json": JSON.stringify({
        scripts: {
          x: `exit 5`,
          y: `exit 10`,
          z: `exit 15`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "--no-exit-on-error", "x", "y", "z"], String(dir));
    expectExited(r.stderr, "x", 5);
    expectExited(r.stderr, "y", 10);
    expectExited(r.stderr, "z", 15);
    expect(r.exitCode).toBe(5);
  });

  test("sequential: --no-exit-on-error continues through multiple failures", async () => {
    using dir = tempDir("mr-seq-noexit-multi", {
      "package.json": JSON.stringify({
        scripts: {
          a: `echo a-ran && exit 3`,
          b: `echo b-ran && exit 7`,
          c: `echo c-ran`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "--no-exit-on-error", "a", "b", "c"], String(dir));
    expectPrefixed(r.stdout, "a", "a-ran");
    expectPrefixed(r.stdout, "b", "b-ran");
    expectPrefixed(r.stdout, "c", "c-ran");
    expect(r.exitCode).toBe(3);
  });
});

// ─── PRE/POST + --no-exit-on-error INTERACTION ──────────────────────────────

describe.concurrent("pre/post + --no-exit-on-error interaction", () => {
  test("pre failure blocks own group but other groups continue", async () => {
    using dir = tempDir("mr-pre-noexit", {
      "package.json": JSON.stringify({
        scripts: {
          prebuild: `exit 1`,
          build: `echo build-main`,
          postbuild: `echo build-post`,
          lint: `echo lint-ran`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "--no-exit-on-error", "build", "lint"], String(dir));
    expectPrefixed(r.stdout, "lint", "lint-ran");
    expect(r.stdout).not.toContain("build-main");
    expect(r.stdout).not.toContain("build-post");
    expect(r.exitCode).not.toBe(0);
  });

  test("post script failure is reported correctly", async () => {
    using dir = tempDir("mr-postfail", {
      "package.json": JSON.stringify({
        scripts: {
          build: `echo build-ok`,
          postbuild: `echo post-fail && exit 44`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "build"], String(dir));
    expectPrefixed(r.stdout, "build", "build-ok");
    expectPrefixed(r.stdout, "build", "post-fail");
    expectExited(r.stderr, "build", 44);
    expect(r.exitCode).toBe(44);
  });

  test("sequential: pre failure with --no-exit-on-error still runs next group", async () => {
    using dir = tempDir("mr-seq-pre-noexit", {
      "package.json": JSON.stringify({
        scripts: {
          prebuild: `exit 1`,
          build: `echo build-shouldnt`,
          test: `echo test-ran`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "--no-exit-on-error", "build", "test"], String(dir));
    expect(r.stdout).not.toContain("build-shouldnt");
    expectPrefixed(r.stdout, "test", "test-ran");
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── EMPTY / EDGE-CASE SCRIPT CONTENT ───────────────────────────────────────

describe.concurrent("edge-case script content", () => {
  test("empty script string runs without crashing", async () => {
    using dir = tempDir("mr-empty-script", {
      "package.json": JSON.stringify({
        scripts: {
          empty: "",
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "empty"], String(dir));
    // Multi-run prefix must appear in stderr (status line)
    expect(r.stderr).toMatch(/empty\s+\|/);
  });

  test("script that only writes whitespace", async () => {
    using dir = tempDir("mr-whitespace", {
      "package.json": JSON.stringify({
        scripts: {
          ws: `${bunExe()} -e "console.log('   ')"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "ws"], String(dir));
    expectPrefixed(r.stdout, "ws", "   ");
    expectDone(r.stderr, "ws");
    expect(r.exitCode).toBe(0);
  });

  test("script with very long name", async () => {
    const longName = Buffer.alloc(80, "x").toString();
    using dir = tempDir("mr-longname", {
      "package.json": JSON.stringify({
        scripts: {
          [longName]: `echo long-name-ok`,
          short: `echo short-ok`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", longName, "short"], String(dir));
    expectPrefixed(r.stdout, longName, "long-name-ok");
    expectPrefixed(r.stdout, "short", "short-ok");
    // "short" should be padded to match the long name
    const lines = r.stdout.split("\n").filter(l => l.includes("| short-ok"));
    expect(lines.length).toBeGreaterThan(0);
    const prefix = lines[0].split(" | ")[0];
    expect(prefix.length).toBe(longName.length);
    expect(r.exitCode).toBe(0);
  });
});

// ─── BINARY / UNUSUAL OUTPUT ────────────────────────────────────────────────

describe.concurrent("unusual output", () => {
  test("null bytes in output don't crash", async () => {
    using dir = tempDir("mr-nullbyte", {
      "package.json": JSON.stringify({
        scripts: {
          nulls: `${bunExe()} -e "process.stdout.write(Buffer.from([0x68, 0x69, 0x00, 0x0a]))"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "nulls"], String(dir));
    expectDone(r.stderr, "nulls");
    expect(r.exitCode).toBe(0);
  });

  test("very rapid line output doesn't lose data", async () => {
    using dir = tempDir("mr-rapid-lines", {
      "package.json": JSON.stringify({
        scripts: {
          rapid: `${bunExe()} -e "for(let i=0;i<1000;i++) console.log('L'+i)"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "rapid"], String(dir));
    expectPrefixed(r.stdout, "rapid", "L0");
    expectPrefixed(r.stdout, "rapid", "L999");
    const dataLines = r.stdout.split("\n").filter(l => /rapid\s+\| L\d+/.test(l));
    expect(dataLines.length).toBe(1000);
    expect(r.exitCode).toBe(0);
  });

  test("output with unicode characters", async () => {
    using dir = tempDir("mr-unicode", {
      "package.json": JSON.stringify({
        scripts: {
          uni: `${bunExe()} -e "console.log('Hello \\u4e16\\u754c \\ud83c\\udf0d')"`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "uni"], String(dir));
    expectPrefixed(r.stdout, "uni", "Hello \u4e16\u754c");
    expectDone(r.stderr, "uni");
    expect(r.exitCode).toBe(0);
  });
});

// ─── SEQUENTIAL: DONE STATUS BETWEEN SCRIPTS ───────────────────────────────

describe.concurrent("sequential: status messages between scripts", () => {
  test("Done message appears between sequential scripts", async () => {
    using dir = tempDir("mr-seq-done-between", {
      "package.json": JSON.stringify({
        scripts: {
          first: `echo first-out`,
          second: `echo second-out`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "first", "second"], String(dir));
    expectPrefixed(r.stdout, "first", "first-out");
    expectPrefixed(r.stdout, "second", "second-out");
    // Done for first appears in stderr, output ordering in stdout shows correct order
    expectDone(r.stderr, "first");
    const firstIdx = r.stdout.indexOf("first-out");
    const secondIdx = r.stdout.indexOf("second-out");
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(-1);
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(r.exitCode).toBe(0);
  });

  test("Exited message appears between sequential scripts with --no-exit-on-error", async () => {
    using dir = tempDir("mr-seq-exit-between", {
      "package.json": JSON.stringify({
        scripts: {
          fail: `exit 2`,
          next: `echo next-out`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "--no-exit-on-error", "fail", "next"], String(dir));
    expectExited(r.stderr, "fail", 2);
    expectPrefixed(r.stdout, "next", "next-out");
    expect(r.exitCode).toBe(2);
  });
});

// ─── CONCURRENT STDOUT + STDERR FROM SAME SCRIPT ───────────────────────────

describe.concurrent("concurrent stdout + stderr from same script", () => {
  test("interleaved stdout and stderr are both prefixed", async () => {
    using dir = tempDir("mr-interleave-streams", {
      "package.json": JSON.stringify({
        scripts: {
          both: `${bunExe()} -e "
            for (let i = 0; i < 10; i++) {
              console.log('OUT-' + i);
              console.error('ERR-' + i);
            }
          "`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "both"], String(dir));
    for (let i = 0; i < 10; i++) {
      expectPrefixed(r.stdout, "both", `OUT-${i}`);
      expectPrefixed(r.stderr, "both", `ERR-${i}`);
    }
    expectDone(r.stderr, "both");
    expect(r.exitCode).toBe(0);
  });
});

// ─── DEEP DEPENDENCY CHAIN ──────────────────────────────────────────────────

describe.concurrent("dependency chains", () => {
  test("sequential with pre/post creates deep chain that works", async () => {
    using dir = tempDir("mr-deep-chain", {
      "package.json": JSON.stringify({
        scripts: {
          prea: `echo pre-a`,
          a: `echo main-a`,
          posta: `echo post-a`,
          preb: `echo pre-b`,
          b: `echo main-b`,
          postb: `echo post-b`,
          prec: `echo pre-c`,
          c: `echo main-c`,
          postc: `echo post-c`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "a", "b", "c"], String(dir));
    const expected = ["pre-a", "main-a", "post-a", "pre-b", "main-b", "post-b", "pre-c", "main-c", "post-c"];
    for (const s of expected) {
      const label = s.includes("-a") ? "a" : s.includes("-b") ? "b" : "c";
      expectPrefixed(r.stdout, label, s);
    }
    const indices = expected.map(s => r.stdout.indexOf(s));
    for (let i = 0; i < indices.length - 1; i++) {
      expect(indices[i]).toBeLessThan(indices[i + 1]);
    }
    expect(r.exitCode).toBe(0);
  });

  test("parallel with pre/post: failure in one group's chain doesn't block other groups", async () => {
    using dir = tempDir("mr-chain-partial", {
      "package.json": JSON.stringify({
        scripts: {
          prea: `echo pre-a-ok`,
          a: `exit 1`,
          posta: `echo post-a-no`,
          preb: `echo pre-b-ok`,
          b: `echo main-b-ok`,
          postb: `echo post-b-ok`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "--no-exit-on-error", "a", "b"], String(dir));
    expectPrefixed(r.stdout, "a", "pre-a-ok");
    expect(r.stdout).not.toContain("post-a-no");
    expectPrefixed(r.stdout, "b", "pre-b-ok");
    expectPrefixed(r.stdout, "b", "main-b-ok");
    expectPrefixed(r.stdout, "b", "post-b-ok");
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── COLOR CYCLING ──────────────────────────────────────────────────────────

describe.concurrent("color cycling", () => {
  test("more than 6 scripts cycle through colors", async () => {
    const scripts: Record<string, string> = {};
    for (let i = 0; i < 7; i++) {
      scripts[`task${i}`] = `echo t${i}`;
    }
    using dir = tempDir("mr-color-cycle", {
      "package.json": JSON.stringify({ scripts }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--parallel", ...Object.keys(scripts)],
      env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Must contain ANSI color codes -- multi-run format (colors appear in both streams)
    expect(stderr).toContain("\x1b[");
    // All tasks should produce prefixed output (check Done lines in stderr since they're unique to multi-run)
    // ANSI color codes wrap the label, so match optionally around the label name
    for (let i = 0; i < 7; i++) {
      expect(stderr).toMatch(new RegExp(`task${i}[^\n]*\\| Done`));
    }
    // Stdout should also have prefixed content
    for (let i = 0; i < 7; i++) {
      expect(stdout).toMatch(new RegExp(`task${i}[^\n]*\\| t${i}`));
    }
    expect(exitCode).toBe(0);
  });
});

// ─── GLOB PATTERN MATCHING ──────────────────────────────────────────────────

describe.concurrent("glob pattern matching", () => {
  test("build:* matches all build:xxx scripts", async () => {
    using dir = tempDir("mr-glob-basic", {
      "package.json": JSON.stringify({
        scripts: {
          "build:css": `echo css-built`,
          "build:js": `echo js-built`,
          "build:html": `echo html-built`,
          "test": `echo should-not-run`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "build:*"], String(dir));
    expectPrefixed(r.stdout, "build:css", "css-built");
    expectPrefixed(r.stdout, "build:html", "html-built");
    expectPrefixed(r.stdout, "build:js", "js-built");
    expect(r.stdout).not.toContain("should-not-run");
    expect(r.exitCode).toBe(0);
  });

  test("* matches all scripts", async () => {
    using dir = tempDir("mr-glob-star", {
      "package.json": JSON.stringify({
        scripts: {
          alpha: `echo a-out`,
          beta: `echo b-out`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "*"], String(dir));
    expectPrefixed(r.stdout, "alpha", "a-out");
    expectPrefixed(r.stdout, "beta", "b-out");
    expect(r.exitCode).toBe(0);
  });

  test("glob with no matches errors", async () => {
    using dir = tempDir("mr-glob-nomatch", {
      "package.json": JSON.stringify({
        scripts: {
          build: `echo build`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "deploy:*"], String(dir));
    expect(r.stderr).toContain('No scripts match pattern "deploy:*"');
    expect(r.exitCode).not.toBe(0);
  });

  test("glob with pre/post scripts", async () => {
    using dir = tempDir("mr-glob-prepost", {
      "package.json": JSON.stringify({
        scripts: {
          "prebuild:css": `echo pre-css`,
          "build:css": `echo main-css`,
          "postbuild:css": `echo post-css`,
          "build:js": `echo main-js`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "build:*"], String(dir));
    expectPrefixed(r.stdout, "build:css", "pre-css");
    expectPrefixed(r.stdout, "build:css", "main-css");
    expectPrefixed(r.stdout, "build:css", "post-css");
    expectPrefixed(r.stdout, "build:js", "main-js");
    // Pre should come before main
    const preIdx = r.stdout.search(/build:css\s+\|.*pre-css/);
    const mainIdx = r.stdout.search(/build:css\s+\|.*main-css/);
    expect(preIdx).toBeLessThan(mainIdx);
    expect(r.exitCode).toBe(0);
  });

  test("sequential with glob runs matches in alphabetical order", async () => {
    using dir = tempDir("mr-glob-seq", {
      "package.json": JSON.stringify({
        scripts: {
          "lint:c": `echo lint-c`,
          "lint:a": `echo lint-a`,
          "lint:b": `echo lint-b`,
        },
      }),
    });
    const r = await runMulti(["run", "--sequential", "lint:*"], String(dir));
    expectPrefixed(r.stdout, "lint:a", "lint-a");
    expectPrefixed(r.stdout, "lint:b", "lint-b");
    expectPrefixed(r.stdout, "lint:c", "lint-c");
    // Order should be alphabetical
    const ia = r.stdout.indexOf("lint-a");
    const ib = r.stdout.indexOf("lint-b");
    const ic = r.stdout.indexOf("lint-c");
    expect(ia).toBeLessThan(ib);
    expect(ib).toBeLessThan(ic);
    expect(r.exitCode).toBe(0);
  });

  test("glob mixed with literal script names", async () => {
    using dir = tempDir("mr-glob-mixed", {
      "package.json": JSON.stringify({
        scripts: {
          "build:css": `echo css`,
          "build:js": `echo js`,
          "test": `echo test-ran`,
        },
      }),
    });
    const r = await runMulti(["run", "--parallel", "build:*", "test"], String(dir));
    expectPrefixed(r.stdout, "build:css", "css");
    expectPrefixed(r.stdout, "build:js", "js");
    expectPrefixed(r.stdout, "test", "test-ran");
    expect(r.exitCode).toBe(0);
  });
});

// ─── WORKSPACE INTEGRATION ──────────────────────────────────────────────────

/** Helper to create a monorepo workspace temp directory. */
function makeWorkspace(
  prefix: string,
  packages: Record<string, Record<string, string>>,
  rootScripts?: Record<string, string>,
) {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/*"],
      ...(rootScripts ? { scripts: rootScripts } : {}),
    }),
  };
  for (const [name, scripts] of Object.entries(packages)) {
    files[`packages/${name}/package.json`] = JSON.stringify({
      name,
      scripts,
    });
  }
  return tempDir(prefix, files);
}

describe("workspace integration", () => {
  test("--parallel --filter='*' runs script in all packages", async () => {
    using dir = makeWorkspace("mr-ws-all", {
      "pkg-a": { build: `echo a-built` },
      "pkg-b": { build: `echo b-built` },
      "pkg-c": { build: `echo c-built` },
    });
    const r = await runMulti(["run", "--parallel", "--filter", "*", "build"], String(dir));
    expectPrefixed(r.stdout, "pkg-a:build", "a-built");
    expectPrefixed(r.stdout, "pkg-b:build", "b-built");
    expectPrefixed(r.stdout, "pkg-c:build", "c-built");
    expect(r.exitCode).toBe(0);
  });

  test("--parallel --filter='pkg-a' runs only in matching package", async () => {
    using dir = makeWorkspace("mr-ws-single", {
      "pkg-a": { build: `echo a-only` },
      "pkg-b": { build: `echo b-nope` },
    });
    const r = await runMulti(["run", "--parallel", "--filter", "pkg-a", "build"], String(dir));
    expectPrefixed(r.stdout, "pkg-a:build", "a-only");
    expect(r.stdout).not.toContain("b-nope");
    expect(r.exitCode).toBe(0);
  });

  test("--parallel --workspaces matches all workspace packages", async () => {
    using dir = makeWorkspace("mr-ws-workspaces", {
      "pkg-a": { test: `echo a-test` },
      "pkg-b": { test: `echo b-test` },
    });
    const r = await runMulti(["run", "--parallel", "--workspaces", "test"], String(dir));
    expectPrefixed(r.stdout, "pkg-a:test", "a-test");
    expectPrefixed(r.stdout, "pkg-b:test", "b-test");
    expect(r.exitCode).toBe(0);
  });

  test("--parallel --filter='*' with glob expands per-package scripts", async () => {
    using dir = makeWorkspace("mr-ws-glob", {
      "pkg-a": {
        "build:css": `echo a-css`,
        "build:js": `echo a-js`,
      },
      "pkg-b": {
        "build:css": `echo b-css`,
      },
    });
    const r = await runMulti(["run", "--parallel", "--filter", "*", "build:*"], String(dir));
    expectPrefixed(r.stdout, "pkg-a:build:css", "a-css");
    expectPrefixed(r.stdout, "pkg-a:build:js", "a-js");
    expectPrefixed(r.stdout, "pkg-b:build:css", "b-css");
    expect(r.exitCode).toBe(0);
  });

  test("--sequential --filter='*' runs in sequence", async () => {
    using dir = makeWorkspace("mr-ws-seq", {
      "pkg-a": { build: `echo a-seq` },
      "pkg-b": { build: `echo b-seq` },
    });
    const r = await runMulti(["run", "--sequential", "--filter", "*", "build"], String(dir));
    expectPrefixed(r.stdout, "pkg-a:build", "a-seq");
    expectPrefixed(r.stdout, "pkg-b:build", "b-seq");
    // Verify sequential ordering
    const ia = r.stdout.search(/pkg-a:build\s+\|.*a-seq/);
    const ib = r.stdout.search(/pkg-b:build\s+\|.*b-seq/);
    expect(ia).toBeGreaterThan(-1);
    expect(ib).toBeGreaterThan(-1);
    expect(ia).toBeLessThan(ib);
    expect(r.exitCode).toBe(0);
  });

  test("workspace + failure aborts other scripts", async () => {
    using dir = makeWorkspace("mr-ws-fail", {
      "pkg-a": { build: `exit 1` },
      "pkg-b": { build: `${bunExe()} -e "await Bun.sleep(30000); console.log('should-not-appear')"` },
    });
    const start = Date.now();
    const r = await runMulti(["run", "--parallel", "--filter", "*", "build"], String(dir));
    const elapsed = Date.now() - start;
    expectExited(r.stderr, "pkg-a:build", 1);
    expect(r.stdout).not.toContain("should-not-appear");
    expect(r.exitCode).not.toBe(0);
    expect(elapsed).toBeLessThan(15000);
  });

  test("workspace + --no-exit-on-error lets all finish", async () => {
    using dir = makeWorkspace("mr-ws-noexit", {
      "pkg-a": { build: `exit 1` },
      "pkg-b": { build: `echo b-ok` },
    });
    const r = await runMulti(["run", "--parallel", "--no-exit-on-error", "--filter", "*", "build"], String(dir));
    expectExited(r.stderr, "pkg-a:build", 1);
    expectPrefixed(r.stdout, "pkg-b:build", "b-ok");
    expect(r.exitCode).not.toBe(0);
  });

  test("--workspaces skips root package", async () => {
    using dir = makeWorkspace(
      "mr-ws-skiproot",
      {
        "pkg-a": { build: `echo a-ws` },
      },
      { build: `echo root-should-not-run` },
    );
    const r = await runMulti(["run", "--parallel", "--workspaces", "build"], String(dir));
    expectPrefixed(r.stdout, "pkg-a:build", "a-ws");
    expect(r.stdout).not.toContain("root-should-not-run");
    expect(r.exitCode).toBe(0);
  });

  test("each workspace script runs in its own package directory", async () => {
    using dir = makeWorkspace("mr-ws-cwd", {
      "pkg-a": { pwd: `${bunExe()} -e "console.log(process.cwd())"` },
      "pkg-b": { pwd: `${bunExe()} -e "console.log(process.cwd())"` },
    });
    const r = await runMulti(["run", "--parallel", "--filter", "*", "pwd"], String(dir));
    // Each package should report its own directory, not the root
    const realDir = realpathSync(String(dir));
    const lines = r.stdout.split("\n").filter(l => l.includes(" | "));
    const pkgALines = lines.filter(l => /pkg-a:pwd/.test(l));
    const pkgBLines = lines.filter(l => /pkg-b:pwd/.test(l));
    expect(pkgALines.length).toBeGreaterThan(0);
    expect(pkgBLines.length).toBeGreaterThan(0);
    // Normalize paths for cross-platform comparison (Windows uses backslashes)
    const normPkgA = path.normalize(path.join(realDir, "packages", "pkg-a"));
    const normPkgB = path.normalize(path.join(realDir, "packages", "pkg-b"));
    expect(pkgALines.some(l => l.includes(normPkgA))).toBe(true);
    expect(pkgBLines.some(l => l.includes(normPkgB))).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  test("multiple script names across workspaces", async () => {
    using dir = makeWorkspace("mr-ws-multi-scripts", {
      "pkg-a": {
        build: `echo a-build`,
        test: `echo a-test`,
      },
      "pkg-b": {
        build: `echo b-build`,
        test: `echo b-test`,
      },
    });
    const r = await runMulti(["run", "--parallel", "--filter", "*", "build", "test"], String(dir));
    expectPrefixed(r.stdout, "pkg-a:build", "a-build");
    expectPrefixed(r.stdout, "pkg-a:test", "a-test");
    expectPrefixed(r.stdout, "pkg-b:build", "b-build");
    expectPrefixed(r.stdout, "pkg-b:test", "b-test");
    expect(r.exitCode).toBe(0);
  });

  test("pre/post scripts work per workspace package", async () => {
    using dir = makeWorkspace("mr-ws-prepost", {
      "pkg-a": {
        prebuild: `echo a-pre`,
        build: `echo a-main`,
        postbuild: `echo a-post`,
      },
    });
    const r = await runMulti(["run", "--parallel", "--filter", "*", "build"], String(dir));
    expectPrefixed(r.stdout, "pkg-a:build", "a-pre");
    expectPrefixed(r.stdout, "pkg-a:build", "a-main");
    expectPrefixed(r.stdout, "pkg-a:build", "a-post");
    // Order: pre -> main -> post
    const preIdx = r.stdout.search(/pkg-a:build\s+\|.*a-pre/);
    const mainIdx = r.stdout.search(/pkg-a:build\s+\|.*a-main/);
    const postIdx = r.stdout.search(/pkg-a:build\s+\|.*a-post/);
    expect(preIdx).toBeGreaterThan(-1);
    expect(mainIdx).toBeGreaterThan(-1);
    expect(postIdx).toBeGreaterThan(-1);
    expect(preIdx).toBeLessThan(mainIdx);
    expect(mainIdx).toBeLessThan(postIdx);
    expect(r.exitCode).toBe(0);
  });

  test("--filter skips packages without the script (no error)", async () => {
    using dir = makeWorkspace("mr-ws-skip-missing", {
      "pkg-a": { build: `echo a-has-it` },
      "pkg-b": { lint: `echo b-different` },
    });
    // pkg-b doesn't have 'build', should be silently skipped with --filter
    const r = await runMulti(["run", "--parallel", "--filter", "*", "build"], String(dir));
    expectPrefixed(r.stdout, "pkg-a:build", "a-has-it");
    expect(r.stdout).not.toContain("b-different");
    expect(r.exitCode).toBe(0);
  });

  test("--workspaces errors when a package is missing the script", async () => {
    using dir = makeWorkspace("mr-ws-missing-err", {
      "pkg-a": { build: `echo a-ok` },
      "pkg-b": { lint: `echo no-build` },
    });
    // --workspaces (not --filter) should error on missing script
    const r = await runMulti(["run", "--parallel", "--workspaces", "build"], String(dir));
    expect(r.stderr).toContain('Missing "build" script');
    expect(r.exitCode).not.toBe(0);
  });

  test("--workspaces --if-present skips missing scripts silently", async () => {
    using dir = makeWorkspace("mr-ws-ifpresent", {
      "pkg-a": { build: `echo a-present` },
      "pkg-b": { lint: `echo no-build` },
    });
    const r = await runMulti(["run", "--parallel", "--workspaces", "--if-present", "build"], String(dir));
    expectPrefixed(r.stdout, "pkg-a:build", "a-present");
    expect(r.stdout).not.toContain("no-build");
    expect(r.exitCode).toBe(0);
  });

  test("labels are padded correctly across workspace packages", async () => {
    using dir = makeWorkspace("mr-ws-padding", {
      "a": { build: `echo short` },
      "long-package-name": { build: `echo long` },
    });
    const r = await runMulti(["run", "--parallel", "--filter", "*", "build"], String(dir));
    const stdoutLines = r.stdout.split("\n").filter(l => l.includes(" | "));
    const shortLines = stdoutLines.filter(l => l.includes("| short"));
    const longLines = stdoutLines.filter(l => l.includes("| long"));
    expect(shortLines.length).toBeGreaterThan(0);
    expect(longLines.length).toBeGreaterThan(0);
    // Both prefixes should have the same width
    const shortPrefix = shortLines[0].split(" | ")[0];
    const longPrefix = longLines[0].split(" | ")[0];
    expect(shortPrefix.length).toBe(longPrefix.length);
    expect(r.exitCode).toBe(0);
  });

  test("package without name field uses relative path as label", async () => {
    using dir = tempDir("mr-ws-noname", {
      "package.json": JSON.stringify({
        name: "monorepo",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/my-pkg/package.json": JSON.stringify({
        // no "name" field
        scripts: { build: `echo no-name-ok` },
      }),
    });
    const r = await runMulti(["run", "--parallel", "--filter", "./packages/my-pkg", "build"], String(dir));
    // Label should use relative path "packages/my-pkg" instead of empty string
    expectPrefixed(r.stdout, "packages/my-pkg:build", "no-name-ok");
    expect(r.exitCode).toBe(0);
  });
});
