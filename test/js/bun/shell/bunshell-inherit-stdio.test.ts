import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// These run in sequence. Each starts a bun, and a debug build starts slowly: eight at once come
// close to the default timeout on a machine with few cores.
describe("inheritStdio", () => {
  const notBuffered = "output is not buffered when inheritStdio() is used";
  const notCombined = "inheritStdio() cannot be combined with quiet() or an output method such as text()";
  const readers = ["text", "json", "arrayBuffer", "bytes", "blob"] as const;

  // The external command a fixture runs: `<name>.sh` where there is an `sh`, `<name>.mjs` on
  // Windows. With `sh` the fixture is the only bun that starts, and a debug build of bun takes
  // about a second to start.
  const external = (name: string) => (isWindows ? `"$BUN_EXE" ${name}.mjs` : `sh ${name}.sh`);
  const fixtureEnv = (name: string) => ({ ...bunEnv, BUN_EXE: bunExe(), EXTERNAL: external(name) });

  // `probe <tag> [stdin]` writes one line to stdout and one to stderr. Each line says whether the
  // process has a file or a pipe on fd 1 and on fd 2, so the place where a line lands shows where
  // that stream goes and the line shows whether the shell relays it.
  const probe = {
    "probe.sh": `
      if [ -f /dev/fd/1 ]; then out=file; else out=pipe; fi
      if [ -f /dev/fd/2 ]; then err=file; else err=pipe; fi
      if [ -n "$2" ]; then input=" stdin=$(cat)"; fi
      echo "$1 out $out $err$input"
      echo "$1 err $out $err" >&2
    `,
    "probe.mjs": `
      const [tag, readStdin] = process.argv.slice(2);
      const kind = async fd => ((await Bun.file(fd).stat()).isFile() ? "file" : "pipe");
      const kinds = (await kind(1)) + " " + (await kind(2));
      const input = readStdin ? " stdin=" + (await Bun.stdin.text()).trim() : "";
      console.log(tag + " out " + kinds + input);
      console.error(tag + " err " + kinds);
    `,
  };

  // Runs `fixture` in a bun whose stdout and stderr are two files. The fixtures run their scripts
  // at the same time, so the lines of the two files come back sorted.
  async function runWithFileStdio(fixture: string, fileNames: string[]) {
    using dir = tempDir("shell-inherit-stdio", {
      ...probe,
      "inherit-fixture.mjs": `
        import { $ } from "bun";
        const probe = { raw: process.env.EXTERNAL };
        ${fixture}
      `,
    });
    const cwd = String(dir);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "inherit-fixture.mjs"],
      env: fixtureEnv("probe"),
      cwd,
      stdin: "ignore",
      stdout: Bun.file(join(cwd, "stdout.txt")),
      stderr: Bun.file(join(cwd, "stderr.txt")),
    });
    const exitCode = await proc.exited;
    const read = (name: string) =>
      Bun.file(join(cwd, name))
        .text()
        .catch(() => "");
    const sortedLines = (text: string) => text.split("\n").filter(Boolean).sort();
    const files: Record<string, string> = {};
    for (const name of fileNames) files[name] = await read(name);
    return {
      stdout: sortedLines(await read("stdout.txt")),
      stderr: sortedLines(await read("stderr.txt")),
      files,
      exitCode,
    };
  }

  test("each command of a script gets bun's own stdout and stderr", async () => {
    const { stdout, stderr, files, exitCode } = await runWithFileStdio(
      `
        const results = await Promise.all([
          $\`(\${probe} @subshell); echo @builtin\`.inheritStdio(),
          $\`\${probe} @first | \${probe} @last stdin\`.inheritStdio(),
          $\`echo @substitution=$(\${probe} @inner)\`.inheritStdio(),
        ]);
        await Bun.write("result.json", JSON.stringify(results.map(result => result.exitCode)));
      `,
      ["result.json"],
    );
    expect({ stdout, stderr, files }).toEqual({
      stdout: [
        "@subshell out file file",
        "@builtin",
        "@last out file file stdin=@first out pipe file",
        "@substitution=@inner out pipe file",
      ].sort(),
      stderr: ["@subshell err file file", "@first err pipe file", "@last err file file", "@inner err pipe file"].sort(),
      files: { "result.json": "[0,0,0]" },
    });
    expect(exitCode).toBe(0);
  });

  test("the default mode and quiet() are unchanged, and each `false` undoes only its own mode", async () => {
    const { stdout, stderr, files, exitCode } = await runWithFileStdio(
      `
          const buffered = async script => {
            const result = await script;
            try {
              return result.stdout.toString();
            } catch (error) {
              return error.message;
            }
          };
          const results = await Promise.all([
            buffered($\`\${probe} @default\`),
            buffered($\`echo @quiet\`.quiet()),
            buffered($\`echo @undone\`.inheritStdio().inheritStdio(false)),
            buffered($\`echo @kept-quiet\`.quiet().inheritStdio(false)),
            buffered($\`echo @kept-inherit\`.inheritStdio().quiet(false)),
            buffered($\`echo @inherit-after-quiet\`.quiet().quiet(false).inheritStdio()),
          ]);
          await Bun.write("result.json", JSON.stringify(results));
        `,
      ["result.json"],
    );
    expect({ stdout, stderr, files }).toEqual({
      stdout: ["@default out pipe pipe", "@undone", "@kept-inherit", "@inherit-after-quiet"].sort(),
      stderr: ["@default err pipe pipe"],
      files: {
        "result.json": JSON.stringify([
          "@default out pipe pipe\n",
          "@quiet\n",
          "@undone\n",
          "@kept-quiet\n",
          notBuffered,
          notBuffered,
        ]),
      },
    });
    expect(exitCode).toBe(0);
  });

  test("a redirect to a file moves one stream and leaves the other on bun's own", async () => {
    const { stdout, stderr, files, exitCode } = await runWithFileStdio(
      `
        const results = await Promise.all([
          $\`\${probe} @to-file > out.txt\`.inheritStdio(),
          $\`\${probe} @err-to-file 2> err.txt\`.inheritStdio(),
        ]);
        await Bun.write("result.json", JSON.stringify(results.map(result => result.exitCode)));
      `,
      ["out.txt", "err.txt", "result.json"],
    );
    expect({ stdout, stderr, files }).toEqual({
      stdout: ["@err-to-file out file file"],
      stderr: ["@to-file err file file"],
      files: {
        "out.txt": "@to-file out file file\n",
        "err.txt": "@err-to-file err file file\n",
        "result.json": "[0,0]",
      },
    });
    expect(exitCode).toBe(0);
  });

  // One script for `bun exec` and for inheritStdio(): both take the path where nothing is buffered,
  // so both must write the same bytes in the same order.
  describe("a script with builtins, `2>&1` and `1>&2` on piped stdout and stderr", () => {
    const sayBoth = external("say-both");
    const script = `echo first; ${sayBoth} a 2>&1; echo second 1>&2; ${sayBoth} b 1>&2; nonexistent-cmd-xyz; echo third; exit 7`;
    const expected = {
      stdout: "first\na out\na err\nthird\n",
      stderr: "second\nb out\nb err\nbun: command not found: nonexistent-cmd-xyz\n",
      exitCode: 7,
    };

    async function run(...args: string[]) {
      using dir = tempDir("shell-inherit-stdio-exec", {
        "say-both.sh": `
          echo "$1 out"
          echo "$1 err" >&2
        `,
        "say-both.mjs": `
          await Bun.write(Bun.stdout, process.argv[2] + " out\\n");
          await Bun.write(Bun.stderr, process.argv[2] + " err\\n");
        `,
        "inherit-fixture.mjs": `
          import { $ } from "bun";
          const { exitCode } = await $\`\${{ raw: process.env.SCRIPT }}\`.inheritStdio().nothrow();
          process.exit(exitCode);
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        env: { ...fixtureEnv("say-both"), SCRIPT: script },
        cwd: String(dir),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    test("under `bun exec`", async () => {
      expect(await run("exec", script)).toEqual(expected);
    });

    test("with inheritStdio()", async () => {
      expect(await run("inherit-fixture.mjs")).toEqual(expected);
    });
  });

  test("a command sees a terminal when bun's stdout and stderr are one", async () => {
    using dir = tempDir("shell-inherit-stdio-tty", {
      "tty.sh": `
        if [ -t 1 ]; then out=true; else out=false; fi
        if [ -t 2 ]; then err=true; else err=false; fi
        echo "{\\"stdout\\":$out,\\"stderr\\":$err}" > "$1.json"
        echo bytes
      `,
      // `isTTY` of tty_wrap is what process.stdout.isTTY reports, without node:tty.
      "tty.mjs": `
        const { isTTY } = process.binding("tty_wrap");
        await Bun.write(process.argv[2] + ".json", JSON.stringify({ stdout: isTTY(1), stderr: isTTY(2) }));
        console.log("bytes");
      `,
      "inherit-fixture.mjs": `
        import { $ } from "bun";
        const tty = { raw: process.env.EXTERNAL };
        const [tee] = await Promise.all([$\`\${tty} tee\`, $\`\${tty} inherit\`.inheritStdio()]);
        await Bun.write("tee-stdout.json", JSON.stringify(tee.stdout.toString()));
      `,
    });
    let screen = "";
    const decoder = new TextDecoder();
    await using terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_terminal, chunk: Uint8Array) {
        screen += decoder.decode(chunk, { stream: true });
      },
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "inherit-fixture.mjs"],
      env: fixtureEnv("tty"),
      cwd: String(dir),
      terminal,
    });
    const exitCode = await proc.exited;
    const read = (name: string) =>
      Bun.file(join(String(dir), name))
        .json()
        .catch(() => `missing. terminal: ${screen}`);
    expect({
      tee: await read("tee.json"),
      inherit: await read("inherit.json"),
      teeStdout: await read("tee-stdout.json"),
    }).toEqual({
      tee: { stdout: false, stderr: false },
      inherit: { stdout: true, stderr: true },
      teeStdout: "bytes\n",
    });
    expect(exitCode).toBe(0);
  });

  test("a command settles when its process exits, not when its output closes", async () => {
    using dir = tempDir("shell-inherit-stdio-settle", {
      // Each spawner exits at once and leaves a process that holds its stdout and stderr open.
      "spawner.sh": `
        sleep 30 &
        echo $! > holder.pid
      `,
      "spawner.mjs": `
        const holder = Bun.spawn({
          cmd: [process.execPath, "-e", "await Bun.sleep(30_000)"],
          stdio: ["ignore", "inherit", "inherit"],
          // Windows: keep the holder out of this process's kill-on-close job.
          detached: true,
        });
        holder.unref();
        await Bun.write("holder.pid", String(holder.pid));
      `,
      "inherit-fixture.mjs": `
        import { $ } from "bun";
        await $\`\${{ raw: process.env.EXTERNAL }}\`.inheritStdio();
        const holder = Number(await Bun.file("holder.pid").text());
        process.kill(holder, 0);
        process.kill(holder, "SIGKILL");
        console.log("settled while the holder was alive");
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "inherit-fixture.mjs"],
      // CI ASAN lanes set BUN_FEATURE_FLAG_NO_ORPHANS, which makes a bun spawner kill the
      // detached holder on exit. Unset it so the holder really keeps the streams open.
      env: { ...fixtureEnv("spawner"), BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      // The fixture did not reach its own kill. Reap the holder so nothing outlives the test.
      // Guard the pid: kill(0) would signal this whole process group.
      const pid = Number(
        await Bun.file(join(String(dir), "holder.pid"))
          .text()
          .catch(() => ""),
      );
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
    expect({ stdout, stderr }).toEqual({ stdout: "settled while the holder was alive\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("output stays complete and in order when bun's stdout is a pipe", async () => {
    using dir = tempDir("shell-inherit-stdio-pipe", {
      "say.sh": `echo "$1"`,
      "say.mjs": `console.log(process.argv[2]);`,
      "inherit-fixture.mjs": `
        import { $ } from "bun";
        await $\`\${{ raw: process.env.EXTERNAL }} command\`.inheritStdio();
        await $\`echo builtin-1\`.inheritStdio();
        console.log(Buffer.alloc(2 * 1024 * 1024, "x").toString());
        await $\`echo builtin-2\`.inheritStdio();
        console.log("end");
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "inherit-fixture.mjs"],
      env: fixtureEnv("say"),
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const large = Buffer.alloc(2 * 1024 * 1024, "x").toString();
    expect({ stdout: stdout.replace(large, "<2 MiB>"), stderr }).toEqual({
      stdout: "command\nbuiltin-1\n<2 MiB>\nbuiltin-2\nend\n",
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("the result holds no output: `stdout`, `stderr` and the output methods throw", async () => {
    const output = await $`true`.inheritStdio();
    expect(output.exitCode).toBe(0);
    expect(() => output.stdout).toThrow(notBuffered);
    expect(() => output.stderr).toThrow(notBuffered);
    for (const reader of readers) expect(() => output[reader]()).toThrow(notBuffered);
    expect({ name: Bun.inspect(output).split(" ")[0], json: JSON.stringify(output) }).toEqual({
      name: "ShellOutput",
      json: '{"exitCode":0}',
    });

    const error = await $`exit 3`
      .inheritStdio()
      .throws(true)
      .then(
        () => undefined,
        error => error,
      );
    expect(error).toBeInstanceOf($.ShellError);
    expect({ message: error.message, exitCode: error.exitCode, info: error.info }).toEqual({
      message: "Failed with exit code 3",
      exitCode: 3,
      info: { exitCode: 3 },
    });
    expect(() => error.stdout).toThrow(notBuffered);
    expect(() => error.stderr).toThrow(notBuffered);
    for (const reader of readers) expect(() => error[reader]()).toThrow(notBuffered);
  });

  test("cannot be combined with quiet() or an output method on one command", async () => {
    expect(() => $`true`.inheritStdio().quiet()).toThrow(notCombined);
    expect(() => $`true`.quiet().inheritStdio()).toThrow(notCombined);
    for (const reader of readers) {
      const promise: any = $`true`.inheritStdio();
      await expect(promise[reader]()).rejects.toThrow(notCombined);
    }
    const lines = $`true`.inheritStdio().lines()[Symbol.asyncIterator]();
    await expect(lines.next()).rejects.toThrow(notCombined);
  });

  test("cannot be set once the script runs", async () => {
    const promise = $`true`;
    const settled = promise.then(() => {});
    expect(() => promise.inheritStdio()).toThrow("Shell is already running");
    await settled;
  });
});
