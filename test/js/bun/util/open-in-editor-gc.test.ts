import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
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
// redirect. Each test below runs one Bun.openInEditor call in a child process
// that has CMD_PROBE=read-by-cmd in its environment. A fake editor writes the
// arguments it was started with to out.txt, and the child prints the error the
// call threw, or else what the editor wrote.
const openInEditorFixture = `
  import { readFileSync } from "node:fs";

  const { path, options } = JSON.parse(process.env.OPEN_IN_EDITOR_CALL);
  let error;
  try {
    Bun.openInEditor(path, options);
  } catch (e) {
    error = e;
  }

  if (error) {
    console.log("threw " + error.code + ": " + error.message);
  } else {
    // The editor runs on a detached thread, so poll for the file it writes.
    let written = "nothing";
    for (const deadline = Date.now() + 30_000; Date.now() < deadline; await Bun.sleep(5)) {
      try {
        const text = readFileSync("out.txt", "utf8");
        if (text.endsWith("\\n")) {
          written = text.trim();
          break;
        }
      } catch {}
    }
    console.log("editor got " + written);
  }
`;

async function openInEditor(dir: string, path: string, options: object, env = bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.js"],
    env: { ...env, CMD_PROBE: "read-by-cmd", OPEN_IN_EDITOR_CALL: JSON.stringify({ path, options }) },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent.if(isWindows)("Bun.openInEditor with a .cmd or .bat editor", () => {
  const batchEditor = '@echo off\r\n> "%~dp0out.txt" echo arg=%*\r\n';
  const refusal = (name: string, value: string) =>
    `threw ERR_INVALID_ARG_VALUE: The ${name} contains a cmd.exe special character and cannot be safely passed to a .bat/.cmd file. Received ${JSON.stringify(value)}\n`;

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
  ])("%s refuses the path %j", async (name, path) => {
    using dir = tempDir("open-in-editor-batch", { [name]: batchEditor, "run.js": openInEditorFixture });
    expect(await openInEditor(String(dir), path, { editor: join(String(dir), name) })).toEqual({
      stdout: refusal("argument 'path'", path),
      stderr: "",
      exitCode: 0,
    });
  });

  // VS Code puts code.cmd on PATH and takes the position as `--goto file:line:column`.
  const codeOnPath = (dir: string) => ({ ...bunEnv, PATH: `${dir}${delimiter}${process.env.PATH}` });

  test.each(["line", "column"])("code.cmd refuses the %s option", async option => {
    using dir = tempDir("open-in-editor-batch", { "code.cmd": batchEditor, "run.js": openInEditorFixture });
    const options = { editor: "code", line: 3, column: 7, [option]: "%CMD_PROBE%" };
    expect(await openInEditor(String(dir), "hello.js", options, codeOnPath(String(dir)))).toEqual({
      stdout: refusal(`property 'options.${option}'`, "%CMD_PROBE%"),
      stderr: "",
      exitCode: 0,
    });
  });

  test("code.cmd gets a path and a position that have no special character", async () => {
    using dir = tempDir("open-in-editor-batch", { "code.cmd": batchEditor, "run.js": openInEditorFixture });
    const options = { editor: "code", line: 3, column: 7 };
    expect(await openInEditor(String(dir), "hello world.js", options, codeOnPath(String(dir)))).toEqual({
      stdout: 'editor got arg=--goto "hello world.js:3:7"\n',
      stderr: "",
      exitCode: 0,
    });
  });

  // The editor is bun itself, which runs the path as a script. Windows starts an
  // .exe directly, so the path arrives as written.
  test("an .exe editor gets a path that has a special character", async () => {
    const script = `require("node:fs").writeFileSync("out.txt", "arg=" + require("node:path").basename(process.argv[1]) + "\\n");`;
    using dir = tempDir("open-in-editor-exe", {
      "%CMD_PROBE%.js": script,
      "read-by-cmd.js": script,
      "run.js": openInEditorFixture,
    });
    expect(await openInEditor(String(dir), "%CMD_PROBE%.js", { editor: bunExe() })).toEqual({
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
    "fake-editor.cmd": '#!/bin/sh\necho "arg=$*" > "$(dirname "$0")/out.txt"\n',
    "run.js": openInEditorFixture,
  });
  const editor = join(String(dir), "fake-editor.cmd");
  chmodSync(editor, 0o755);

  expect(await openInEditor(String(dir), "%CMD_PROBE%.js", { editor })).toEqual({
    stdout: "editor got arg=%CMD_PROBE%.js\n",
    stderr: "",
    exitCode: 0,
  });
});
