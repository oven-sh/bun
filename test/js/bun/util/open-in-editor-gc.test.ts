import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, mergeWindowEnvs, tempDir } from "harness";
import { chmodSync, existsSync, symlinkSync } from "node:fs";
import { delimiter, join } from "node:path";

// Both ways of naming an editor (EDITOR in the environment, the `editor`
// option) end in a PATH lookup of the editor's binary name. The fake editors
// inherit the child's stdout, so what they print is what Bun spawned; the
// child stays alive until the test closes its stdin, after both have run.
// Linux-only so PATH is the only place an editor can come from.
test.skipIf(!isLinux)("Bun.openInEditor finds the editor's binary on PATH", async () => {
  const fakeEditor = (name: string) => `#!/bin/sh\necho "${name} $*"\n`;
  using dir = tempDir("open-in-editor-path", {
    "bin/code": fakeEditor("code"),
    "bin/subl": fakeEditor("subl"),
    "run.js": `
      Bun.openInEditor("src/app.ts", { line: 3, column: 7 });
      Bun.openInEditor("src/app.ts", { editor: "subl" });
      await Bun.stdin.text();
    `,
  });
  chmodSync(join(String(dir), "bin/code"), 0o755);
  chmodSync(join(String(dir), "bin/subl"), 0o755);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js"],
    env: { ...bunEnv, PATH: join(String(dir), "bin"), EDITOR: "code" },
    cwd: String(dir),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = proc.stderr.text();
  const decoder = new TextDecoder();
  let stdout = "";
  let released = false;
  for await (const chunk of proc.stdout) {
    stdout += decoder.decode(chunk, { stream: true });
    if (!released && stdout.split("\n").length > 2) {
      released = true;
      proc.stdin.end();
    }
  }

  // The two editors run on separate detached threads, so either may print first.
  expect(stdout.trim().split("\n").sort()).toEqual(["code --goto src/app.ts:3:7", "subl src/app.ts"]);
  expect(await stderr).toBe("");
  expect(await proc.exited).toBe(0);
});

// Option getters and toString run user JS that may call Bun.openInEditor
// again. The editor slot used to stay mutably borrowed across those
// callbacks, so re-entry aborted with "panic: RefCell already borrowed".
// Linux-only so editor detection stays inert: with an empty PATH and no
// EDITOR/VISUAL nothing is found (macOS would probe /Applications).
test.skipIf(!isLinux)("Bun.openInEditor survives re-entrant calls from option getters", async () => {
  using dir = tempDir("open-in-editor-reentrant", {
    "empty-path/.keep": "",
    "run.js": `
      const reenter = () => {
        try { Bun.openInEditor("/nonexistent/f.txt", { editor: "zzz_no_editor" }); } catch {}
      };
      const variants = [
        { get editor() { reenter(); return "zzz_no_editor"; } },
        { editor: { toString() { reenter(); return "zzz_no_editor"; } } },
        { line: { toString() { reenter(); return "1"; } } },
        { get column() { reenter(); return "2"; } },
      ];
      for (const opts of variants) {
        try { Bun.openInEditor("/nonexistent/f.txt", opts); console.log("opened"); } catch (e) { console.log(e.message); }
      }
    `,
  });

  const env: Record<string, string | undefined> = {
    ...bunEnv,
    PATH: join(String(dir), "empty-path"),
  };
  delete env.EDITOR;
  delete env.VISUAL;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // Nothing is found, so every call must throw rather than spawn anything.
  expect(stdout.trim().split("\n")).toEqual([
    'Could not find editor "zzz_no_editor"',
    'Could not find editor "zzz_no_editor"',
    "Failed to auto-detect editor",
    "Failed to auto-detect editor",
  ]);
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

// On Linux, JSC uses SIGPWR to suspend/resume threads for GC and the libpas
// scavenger. Bun.openInEditor spawns a detached thread that goes through
// bun.spawnSync, whose signal-forwarding setup must not touch SIGPWR or the
// process is terminated the next time GC/scavenger fires.
test.skipIf(!isLinux)("Bun.openInEditor does not break GC signal handling", async () => {
  const sleep = ["/usr/bin/sleep", "/bin/sleep"].find(p => existsSync(p));
  expect(sleep).toBeDefined();

  using dir = tempDir("open-in-editor-gc", {
    "run.js": `
      const a = ${JSON.stringify(sleep)};
      const b = process.argv[2];
      // Alternate absolute editor paths so the cached editor name_storage is
      // replaced each call while a detached editor thread may still be
      // reading the previous one.
      for (let i = 0; i < 8; i++) {
        try { Bun.openInEditor("0.3", { editor: i % 2 ? b : a }); } catch {}
      }
      // Wait for the detached editor threads to complete their register /
      // unregister cycle, then for the scavenger to fire SIGPWR.
      await Bun.sleep(1000);
      Bun.gc(true);
      console.log("alive");
    `,
  });
  // Second absolute path to the same binary so alternating calls take the
  // `!eql_long(prev_name, ...)` branch in open_in_editor. Keep the basename
  // `sleep` so BusyBox (Alpine) resolves the multi-call applet from argv[0].
  const sleep2 = join(String(dir), "sleep");
  symlinkSync(sleep!, sleep2);

  const runs = Array.from({ length: 5 }, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.js", sleep2],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("alive");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });

  await Promise.all(runs);
});

// Windows runs a .cmd or .bat file through cmd.exe, and cmd.exe reads the
// arguments a second time: `%NAME%` becomes the value of the environment
// variable NAME, and `&`, `|`, `<` and `>` start another command or a
// redirect. Each test below calls Bun.openInEditor in a child process that has
// CMD_PROBE=read-by-cmd in its environment. A fake editor appends the arguments
// it was started with to out.txt. For each call the child prints the error the
// call threw, or else the line the editor wrote.
const openInEditorFixture = `
  import { readFileSync } from "node:fs";

  let started = 0;
  for (const { path, options } of JSON.parse(process.env.OPEN_IN_EDITOR_CALLS)) {
    let error;
    try {
      Bun.openInEditor(path, options);
    } catch (e) {
      error = e;
    }
    if (error) {
      console.log("threw " + error.code + ": " + error.message);
      continue;
    }

    // The editor runs on a detached thread, so poll for the line it appends.
    let line = "nothing";
    for (const deadline = Date.now() + 30_000; Date.now() < deadline; await Bun.sleep(5)) {
      let lines = [];
      try {
        lines = readFileSync("out.txt", "utf8").split(/\\r?\\n/);
      } catch {}
      if (lines.length > started + 1) {
        line = lines[started++];
        break;
      }
    }
    console.log("editor got " + line);
  }
`;

async function openInEditor(dir: string, calls: { path: string; options?: object }[], env = bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js"],
    env: { ...env, CMD_PROBE: "read-by-cmd", OPEN_IN_EDITOR_CALLS: JSON.stringify(calls) },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent.if(isWindows)("Bun.openInEditor with a .cmd or .bat editor", () => {
  const files = (editor: string, body = "@echo off\r\n>> out.txt echo arg=%*\r\n") => ({
    [editor]: body,
    "run.js": openInEditorFixture,
  });
  const refusal = (name: string, value: string, editor: string) =>
    `threw ERR_INVALID_ARG_VALUE: The ${name} contains a cmd.exe special character and cannot be safely passed to the .bat/.cmd editor "${editor}". Received ${JSON.stringify(value)}\n`;

  test.each([
    ["fake-editor.cmd", "%CMD_PROBE%.js"],
    ["fake-editor.bat", "%CMD_PROBE%.js"],
    ["fake-editor.cmd", "a&b.js"],
    ["fake-editor.cmd", "a|b.js"],
    ["fake-editor.cmd", "a<b.js"],
    ["fake-editor.cmd", "a>b.js"],
    ["fake-editor.cmd", "a^b.js"],
    ["fake-editor.cmd", 'a"b.js'],
    ["fake-editor.cmd", "a\nb.js"],
    ["fake-editor.cmd", "a\rb.js"],
    // A special character inside quotes, and a `%` that starts no variable name.
    ["fake-editor.cmd", "a & b.js"],
    ["fake-editor.cmd", "100%.js"],
    // The path of the editor has a space too.
    ["my editors/fake-editor.cmd", "a & b.js"],
  ])("%s refuses the path %j", async (name, path) => {
    using dir = tempDir("open-in-editor-batch", files(name));
    const editor = join(String(dir), name);
    expect(await openInEditor(String(dir), [{ path, options: { editor } }])).toEqual({
      stdout: refusal("argument 'path'", path, editor),
      stderr: "",
      exitCode: 0,
    });
  });

  // The editor runs the bytes before a NUL, so those bytes decide that it is a batch file.
  test("fake-editor.cmd refuses the path when a NUL and .exe follow its name", async () => {
    using dir = tempDir("open-in-editor-batch", files("fake-editor.cmd"));
    const editor = join(String(dir), "fake-editor.cmd");
    expect(await openInEditor(String(dir), [{ path: "a&b.js", options: { editor: editor + "\0.exe" } }])).toEqual({
      stdout: refusal("argument 'path'", "a&b.js", editor),
      stderr: "",
      exitCode: 0,
    });
  });

  // A call with no editor option starts the editor that an earlier call found.
  test("fake-editor.cmd refuses the path of a later call that names no editor", async () => {
    using dir = tempDir("open-in-editor-batch", files("fake-editor.cmd"));
    const editor = join(String(dir), "fake-editor.cmd");
    expect(await openInEditor(String(dir), [{ path: "hello.js", options: { editor } }, { path: "a&b.js" }])).toEqual({
      stdout: "editor got arg=hello.js\n" + refusal("argument 'path'", "a&b.js", editor),
      stderr: "",
      exitCode: 0,
    });
  });

  // The editor of a refused call would append the first line of out.txt.
  test("fake-editor.cmd does not start for a refused call", async () => {
    using dir = tempDir("open-in-editor-batch", files("fake-editor.cmd"));
    const editor = join(String(dir), "fake-editor.cmd");
    const calls = ["%CMD_PROBE%.js", "first.js", "second.js"].map(path => ({ path, options: { editor } }));
    expect(await openInEditor(String(dir), calls)).toEqual({
      stdout:
        refusal("argument 'path'", "%CMD_PROBE%.js", editor) + "editor got arg=first.js\neditor got arg=second.js\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // cmd.exe reads the path of the editor too.
  test("an editor whose own path has a special character does not start", async () => {
    using dir = tempDir("open-in-editor-batch", files("a&b/fake-editor.cmd"));
    const editor = join(String(dir), "a&b", "fake-editor.cmd");
    expect(await openInEditor(String(dir), [{ path: "hello.js", options: { editor } }])).toEqual({
      stdout: `threw ERR_INVALID_ARG_VALUE: The editor path contains a cmd.exe special character and cannot be safely passed to cmd.exe, which runs a .bat/.cmd editor. Received "${editor}"\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  // Bun knows no command line for fake-editor.cmd, so this editor gets the path alone.
  test("fake-editor.cmd gets the path when the line and the column have a special character", async () => {
    using dir = tempDir("open-in-editor-batch", files("fake-editor.cmd"));
    const options = { editor: join(String(dir), "fake-editor.cmd"), line: "%CMD_PROBE%", column: "%CMD_PROBE%" };
    expect(await openInEditor(String(dir), [{ path: "hello.js", options }])).toEqual({
      stdout: "editor got arg=hello.js\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Not fixed, and not refused. cmd.exe splits an argument at `=`, `,` and `;`
  // when a batch file reads %1: Windows CI shows `arg=[a][b.js]` for each path.
  test.todo("a .cmd editor that reads %1 gets a path with a delimiter in one piece", async () => {
    using dir = tempDir(
      "open-in-editor-batch",
      files("fake-editor.cmd", "@echo off\r\n>> out.txt echo arg=[%1][%2]\r\n"),
    );
    const editor = join(String(dir), "fake-editor.cmd");
    const calls = ["a=b.js", "a,b.js", "a;b.js"].map(path => ({ path, options: { editor } }));
    expect(await openInEditor(String(dir), calls)).toEqual({
      stdout: "editor got arg=[a=b.js][]\neditor got arg=[a,b.js][]\neditor got arg=[a;b.js][]\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // `code` and `idea` are found on PATH. VS Code takes the position as
  // `--goto file:line:column`, and a JetBrains editor as `file:line`.
  const onPath = (dir: string) => mergeWindowEnvs([bunEnv, { PATH: `${dir}${delimiter}${process.env.PATH}` }]);

  test.each(["line", "column"])("code.cmd refuses the %s option", async option => {
    using dir = tempDir("open-in-editor-batch", files("code.cmd"));
    const options = { editor: "code", line: 3, column: 7, [option]: "%CMD_PROBE%" };
    expect(await openInEditor(String(dir), [{ path: "hello.js", options }], onPath(String(dir)))).toEqual({
      stdout: refusal(`property 'options.${option}'`, "%CMD_PROBE%", Bun.which("code", { PATH: String(dir) })!),
      stderr: "",
      exitCode: 0,
    });
  });

  test("code.cmd gets a path and a position that have no special character", async () => {
    using dir = tempDir("open-in-editor-batch", files("code.cmd"));
    const options = { editor: "code", line: 3, column: 7 };
    expect(await openInEditor(String(dir), [{ path: "hello world.js", options }], onPath(String(dir)))).toEqual({
      stdout: 'editor got arg=--goto "hello world.js:3:7"\n',
      stderr: "",
      exitCode: 0,
    });
  });

  // VS Code takes a column only after a line.
  test("code.cmd gets the path when the column has a special character and there is no line", async () => {
    using dir = tempDir("open-in-editor-batch", files("code.cmd"));
    const options = { editor: "code", column: "%CMD_PROBE%" };
    expect(await openInEditor(String(dir), [{ path: "hello.js", options }], onPath(String(dir)))).toEqual({
      stdout: "editor got arg=hello.js\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The default install directories of VS Code have a space.
  test("code.cmd in a directory with a space gets a path and a position", async () => {
    using dir = tempDir("open-in-editor-batch", files("my editors/code.cmd"));
    const options = { editor: "code", line: 3, column: 7 };
    const env = onPath(join(String(dir), "my editors"));
    expect(await openInEditor(String(dir), [{ path: "hello.js", options }], env)).toEqual({
      stdout: "editor got arg=--goto hello.js:3:7\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Not fixed. Both paths get quotes, and cmd.exe then drops the first and the
  // last quote of the line: Windows CI shows `'C:\...\my' is not recognized as
  // an internal or external command`, and the editor does not start.
  test.todo("code.cmd in a directory with a space gets a path with a space", async () => {
    using dir = tempDir("open-in-editor-batch", files("my editors/code.cmd"));
    const options = { editor: "code", line: 3, column: 7 };
    const env = onPath(join(String(dir), "my editors"));
    expect(await openInEditor(String(dir), [{ path: "hello world.js", options }], env)).toEqual({
      stdout: 'editor got arg=--goto "hello world.js:3:7"\n',
      stderr: "",
      exitCode: 0,
    });
  });

  test("idea.cmd refuses the line option", async () => {
    using dir = tempDir("open-in-editor-batch", files("idea.cmd"));
    const options = { editor: "idea", line: "%CMD_PROBE%" };
    expect(await openInEditor(String(dir), [{ path: "hello.js", options }], onPath(String(dir)))).toEqual({
      stdout: refusal("property 'options.line'", "%CMD_PROBE%", Bun.which("idea", { PATH: String(dir) })!),
      stderr: "",
      exitCode: 0,
    });
  });

  test("idea.cmd gets the path and the line when the column has a special character", async () => {
    using dir = tempDir("open-in-editor-batch", files("idea.cmd"));
    const options = { editor: "idea", line: 3, column: "%CMD_PROBE%" };
    expect(await openInEditor(String(dir), [{ path: "hello.js", options }], onPath(String(dir)))).toEqual({
      stdout: "editor got arg=hello.js:3\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The editor is bun itself, which runs the path as a script. Windows starts an
  // .exe directly, so the path arrives as written.
  test("an .exe editor gets a path that has a special character", async () => {
    const script = `require("node:fs").appendFileSync("out.txt", "arg=" + require("node:path").basename(process.argv[1]) + "\\n");`;
    using dir = tempDir("open-in-editor-exe", {
      "%CMD_PROBE%.js": script,
      "read-by-cmd.js": script,
      "run.js": openInEditorFixture,
    });
    expect(await openInEditor(String(dir), [{ path: "%CMD_PROBE%.js", options: { editor: bunExe() } }])).toEqual({
      stdout: "editor got arg=%CMD_PROBE%.js\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

// On POSIX a file named .cmd is an ordinary program, and nothing reads its
// arguments a second time.
test.skipIf(isWindows)("Bun.openInEditor passes a cmd.exe special character to a .cmd editor on POSIX", async () => {
  using dir = tempDir("open-in-editor-posix-cmd", {
    "fake-editor.cmd": '#!/bin/sh\necho "arg=$*" >> out.txt\n',
    "run.js": openInEditorFixture,
  });
  const editor = join(String(dir), "fake-editor.cmd");
  chmodSync(editor, 0o755);

  expect(await openInEditor(String(dir), [{ path: "%CMD_PROBE%.js", options: { editor } }])).toEqual({
    stdout: "editor got arg=%CMD_PROBE%.js\n",
    stderr: "",
    exitCode: 0,
  });
});

// The command line that each editor gets for a path, a line and a column.
// Linux-only so PATH is the only place an editor can come from.
test.skipIf(!isLinux)("Bun.openInEditor builds the command line of each editor", async () => {
  const names = ["code", "subl", "atom", "mate", "idea", "webstorm"];
  using dir = tempDir("open-in-editor-argv", {
    ...Object.fromEntries(names.map(name => [`bin/${name}`, `#!/bin/sh\necho "${name} $*" >> out.txt\n`])),
    "run.js": openInEditorFixture,
  });
  for (const name of names) chmodSync(join(String(dir), "bin", name), 0o755);

  // An empty array is a line or a column that is present and empty.
  const cases: [object, string][] = [
    [{ editor: "code" }, "code f.js"],
    [{ editor: "code", line: 3 }, "code --goto f.js:3"],
    [{ editor: "code", column: 7 }, "code f.js"],
    [{ editor: "code", line: [], column: 7 }, "code f.js"],
    [{ editor: "code", line: 3, column: [] }, "code --goto f.js:3"],
    [{ editor: "subl", line: 3, column: 7 }, "subl f.js:3:7"],
    [{ editor: "atom", line: 3, column: 7 }, "atom f.js:3:7"],
    [{ editor: "mate", line: 3, column: 7 }, "mate --line 3:7 f.js"],
    [{ editor: "idea", line: 3, column: 7 }, "idea f.js:3"],
    [{ editor: "webstorm", line: 3, column: 7 }, "webstorm f.js:3"],
  ];
  const calls = cases.map(([options]) => ({ path: "f.js", options }));
  expect(await openInEditor(String(dir), calls, { ...bunEnv, PATH: join(String(dir), "bin") })).toEqual({
    stdout: cases.map(([, argv]) => `editor got ${argv}\n`).join(""),
    stderr: "",
    exitCode: 0,
  });
});
