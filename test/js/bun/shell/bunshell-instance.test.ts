import { describe, expect, test } from "bun:test";

import { $ } from "bun";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("new $.Shell() inherits process.env and throws on non-zero exit by default", async () => {
  // Run in a subprocess so other tests mutating $.env / $.throws don't interfere.
  const src = `
    import { $ } from "bun";
    const inst = new $.Shell();

    const fromDefault = (await $\`echo \$BUN_SHELL_INSTANCE_MARKER\`.quiet()).stdout.toString().trim();
    const fromFresh = (await inst\`echo \$BUN_SHELL_INSTANCE_MARKER\`.quiet()).stdout.toString().trim();

    let threwDefault, threwFresh;
    try { await $\`false\`.quiet(); } catch (e) { threwDefault = { isShellError: e instanceof $.ShellError, exitCode: e.exitCode }; }
    try { await inst\`false\`.quiet(); } catch (e) { threwFresh = { isShellError: e instanceof $.ShellError, exitCode: e.exitCode }; }

    console.log(JSON.stringify({ fromDefault, fromFresh, threwDefault, threwFresh }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: { ...bunEnv, BUN_SHELL_INSTANCE_MARKER: "hello" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    fromDefault: "hello",
    fromFresh: "hello",
    threwDefault: { isShellError: true, exitCode: 1 },
    threwFresh: { isShellError: true, exitCode: 1 },
  });
  expect(exitCode).toBe(0);
});

test("$$", async () => {
  const $$ = new $.Shell();
  $$.env({ BUN: "bun" });

  expect((await $$`echo $BUN`).stdout.toString()).toBe("bun\n");

  // should not impact the parent
  expect((await $`echo $BUN`).stdout.toString()).toBe("\n");

  $.env({ BUN: "bun2" });

  // should not impact the child
  expect((await $$`echo $BUN`).stdout.toString()).toBe("bun\n");

  expect((await $`echo $BUN`).stdout.toString()).toBe("bun2\n");
});

test("new (class extends $.Shell) returns an instance of the subclass", async () => {
  class GreetingShell extends $.Shell {
    greet(name: string) {
      return this`echo $GREETING ${name}`.text();
    }
  }

  const $$ = new GreetingShell();
  expect(Object.getPrototypeOf($$)).toBe(GreetingShell.prototype);
  expect($$).toBeInstanceOf($.Shell);

  $$.env({ GREETING: "hello" });
  expect(await $$.greet("bun")).toBe("hello bun\n");
});

test("$.text", async () => {
  expect(await $`echo hello`.text()).toBe("hello\n");
});

test("$.json", async () => {
  expect(await $`echo '{"hello": 123}'`.json()).toEqual({ hello: 123 });
});

test("$.json", async () => {
  expect(await $`echo '{"hello": 123}'`.json()).toEqual({ hello: 123 });
});

test("$.lines", async () => {
  expect(await Array.fromAsync(await $`echo hello`.lines())).toEqual(["hello"]);

  const lines: string[] = [];
  for await (const line of $`echo hello`.lines()) {
    lines.push(line);
  }

  expect(lines).toEqual(["hello"]);
});

describe.concurrent("$.lines", () => {
  /** `bun -e source`, with the environment of the test. */
  const run = (source: string) => $`${bunExe()} -e ${source}`.env(bunEnv);

  test.each([
    ["a final newline ends the last line", "a\nb\nc\n", ["a", "b", "c"]],
    ["the last line needs no newline", "a\nb\nc", ["a", "b", "c"]],
    ["no output is no lines", "", []],
    ["an empty line in the middle stays", "a\n\nb\n", ["a", "", "b"]],
    ["a newline alone is one empty line", "\n", [""]],
  ])("%s", async (_, output, expected) => {
    expect(await Array.fromAsync($`echo -n ${output}`.lines())).toEqual(expected);
  });

  test("builtins, external commands, pipelines and redirects", async () => {
    using dir = tempDir("shell-lines-matrix", {});
    const hidden = join(String(dir), "hidden.txt");
    const print = (...lines: string[]) => `console.log(${JSON.stringify(lines.join("\n"))})`;
    const both = `console.log("out"); console.error("err")`;
    const [builtin, external, mixed, pipelineTail, toFile, substitution, subshell, stderrApart, merged] =
      await Promise.all(
        [
          $`echo a; echo b`,
          run(print("x", "y")),
          $`echo first; ${bunExe()} -e ${print("second")}; echo third`.env(bunEnv),
          $`echo piped | ${bunExe()} -e ${"process.stdin.pipe(process.stdout)"}`.env(bunEnv),
          $`echo hidden > ${hidden}; echo shown`,
          $`echo pre-$(echo inner)-post`,
          $`(echo s1; echo s2)`,
          run(both),
          $`${bunExe()} -e ${both} 2>&1`.env(bunEnv),
        ].map(command => Array.fromAsync(command.lines())),
      );
    expect({
      builtin,
      external,
      mixed,
      pipelineTail,
      toFile,
      substitution,
      subshell,
      stderrApart,
      // The two streams of `2>&1` have no common order.
      merged: merged.sort(),
    }).toEqual({
      builtin: ["a", "b"],
      external: ["x", "y"],
      mixed: ["first", "second", "third"],
      pipelineTail: ["piped"],
      toFile: ["shown"],
      substitution: ["pre-inner-post"],
      subshell: ["s1", "s2"],
      stderrApart: ["out"],
      merged: ["err", "out"],
    });
    expect(await Bun.file(hidden).text()).toBe("hidden\n");
  });

  test("a carriage return before the newline stays on POSIX and is dropped on Windows", async () => {
    const lines = await Array.fromAsync(run(`process.stdout.write("a\\r\\nb\\r\\n")`).lines());
    expect(lines).toEqual(isWindows ? ["a", "b"] : ["a\r", "b\r"]);
  });

  test("an external command, then a builtin that writes more than a pipe holds", async () => {
    let count = 0;
    let last = "";
    for await (const line of $`${bunExe()} -e ${`console.log("first")`}; seq 1 30000`.env(bunEnv).lines()) {
      count++;
      last = line;
    }
    expect({ count, last }).toEqual({ count: 30001, last: "30000" });
  });

  test("cwd() in the tick of the first next() still applies", async () => {
    using dir = tempDir("shell-lines-cwd", {});
    const command = run(`console.log(process.cwd())`);
    const lines = command.lines();
    const first = lines.next();
    command.cwd(String(dir));
    expect(await first).toEqual({ value: realpathSync(String(dir)), done: false });
    expect(await lines.next()).toEqual({ value: undefined, done: true });
  });

  test("nothing runs before the first next()", async () => {
    using dir = tempDir("shell-lines-lazy", {});
    const ran = join(String(dir), "ran");
    $`echo ran > ${ran}`.lines();
    // A whole other command gives an unwanted start every chance to show.
    await $`echo done > ${join(String(dir), "other")}`;
    expect(existsSync(ran)).toBe(false);
  });

  test("text() and then next() in one tick both get the whole output", async () => {
    const command = $`echo both`;
    const text = command.text();
    const lines = command.lines();
    const first = lines.next();
    expect(await text).toBe("both\n");
    expect(await first).toEqual({ value: "both", done: false });
    expect(await lines.next()).toEqual({ value: undefined, done: true });
  });

  // Windows reads the output after the command exits (see `lines()` in src/js/builtins/shell.ts),
  // so nothing below can hold there: no line arrives early, and leaving the loop stops nothing.
  describe.skipIf(isWindows)("while the command runs", () => {
    test("a line arrives before the command exits", async () => {
      using dir = tempDir("shell-lines-early", {});
      const marker = join(String(dir), "marker");
      // Prints "a", then "b" only once `marker` exists. The test makes it when it has read "a".
      const producer = `
        const { existsSync } = require("node:fs");
        console.log("a");
        const deadline = Date.now() + 3000;
        while (!existsSync(${JSON.stringify(marker)}) && Date.now() < deadline) await Bun.sleep(5);
        console.log(existsSync(${JSON.stringify(marker)}) ? "b" : "gave-up");
      `;
      const lines: string[] = [];
      for await (const line of run(producer).lines()) {
        lines.push(line);
        if (line === "a") writeFileSync(marker, "");
      }
      expect(lines).toEqual(["a", "b"]);
    });

    test("a character split across two writes is decoded whole", async () => {
      using dir = tempDir("shell-lines-split", {});
      const marker = join(String(dir), "marker");
      // "first\n" and the first two bytes of "€", then its last byte once the test has read "first".
      const producer = `
        const { existsSync } = require("node:fs");
        process.stdout.write(Buffer.from([0x66, 0x69, 0x72, 0x73, 0x74, 0x0a, 0xe2, 0x82]));
        const deadline = Date.now() + 3000;
        while (!existsSync(${JSON.stringify(marker)}) && Date.now() < deadline) await Bun.sleep(5);
        process.stdout.write(Buffer.from([0xac, 0x0a]));
      `;
      const lines: string[] = [];
      for await (const line of run(producer).lines()) {
        lines.push(line);
        if (line === "first") writeFileSync(marker, "");
      }
      expect({ lines, sawFirstEarly: existsSync(marker) }).toEqual({ lines: ["first", "€"], sawFirstEarly: true });
    });

    test("a non-zero exit throws after the lines", async () => {
      const lines: string[] = [];
      let error: any;
      try {
        const failing = `console.log("one"); console.error("bad"); process.exit(3)`;
        const command = $`echo zero; ${bunExe()} -e ${failing}`.env(bunEnv).throws(true);
        for await (const line of command.lines()) lines.push(line);
      } catch (e) {
        error = e;
      }
      expect({
        lines,
        name: error?.name,
        exitCode: error?.exitCode,
        stdout: error?.stdout.toString(),
        stderr: error?.stderr.toString(),
      }).toEqual({ lines: ["zero", "one"], name: "ShellError", exitCode: 3, stdout: "", stderr: "bad\n" });
    });

    test("nothrow() ends the lines without a throw, and stdout is not kept", async () => {
      const command = run(`console.log("one"); console.error("bad"); process.exit(3)`).nothrow();
      expect(await Array.fromAsync(command.lines())).toEqual(["one"]);
      const { stdout, stderr, exitCode } = await command;
      expect({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode }).toEqual({
        stdout: "",
        stderr: "bad\n",
        exitCode: 3,
      });
    });

    test("a second iterator on the same command rejects", async () => {
      const command = $`echo one`;
      const first = command.lines();
      const second = command.lines();
      const [a, b] = await Promise.allSettled([first.next(), second.next()]);
      expect(a).toEqual({ status: "fulfilled", value: { value: "one", done: false } });
      expect(b).toEqual({
        status: "rejected",
        reason: expect.objectContaining({ message: "Shell is already running" }),
      });
      expect(await first.next()).toEqual({ value: undefined, done: true });
    });

    test("leaving the loop stops the command and what follows it", async () => {
      using dir = tempDir("shell-lines-break", {});
      const ran = join(String(dir), "ran");
      // Ends by itself well after the test, so a failed run leaves nothing behind.
      const idle = `console.log(process.pid); setTimeout(() => {}, 30_000)`;
      const command = $`${bunExe()} -e ${idle}; echo ran > ${ran}`.env(bunEnv).nothrow();
      let pid = 0;
      for await (const line of command.lines()) {
        pid = Number(line);
        break;
      }
      expect(pid).toBeGreaterThan(0);
      // The loop is left only when the command has stopped.
      expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
      expect(existsSync(ran)).toBe(false);
      expect((await command).exitCode).toBe(137);
    });

    test("leaving the loop ends a builtin that is still writing", async () => {
      const command = $`seq 1 200000`.nothrow();
      const lines: string[] = [];
      for await (const line of command.lines()) {
        lines.push(line);
        if (lines.length === 3) break;
      }
      expect(lines).toEqual(["1", "2", "3"]);
      // `seq` met the closed pipe. It did not run to its end.
      expect((await command).exitCode).toBe(1);
    });

    test("leaving the loop does not wait for a grandchild that holds the command's stderr", async () => {
      // The command starts a process that inherits its stdout and stderr and outlives it. Both
      // end by themselves well after the test, so a failed run leaves nothing behind.
      const parent = `
        const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30_000)"], {
          stdio: ["ignore", "inherit", "inherit"],
        });
        child.unref();
        console.log(child.pid);
        setTimeout(() => {}, 30_000);
      `;
      let grandchild = 0;
      try {
        for await (const line of run(parent).lines()) {
          grandchild = Number(line);
          break;
        }
        expect(grandchild).toBeGreaterThan(0);
        // The kill reaches the command only.
        expect(process.kill(grandchild, 0)).toBe(true);
      } finally {
        if (grandchild > 0) process.kill(grandchild, "SIGKILL");
      }
    });
  });
});

test("$.arrayBuffer", async () => {
  expect(await $`echo hello`.arrayBuffer()).toEqual(new TextEncoder().encode("hello\n").buffer);
});

test("$.bytes", async () => {
  expect(await ($`echo hello` as any).bytes()).toEqual(new TextEncoder().encode("hello\n"));
});

test("$.blob", async () => {
  expect(await $`echo hello`.blob()).toEqual(new Blob([new TextEncoder().encode("hello\n")]));
});

function make(expected: string) {
  const inputType = [
    new Blob([expected]),
    Buffer.from(expected),
    new TextEncoder().encode(expected),
    new Response(expected),
  ];

  for (let data of inputType) {
    test(`$(cat < ${data.constructor.name}).text()`, async () => {
      expect(await $`cat < ${data}`.text()).toEqual(expected);
    });

    if (ArrayBuffer.isView(data)) {
      test(`$(cat hello > ${data.constructor.name}).text() passes`, async () => {
        await $`cat ${import.meta.path} > ${data}`.quiet();
        const out = await $`cat ${import.meta.path}`.arrayBuffer();
        expect(data.subarray(0, out.byteLength)).toEqual(new Uint8Array(out));
      });

      // TODO: if the buffer is not sufficiently large, this will hang forever
    } else {
      test(`$(cat hello > ${data.constructor.name}).text() fails`, async () => {
        expect(async () => await $`cat ${import.meta.path} > ${data}`.text()).toThrow();
      });
    }
  }
}

describe("hello world!.repeat(9000)", () => {
  make("hello world!".repeat(9000));
});
