// `--inspect-brk` and `BUN_INSPECT=<url>?break=1` pause the program before the first
// statement of the entry. The debugger makes that pause when the entry's code starts to run:
// the entry's text is the same as under `--inspect-wait`, and the pause does not depend on
// `Debugger.setPauseOnDebuggerStatements`. A client has to send `Debugger.enable` and
// `Debugger.setBreakpointsActive{active:true}` before `Inspector.initialized`.
import { spawn, type Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { SocketFramer } from "./socket-framer";

type Pause = {
  reason: string;
  /** Basename of the script of the top call frame. */
  file: string;
  /** 1-based, in the text that Debugger.getScriptSource returns. */
  line: number;
  column: number;
  callFrameId: string;
  scriptId: string;
};

type Handshake = {
  /** Debugger.setBreakpointsActive. `null` sends nothing. */
  breakpointsActive?: boolean | null;
  /** Debugger.setPauseOnDebuggerStatements{enabled:true}. */
  pauseOnDebuggerStatements?: boolean;
  /** Debugger.setPauseOnMicrotasks{enabled:true}. */
  pauseOnMicrotasks?: boolean;
  /** Breakpoints by URL, set before the program runs. `line` is 1-based. */
  breakpoints?: { file: string; line: number }[];
};

type Options = {
  exe?: string;
  stdin?: string;
  env?: Record<string, string | undefined>;
  /** Give the inspectee `BUN_INSPECT=tcp://<a port of this process>?break=1` instead of a flag. */
  breakFromEnv?: boolean;
  handshake?: Handshake;
};

type Transport = { send(message: string): void; close(): void };

/** One inspectee in a directory of its own, and the inspector session with it. */
class Session implements AsyncDisposable {
  readonly pauses: Pause[] = [];
  stdout = "";
  stderr = "";
  #dir: ReturnType<typeof tempDir>;
  #proc: Subprocess<"ignore" | Blob, "pipe", "pipe">;
  #transport: Transport | undefined;
  #nextId = 1;
  #pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  #scripts = new Map<string, string>();
  #unread = 0;
  #wake: Array<() => void> = [];
  #drained: Promise<unknown>;
  /** Rejects once the inspectee has exited and its output is read. */
  #exited = Promise.withResolvers<never>();

  private constructor(dir: ReturnType<typeof tempDir>, proc: Subprocess<"ignore" | Blob, "pipe", "pipe">) {
    this.#dir = dir;
    this.#proc = proc;
    this.#exited.promise.catch(() => {});
    const pump = async (stream: ReadableStream<Uint8Array>, sink: "stdout" | "stderr") => {
      const decoder = new TextDecoder();
      for await (const chunk of stream) {
        this[sink] += decoder.decode(chunk, { stream: true });
        this.#wakeAll();
      }
    };
    this.#drained = Promise.allSettled([pump(proc.stdout, "stdout"), pump(proc.stderr, "stderr")]);
    proc.exited.then(async code => {
      await this.#drained;
      const error = new Error(
        `the inspectee exited (${code ?? proc.signalCode})\nstdout:\n${this.stdout}\nstderr:\n${this.stderr}`,
      );
      this.#exited.reject(error);
      for (const { reject } of this.#pending.values()) reject(error);
      this.#pending.clear();
    });
  }

  #wakeAll() {
    this.#wake.splice(0).forEach(wake => wake());
  }

  #woken(): Promise<void> {
    return Promise.race([new Promise<void>(resolve => this.#wake.push(resolve)), this.#exited.promise]);
  }

  #receive(text: string) {
    const message = JSON.parse(text);
    if (typeof message.id === "number") {
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) pending?.reject(new Error(String(message.error.message)));
      else pending?.resolve(message.result);
    } else if (message.method === "Debugger.scriptParsed") {
      this.#scripts.set(message.params.scriptId, message.params.url);
    } else if (message.method === "Debugger.paused") {
      const { callFrameId, location } = message.params.callFrames[0];
      this.pauses.push({
        reason: message.params.reason,
        file: basename(this.#scripts.get(location.scriptId) ?? "?"),
        line: location.lineNumber + 1,
        column: location.columnNumber + 1,
        callFrameId,
        scriptId: location.scriptId,
      });
      this.#wakeAll();
    }
  }

  /** Writes `files` to a new directory, runs `bun ...args` in it and does the handshake of a debugger client. */
  static async start(files: Record<string, string | Uint8Array>, args: string[], options: Options = {}) {
    const dir = tempDir("inspect-brk", files);
    const cwd = realpathSync(String(dir));
    const env: Record<string, string | undefined> = { ...bunEnv, ...options.env };
    const connected = Promise.withResolvers<Transport>();
    connected.promise.catch(() => {});
    let receive = (_text: string) => {};
    let listener: ReturnType<typeof Bun.listen> | undefined;
    if (options.breakFromEnv) {
      const framer = new SocketFramer(text => receive(text));
      listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open(socket) {
            connected.resolve({ send: message => framer.send(socket, message), close: () => socket.end() });
          },
          data(socket, bytes) {
            framer.onData(socket, bytes);
          },
          close() {
            connected.reject(new Error("the inspector connection closed"));
          },
        },
      });
      env.BUN_INSPECT = `tcp://127.0.0.1:${listener.port}?break=1`;
    }

    const proc = spawn({
      cmd: [options.exe ?? bunExe(), ...args],
      cwd,
      env,
      stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const session = new Session(dir, proc);
    receive = text => session.#receive(text);
    try {
      if (!options.breakFromEnv) {
        const [, url] = await session.output("stderr", /^\s*(ws:\/\/\S+)\s*$/m);
        // This header stops the connection from keeping the inspectee alive after its program ends.
        const ws = new WebSocket(url, { headers: { "Ref-Event-Loop": "0" } } as any);
        ws.onopen = () => connected.resolve({ send: message => ws.send(message), close: () => ws.close() });
        ws.onmessage = event => receive(String(event.data));
        ws.onerror = () => connected.reject(new Error("the inspector WebSocket failed"));
        ws.onclose = () => connected.reject(new Error("the inspector WebSocket closed"));
      }
      session.#transport = await Promise.race([connected.promise, session.#exited.promise]);

      const {
        breakpointsActive = true,
        pauseOnDebuggerStatements,
        pauseOnMicrotasks,
        breakpoints = [],
      } = options.handshake ?? {};
      await session.send("Inspector.enable");
      await session.send("Runtime.enable");
      await session.send("Debugger.enable");
      if (breakpointsActive !== null)
        await session.send("Debugger.setBreakpointsActive", { active: breakpointsActive });
      if (pauseOnDebuggerStatements) await session.send("Debugger.setPauseOnDebuggerStatements", { enabled: true });
      if (pauseOnMicrotasks) await session.send("Debugger.setPauseOnMicrotasks", { enabled: true });
      for (const { file, line } of breakpoints) {
        await session.send("Debugger.setBreakpointByUrl", {
          url: join(cwd, file),
          lineNumber: line - 1,
          columnNumber: 0,
        });
      }
      // The program runs from here. It can end before this answer arrives.
      session.send("Inspector.initialized").catch(() => {});
    } catch (error) {
      await session[Symbol.asyncDispose]();
      throw error;
    } finally {
      listener?.stop();
    }
    return session;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.#nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<any>();
    this.#pending.set(id, { resolve, reject });
    this.#transport!.send(JSON.stringify({ id, method, params }));
    return Promise.race([promise, this.#exited.promise]);
  }

  /**
   * The next pause. Rejects when the inspectee exits before it pauses again, or when it prints
   * `unless` first (for an inspectee that does not exit by itself).
   */
  async paused(unless?: RegExp): Promise<Pause> {
    while (this.#unread >= this.pauses.length) {
      if (unless?.test(this.stdout)) throw new Error(`the inspectee did not pause before it printed ${unless}`);
      await this.#woken();
    }
    return this.pauses[this.#unread++];
  }

  /** Resolves once `pattern` is in what the inspectee wrote to `sink`. Rejects when it exits first. */
  async output(sink: "stdout" | "stderr", pattern: RegExp): Promise<RegExpMatchArray> {
    for (;;) {
      const match = this[sink].match(pattern);
      if (match) return match;
      await this.#woken();
    }
  }

  /** `String(expression)` in the frame of `pause`, or the name of the error it throws. */
  async evaluate(pause: Pause, expression: string): Promise<string> {
    const { result } = await this.send("Debugger.evaluateOnCallFrame", {
      callFrameId: pause.callFrameId,
      expression: `(() => { try { return String(${expression}); } catch (e) { return e.name; } })()`,
      returnByValue: true,
    });
    return result.value;
  }

  async scriptSource(pause: Pause): Promise<string> {
    const { scriptSource } = await this.send("Debugger.getScriptSource", { scriptId: pause.scriptId });
    return scriptSource;
  }

  /** Resumes (or steps) and returns the pause that follows. */
  async resumeToPause(method = "Debugger.resume"): Promise<Pause> {
    await this.send(method);
    return await this.paused();
  }

  /** Lets the program run to its end: what it printed, its exit code, and every pause of the session. */
  async finish(resume = true) {
    // The inspectee may exit before it answers.
    if (resume) this.send("Debugger.resume").catch(() => {});
    const exitCode = await this.#proc.exited;
    await this.#drained;
    return { stdout: this.stdout, exitCode, pauses: this.pauses.map(where) };
  }

  disconnect() {
    this.#transport?.close();
  }

  /** The directory of the inspectee. */
  get cwd() {
    return realpathSync(String(this.#dir));
  }

  async [Symbol.asyncDispose]() {
    this.#transport?.close();
    this.#proc.kill();
    await this.#proc.exited;
    await this.#drained;
    this.#dir[Symbol.dispose]();
  }
}

const where = ({ reason, file, line, column }: Pause) => ({ reason, file, line, column });
const brk = "--inspect-brk=127.0.0.1:0";
const start = "PauseOnNextStatement";

// The fixture of https://github.com/oven-sh/bun/issues/32591.
const fiveLines = [
  'const label = "x";',
  "const values = [2, 3, 5];",
  "const total = values.reduce((s, v) => s + v, 0);",
  "const payload = { label, values, total };",
  "console.log(payload.total);",
  "",
].join("\n");

describe.concurrent("--inspect-brk", () => {
  test("pauses before the first statement of an ES module, with no opt-in for debugger statements", async () => {
    await using session = await Session.start({ "entry.mjs": `globalThis.ran = 1;\nconsole.log("done");\n` }, [
      brk,
      "entry.mjs",
    ]);
    const pause = await session.paused();
    expect(where(pause)).toEqual({ reason: start, file: "entry.mjs", line: 1, column: 1 });
    expect(await session.evaluate(pause, "typeof globalThis.ran")).toBe("undefined");
    expect(await session.finish()).toEqual({
      stdout: "done\n",
      exitCode: 0,
      pauses: [{ reason: start, file: "entry.mjs", line: 1, column: 1 }],
    });
  });

  test("BUN_INSPECT=<url>?break=1 pauses the same way", async () => {
    await using session = await Session.start(
      { "entry.mjs": `globalThis.ran = 1;\nconsole.log("done");\n` },
      ["entry.mjs"],
      { breakFromEnv: true },
    );
    const pause = await session.paused(/^done$/m);
    expect(where(pause)).toEqual({ reason: start, file: "entry.mjs", line: 1, column: 1 });
    expect(await session.evaluate(pause, "typeof globalThis.ran")).toBe("undefined");
    // This connection keeps the inspectee alive, so the end of the program is what it printed.
    await session.send("Debugger.resume");
    await session.output("stdout", /^done$/m);
    expect(session.pauses).toHaveLength(1);
  });

  test("pauses in a CommonJS entry before its first statement", async () => {
    await using session = await Session.start(
      { "entry.cjs": `globalThis.ran = 1;\nmodule.exports = 2;\nconsole.log("done");\n` },
      [brk, "entry.cjs"],
    );
    const pause = await session.paused();
    expect({ reason: pause.reason, file: pause.file, line: pause.line }).toEqual({
      reason: start,
      file: "entry.cjs",
      line: 1,
    });
    // The frame is the module's function: its arguments are there, and nothing of its body ran.
    expect(await session.evaluate(pause, "[typeof module, typeof require, typeof globalThis.ran]")).toBe(
      "object,function,undefined",
    );
    expect(await session.finish()).toMatchObject({ stdout: "done\n", exitCode: 0 });
    expect(session.pauses).toHaveLength(1);
  });

  test("pauses in a TypeScript entry", async () => {
    await using session = await Session.start(
      { "entry.ts": `const n: number = 1;\nglobalThis.ran = n;\nconsole.log("done");\n` },
      [brk, "entry.ts"],
    );
    const pause = await session.paused();
    expect(where(pause)).toEqual({ reason: start, file: "entry.ts", line: 1, column: 1 });
    expect(await session.evaluate(pause, "typeof n")).toBe("ReferenceError");
    expect(await session.finish()).toMatchObject({ stdout: "done\n", exitCode: 0 });
    expect(session.pauses).toHaveLength(1);
  });

  test("pauses at the start of -e code, not in a builtin module that it loads", async () => {
    await using session = await Session.start({}, [
      brk,
      "-e",
      `const fs = require("fs"); globalThis.ran = 1; console.log(typeof fs.readFileSync);`,
    ]);
    const pause = await session.paused();
    expect(where(pause)).toEqual({ reason: start, file: "[eval]", line: 1, column: 1 });
    expect(await session.evaluate(pause, "typeof globalThis.ran")).toBe("undefined");
    expect(await session.finish()).toMatchObject({ stdout: "function\n", exitCode: 0 });
    expect(session.pauses).toHaveLength(1);
  });

  test("pauses at the start of -e code that is an ES module", async () => {
    await using session = await Session.start({}, [
      brk,
      "-e",
      `import { sep } from "node:path"; globalThis.ran = 1; console.log(typeof sep);`,
    ]);
    const pause = await session.paused();
    expect(where(pause)).toEqual({ reason: start, file: "[eval]", line: 1, column: 1 });
    expect(await session.evaluate(pause, "typeof globalThis.ran")).toBe("undefined");
    expect(await session.finish()).toMatchObject({ stdout: "string\n", exitCode: 0 });
    expect(session.pauses).toHaveLength(1);
  });

  test("pauses at the start of a script from stdin", async () => {
    await using session = await Session.start({}, [brk, "-"], {
      stdin: `globalThis.ran = 1;\nconsole.log("done");\n`,
    });
    const pause = await session.paused();
    expect(where(pause)).toEqual({ reason: start, file: "[stdin]", line: 1, column: 1 });
    expect(await session.evaluate(pause, "typeof globalThis.ran")).toBe("undefined");
    expect(await session.finish()).toMatchObject({ stdout: "done\n", exitCode: 0 });
    expect(session.pauses).toHaveLength(1);
  });

  // The parser does not read an entry with the `// @bun` pragma (the output of `bun build --target=bun`).
  test.each([
    ["// @bun", `// @bun\nglobalThis.ran = 1;\nconsole.log("done");\n`],
    [
      "// @bun @bun-cjs",
      `// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {globalThis.ran = 1;\nconsole.log("done");\n})\n`,
    ],
  ])("pauses in an entry that starts with %s", async (_pragma, source) => {
    await using session = await Session.start({ "entry.js": source }, [brk, "entry.js"]);
    const pause = await session.paused();
    expect({ reason: pause.reason, file: pause.file }).toEqual({ reason: start, file: "entry.js" });
    expect(await session.evaluate(pause, "typeof globalThis.ran")).toBe("undefined");
    expect(await session.finish()).toMatchObject({ stdout: "done\n", exitCode: 0 });
    expect(session.pauses).toHaveLength(1);
  });

  test("an entry that starts with a class pauses before the class", async () => {
    await using session = await Session.start(
      {
        "entry.mjs": `class Foo { static x = compute(); }\nfunction compute() { return 1; }\nconsole.log(Foo.x);\n`,
      },
      [brk, "entry.mjs"],
    );
    const pause = await session.paused();
    expect(where(pause)).toEqual({ reason: start, file: "entry.mjs", line: 1, column: 1 });
    expect(await session.evaluate(pause, "typeof Foo")).toBe("ReferenceError");
    expect(await session.finish()).toMatchObject({ stdout: "1\n", exitCode: 0 });
    expect(session.pauses).toHaveLength(1);
  });

  test("a preload does not take the pause", async () => {
    await using session = await Session.start(
      { "preload.mjs": `globalThis.preloaded = 1;\n`, "entry.mjs": `console.log(globalThis.preloaded);\n` },
      [brk, "--preload", "./preload.mjs", "entry.mjs"],
    );
    const pause = await session.paused();
    expect(where(pause)).toEqual({ reason: start, file: "entry.mjs", line: 1, column: 1 });
    expect(await session.evaluate(pause, "globalThis.preloaded")).toBe("1");
    expect(await session.finish()).toMatchObject({ stdout: "1\n", exitCode: 0 });
    expect(session.pauses).toHaveLength(1);
  });

  test("a preload that imports the entry does not lose the pause", async () => {
    await using session = await Session.start(
      {
        "preload.mjs": `await import("./entry.mjs");\n`,
        "entry.mjs": `globalThis.ran = 1;\nconsole.log("done");\n`,
      },
      [brk, "--preload", "./preload.mjs", "entry.mjs"],
    );
    const pause = await session.paused();
    expect(where(pause)).toEqual({ reason: start, file: "entry.mjs", line: 1, column: 1 });
    expect(await session.evaluate(pause, "typeof globalThis.ran")).toBe("undefined");
    expect(await session.finish()).toMatchObject({ stdout: "done\n", exitCode: 0 });
    expect(session.pauses).toHaveLength(1);
  });

  test("a patched Module.runMain that loads the entry later does not lose the pause", async () => {
    await using session = await Session.start(
      {
        "preload.cjs": `require("module").runMain = () => {\n  setImmediate(() => require(process.argv[1]));\n};\n`,
        "entry.cjs": `globalThis.ran = 1;\nconsole.log("done");\n`,
      },
      [brk, "--preload", "./preload.cjs", "entry.cjs"],
    );
    const pause = await session.paused();
    expect({ reason: pause.reason, file: pause.file, line: pause.line }).toEqual({
      reason: start,
      file: "entry.cjs",
      line: 1,
    });
    expect(await session.evaluate(pause, "typeof globalThis.ran")).toBe("undefined");
    expect(await session.finish()).toMatchObject({ stdout: "done\n", exitCode: 0 });
    expect(session.pauses).toHaveLength(1);
  });

  test("a dependency that calls a function of the entry first does not take the pause", async () => {
    await using session = await Session.start(
      {
        "dep.mjs": `import { early } from "./entry.mjs";\nglobalThis.fromDep = early();\n`,
        "entry.mjs": `import "./dep.mjs";\nexport function early() {\n  return 41;\n}\nconsole.log(globalThis.fromDep + 1);\n`,
      },
      [brk, "entry.mjs"],
    );
    // The import cycle runs `early` before the module code of the entry. The pause is for the module code.
    const pause = await session.paused();
    expect(where(pause)).toEqual({ reason: start, file: "entry.mjs", line: 1, column: 1 });
    expect(await session.evaluate(pause, "globalThis.fromDep")).toBe("41");
    expect(await session.finish()).toMatchObject({ stdout: "42\n", exitCode: 0 });
    expect(session.pauses).toHaveLength(1);
  });

  test("bun test pauses in the first test file only", async () => {
    const testFile = `import { expect, test } from "bun:test";\nglobalThis.ran = 1;\ntest("t", () => {\n  expect(1).toBe(1);\n});\n`;
    await using session = await Session.start({ "a.test.js": testFile, "b.test.js": testFile }, [
      brk,
      "test",
      "./a.test.js",
      "./b.test.js",
    ]);
    const pause = await session.paused();
    expect(where(pause)).toEqual({ reason: start, file: "a.test.js", line: 1, column: 1 });
    expect(await session.evaluate(pause, "typeof globalThis.ran")).toBe("undefined");
    expect(await session.finish()).toMatchObject({ exitCode: 0 });
    expect(session.stderr).toContain("2 pass");
    expect(session.pauses).toHaveLength(1);
  });

  test("a --hot reload does not pause again", async () => {
    await using session = await Session.start({ "entry.mjs": `console.log("first");\n` }, [brk, "--hot", "entry.mjs"]);
    expect(where(await session.paused(/^first$/m))).toEqual({
      reason: start,
      file: "entry.mjs",
      line: 1,
      column: 1,
    });
    await session.send("Debugger.resume");
    await session.output("stdout", /^first$/m);

    // A second pause would hold the reloaded entry before it prints.
    writeFileSync(join(session.cwd, "entry.mjs"), `console.log("second");\n`);
    await session.output("stdout", /^second$/m);
    // The same after a reload that failed to parse.
    writeFileSync(join(session.cwd, "entry.mjs"), `console.log("third";\n`);
    await session.output("stderr", /error: /);
    writeFileSync(join(session.cwd, "entry.mjs"), `console.log("fourth");\n`);
    await session.output("stdout", /^fourth$/m);
    expect(session.pauses).toHaveLength(1);
  });

  test("an empty entry pauses once", async () => {
    await using session = await Session.start({ "entry.mjs": "" }, [brk, "entry.mjs"]);
    const pause = await session.paused();
    expect({ reason: pause.reason, file: pause.file }).toEqual({ reason: start, file: "entry.mjs" });
    expect(await session.finish()).toMatchObject({ stdout: "", exitCode: 0 });
    expect(session.pauses).toHaveLength(1);
  });

  describe("handshake", () => {
    const files = { "entry.mjs": `debugger;\nconsole.log("done");\n` };

    // Code has debug hooks only while breakpoints are active, so nothing can pause without them.
    test.each([
      ["Debugger.setBreakpointsActive{active:false}", false],
      ["no Debugger.setBreakpointsActive", null],
    ])("%s: no pause", async (_name, breakpointsActive) => {
      await using session = await Session.start(files, [brk, "entry.mjs"], { handshake: { breakpointsActive } });
      expect(await session.finish(false)).toEqual({ stdout: "done\n", exitCode: 0, pauses: [] });
    });

    test("without Debugger.setPauseOnDebuggerStatements, a debugger statement of the program does not pause", async () => {
      await using session = await Session.start(files, [brk, "entry.mjs"]);
      await session.paused();
      expect(await session.finish()).toEqual({
        stdout: "done\n",
        exitCode: 0,
        pauses: [{ reason: start, file: "entry.mjs", line: 1, column: 1 }],
      });
    });

    test("with Debugger.setPauseOnDebuggerStatements, a debugger statement on line 1 pauses after the start pause", async () => {
      await using session = await Session.start(files, [brk, "entry.mjs"], {
        handshake: { pauseOnDebuggerStatements: true },
      });
      await session.paused();
      expect(where(await session.resumeToPause())).toEqual({
        reason: "DebuggerStatement",
        file: "entry.mjs",
        line: 1,
        column: 1,
      });
      expect(await session.finish()).toMatchObject({ stdout: "done\n", exitCode: 0 });
      expect(session.pauses).toHaveLength(2);
    });
  });

  describe("after the pause", () => {
    const files = { "entry.mjs": `const a = 1;\nconst b = a + 1;\nconsole.log(a + b);\n` };

    test("a step goes to the second statement", async () => {
      await using session = await Session.start(files, [brk, "entry.mjs"]);
      const first = await session.paused();
      const second = await session.resumeToPause("Debugger.stepNext");
      // The first statement ran and the second did not: the step did not stop at 1:1 again.
      expect([await session.evaluate(second, "a"), await session.evaluate(second, "b")]).toEqual([
        "1",
        "ReferenceError",
      ]);
      const third = await session.resumeToPause("Debugger.stepNext");
      expect([first, second, third].map(({ line, column }) => `${line}:${column}`)).toEqual(["1:1", "2:1", "3:1"]);
      expect(await session.finish()).toMatchObject({ stdout: "3\n", exitCode: 0 });
    });

    // A client that puts a breakpoint at the start of a script (the VS Code extension does, to
    // hold the script until its breakpoints are in place) can still tell the pause it asked for.
    test("a breakpoint on the first line is the same pause, with the reason of the start pause", async () => {
      await using session = await Session.start(files, [brk, "entry.mjs"], {
        handshake: { breakpoints: [{ file: "entry.mjs", line: 1 }] },
      });
      const pause = await session.paused();
      expect(where(pause)).toEqual({ reason: start, file: "entry.mjs", line: 1, column: 1 });
      expect(await session.evaluate(pause, "typeof a")).toBe("ReferenceError");
      expect(await session.finish()).toMatchObject({ stdout: "3\n", exitCode: 0 });
      expect(session.pauses).toHaveLength(1);
    });

    test("a breakpoint on the line of a CommonJS module's function does not rename the pause", async () => {
      await using session = await Session.start(
        { "entry.cjs": `globalThis.ran = 1;\nconsole.log("done");\n` },
        [brk, "entry.cjs"],
        { handshake: { breakpoints: [{ file: "entry.cjs", line: 1 }] } },
      );
      // The program that makes the module's function is on that line too, and it is not the entry's code.
      const program = await session.paused();
      expect({ reason: program.reason, file: program.file, line: program.line }).toEqual({
        reason: "Breakpoint",
        file: "entry.cjs",
        line: 1,
      });
      const pause = await session.resumeToPause();
      expect({ reason: pause.reason, file: pause.file, line: pause.line }).toEqual({
        reason: start,
        file: "entry.cjs",
        line: 1,
      });
      expect(await session.evaluate(pause, "[typeof module, typeof globalThis.ran]")).toBe("object,undefined");
      expect(await session.finish()).toMatchObject({ stdout: "done\n", exitCode: 0 });
      expect(session.pauses).toHaveLength(2);
    });

    test("an entry that started with breakpoints inactive does not pause later", async () => {
      await using session = await Session.start(
        {
          "entry.cjs": `console.log("started");\nconst timer = setInterval(() => {\n  if (!globalThis.breakpointsAreBack) return;\n  clearInterval(timer);\n  console.log("ran on");\n}, 1);\n`,
        },
        [brk, "entry.cjs"],
        { handshake: { breakpoints: [{ file: "entry.cjs", line: 1 }] } },
      );
      // The breakpoint stops in the program that makes the module's function, before the entry starts.
      expect((await session.paused()).reason).toBe("Breakpoint");
      await session.send("Debugger.setBreakpointsActive", { active: false });
      await session.send("Debugger.resume");
      await session.output("stdout", /^started$/m);
      // The timer callback is a function of the entry, and it is compiled again with debug hooks.
      await session.send("Debugger.setBreakpointsActive", { active: true });
      await session.send("Runtime.evaluate", { expression: "globalThis.breakpointsAreBack = true" });
      const outcome = await Promise.race([
        session.output("stdout", /^ran on$/m).then(() => "ran on"),
        session.paused().then(where),
      ]);
      expect(outcome).toBe("ran on");
      expect(await session.finish(false)).toMatchObject({ exitCode: 0 });
      expect(session.pauses).toHaveLength(1);
    });

    test("the program runs on when the debugger disconnects", async () => {
      await using session = await Session.start(files, [brk, "entry.mjs"]);
      await session.paused();
      session.disconnect();
      expect(await session.finish(false)).toMatchObject({ stdout: "3\n", exitCode: 0 });
    });

    // https://github.com/oven-sh/bun/issues/32591
    test("the entry has the text it has under --inspect-wait, so a breakpoint by line stops on that line", async () => {
      await using session = await Session.start({ "entry.mjs": fiveLines }, [brk, "entry.mjs"], {
        handshake: { breakpoints: [{ file: "entry.mjs", line: 5 }] },
      });
      const first = await session.paused();
      expect((await session.scriptSource(first)).split("\n").slice(0, 5)).toEqual([
        `const label = "x";`,
        `const values = [2, 3, 5];`,
        `const total = values.reduce((s, v) => s + v, 0);`,
        `const payload = { label: "x", values, total };`,
        `console.log(payload.total);`,
      ]);
      const atBreakpoint = await session.resumeToPause();
      expect(where(atBreakpoint)).toEqual({ reason: "Breakpoint", file: "entry.mjs", line: 5, column: 1 });
      // Line 4 ran: the bug was a pause one statement early, with `payload` not initialised.
      expect(await session.evaluate(atBreakpoint, "payload.total")).toBe("10");
      expect(await session.finish()).toMatchObject({ stdout: "10\n", exitCode: 0 });
      expect(session.pauses).toHaveLength(2);
    });
  });
});

// After the block above: each of these writes and runs an executable of the size of bun.
describe.concurrent("--inspect-brk in a compiled executable", () => {
  // Nothing transpiles the entry of an executable, with or without its bytecode.
  test.each([[[] as string[]], [["--bytecode", "--format=esm"]]])(
    "BUN_INSPECT=<url>?break=1 pauses in a bun build --compile %j executable",
    async flags => {
      using dir = tempDir("inspect-brk-compile", { "entry.ts": `globalThis.ran = 1;\nconsole.log("done");\n` });
      const exe = join(String(dir), isWindows ? "app.exe" : "app");
      await using build = spawn({
        cmd: [bunExe(), "build", "--compile", ...flags, join(String(dir), "entry.ts"), "--outfile", exe],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
        build.stdout.text(),
        build.stderr.text(),
        build.exited,
      ]);
      expect(buildStdout + buildStderr).toContain("compile");
      expect(buildExitCode).toBe(0);

      await using session = await Session.start({}, [], { exe, breakFromEnv: true });
      const pause = await session.paused(/^done$/m);
      expect({ reason: pause.reason, file: pause.file }).toEqual({ reason: start, file: basename(exe) });
      expect(await session.evaluate(pause, "typeof globalThis.ran")).toBe("undefined");
      await session.send("Debugger.resume");
      await session.output("stdout", /^done$/m);
      expect(session.pauses).toHaveLength(1);
    },
    60_000,
  );
});
