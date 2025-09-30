import { $ } from "bun";
import { expect, test, describe } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";

describe("Shell kill() - State Node Coverage", () => {
  test("kill If statement with active condition", async () => {
    const p = new $.Shell()`if sleep 10; then echo "never"; fi`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill If statement with active then branch", async () => {
    const p = new $.Shell()`if true; then sleep 10; fi`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill If statement with active else branch", async () => {
    const p = new $.Shell()`if false; then echo "skip"; else sleep 10; fi`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill If statement with active elif condition", async () => {
    const p = new $.Shell()`if false; then echo "skip"; elif sleep 10; then echo "never"; fi`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill subshell", async () => {
    const p = new $.Shell()`(sleep 10)`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill nested subshells", async () => {
    const p = new $.Shell()`(((sleep 10)))`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill binary AND during first command", async () => {
    const p = new $.Shell()`sleep 10 && echo "never"`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill binary AND during second command", async () => {
    const p = new $.Shell()`true && sleep 10`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill binary OR during first command", async () => {
    const p = new $.Shell()`sleep 10 || echo "never"`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill binary OR during second command", async () => {
    const p = new $.Shell()`false || sleep 10`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  // Background commands (&) not yet supported
  // test("kill async command with &", async () => {
  //   const p = new $.Shell()`sleep 10 &`;
  //   await Bun.sleep(50);
  //   p.kill();
  //   const r = await p;
  //   expect(r.exitCode).toBe(137);
  // });

  test("kill command substitution during expansion", async () => {
    const p = new $.Shell()`echo $(sleep 10)`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill during glob expansion", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    // Create many files to slow down glob
    for (let i = 0; i < 1000; i++) {
      writeFileSync(join(tmpDir, `file${i}.txt`), "");
    }

    const p = new $.Shell()`echo ${tmpDir}/*.txt`.cwd(tmpDir);
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });
});

describe("Shell kill() - Race Conditions", () => {
  test("kill immediately after creation", async () => {
    const p = new $.Shell()`sleep 10`;
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill during shell start", async () => {
    const p = new $.Shell()`sleep 10`;
    const promise = p.then(r => r);
    // Kill during the brief moment of startup
    p.kill();
    const r = await promise;
    expect(r.exitCode).toBe(137);
  });

  test("double kill before start", async () => {
    const p = new $.Shell()`sleep 10`;
    p.kill();
    p.kill(); // Should be no-op
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill after completion", async () => {
    const p = new $.Shell()`true`;
    const r1 = await p;
    expect(r1.exitCode).toBe(0);

    // Kill after completion should be no-op
    p.kill();

    // Result should not change
    expect(r1.exitCode).toBe(0);
  });

  test("rapid sequential kills with different signals", async () => {
    const p = new $.Shell()`sleep 10`;
    p.kill(15); // SIGTERM (first kill wins)
    p.kill(2);  // SIGINT (should be ignored - already killed)
    p.kill(9);  // SIGKILL (should be ignored - already killed)
    const r = await p;
    // Should use the first signal (SIGTERM)
    expect(r.exitCode).toBe(143);
  });

  test("kill racing with builtin completion", async () => {
    // Echo completes very quickly, try to catch race condition
    for (let i = 0; i < 10; i++) {
      const p = new $.Shell()`echo "test"`;
      const promise = p.then(r => r);
      p.kill();
      const r = await promise;
      // Either killed (137) or completed (0), but should not crash
      expect([0, 137]).toContain(r.exitCode);
    }
  });
});

describe("Shell kill() - Complex Pipelines", () => {
  test("kill 3-stage pipeline", async () => {
    const p = new $.Shell()`sleep 10 | sleep 10 | sleep 10`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill pipeline with builtins and processes", async () => {
    const p = new $.Shell()`echo "test" | cat | sleep 10`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill nested pipeline in subshell", async () => {
    const p = new $.Shell()`(sleep 10 | cat)`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill complex nested structure", async () => {
    const p = new $.Shell()`if true; then (sleep 10 | cat) && echo "never"; fi`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });
});

describe("Shell kill() - Builtin Commands", () => {
  test("kill during ls builtin", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    // Create many files
    for (let i = 0; i < 10000; i++) {
      writeFileSync(join(tmpDir, `file${i}.txt`), "");
    }

    const p = new $.Shell()`ls`.cwd(tmpDir);
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill during cat builtin", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    const bigFile = join(tmpDir, "big.txt");
    writeFileSync(bigFile, "x".repeat(1000000));

    const p = new $.Shell()`cat ${bigFile}`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });
});

describe("Shell kill() - Signal Variations", () => {
  test("kill with SIGINT (2)", async () => {
    const p = new $.Shell()`sleep 10`;
    p.kill(2);
    const r = await p;
    expect(r.exitCode).toBe(130); // 128 + 2
  });

  test("kill with SIGQUIT (3)", async () => {
    const p = new $.Shell()`sleep 10`;
    p.kill(3);
    const r = await p;
    expect(r.exitCode).toBe(131); // 128 + 3
  });

  test("kill with SIGHUP (1)", async () => {
    const p = new $.Shell()`sleep 10`;
    p.kill(1);
    const r = await p;
    expect(r.exitCode).toBe(129); // 128 + 1
  });
});

describe("Shell kill() - Resource Management", () => {
  test("kill does not leak file descriptors", async () => {
    // Create and kill many shells
    const promises = [];
    for (let i = 0; i < 50; i++) {
      const p = new $.Shell()`sleep 10 | cat | cat`;
      p.kill();
      promises.push(p);
    }

    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.exitCode).toBe(137);
    }

    // If FDs leaked, subsequent operations would fail
    const p = new $.Shell()`echo "test"`;
    const r = await p;
    expect(r.exitCode).toBe(0);
  });

  test("kill with quiet mode", async () => {
    const p = new $.Shell()`sleep 10`.quiet();
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill with environment variables", async () => {
    const p = new $.Shell()`sleep 10`.env({ TEST_VAR: "value" });
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill with custom cwd", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    const p = new $.Shell()`sleep 10`.cwd(tmpDir);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });
});

describe("Shell kill() - Stress Tests", () => {
  test("rapid kill and await cycle", async () => {
    for (let i = 0; i < 20; i++) {
      const p = new $.Shell()`sleep 10`;
      p.kill();
      const r = await p;
      expect(r.exitCode).toBe(137);
    }
  });

  test("many concurrent kills", async () => {
    const promises = Array.from({ length: 50 }, () => {
      const p = new $.Shell()`sleep 10`;
      p.kill();
      return p;
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.exitCode).toBe(137);
    }
  });

  test("kill with alternating signals", async () => {
    const signals = [9, 15, 2, 3, 1, 9, 15, 2, 3, 1];
    const promises = signals.map(sig => {
      const p = new $.Shell()`sleep 10`;
      p.kill(sig);
      return p.then(r => ({ sig, exitCode: r.exitCode }));
    });

    const results = await Promise.all(promises);
    for (const { sig, exitCode } of results) {
      expect(exitCode).toBe(128 + sig);
    }
  });
});

describe("Shell kill() - Integration with Redirects", () => {
  test("kill with stdout redirect", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    const outFile = join(tmpDir, "out.txt");
    const p = new $.Shell()`sleep 10 > ${outFile}`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill with stdin redirect", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    const inFile = join(tmpDir, "in.txt");
    writeFileSync(inFile, "test data");
    const p = new $.Shell()`sleep 10 < ${inFile}`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill with stderr redirect", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    const errFile = join(tmpDir, "err.txt");
    const p = new $.Shell()`sleep 10 2> ${errFile}`;
    await Bun.sleep(50);
    p.kill();
    const r = await p;
    expect(r.exitCode).toBe(137);
  });
});