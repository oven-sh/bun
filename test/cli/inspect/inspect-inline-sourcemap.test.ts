import { spawn } from "bun";
import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { WebSocket } from "ws";

// Starts `bun --inspect-wait <entry>` in `cwd` and attaches to its inspector.
// A socket error, a socket close, or the exit of the inspectee rejects every
// promise that `send` and `event` return.
async function inspect(cwd: string, entry: string) {
  const proc = spawn({
    cmd: [bunExe(), "--inspect-wait=127.0.0.1:0", entry],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let ws: WebSocket | undefined;
  const dispose = async () => {
    ws?.close();
    proc.kill();
    await proc.exited;
  };

  try {
    let stderr = "";
    let url: string | undefined;
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr as ReadableStream) {
      stderr += decoder.decode(chunk, { stream: true });
      url = stderr.match(/^\s*(ws:\/\/\S+)\s*\n/m)?.[1];
      if (url) break;
    }
    if (!url) throw new Error("Unable to find listening URL in: " + JSON.stringify(stderr));

    const socket = (ws = new WebSocket(url));
    const { promise: failed, reject: fail } = Promise.withResolvers<never>();
    failed.catch(() => {});
    socket.addEventListener("error", cause => fail(new Error("WebSocket error", { cause })));
    socket.addEventListener("close", cause => fail(new Error("WebSocket closed", { cause })));
    proc.exited.then(code => fail(new Error(`inspectee exited (${code})`)));

    await Promise.race([new Promise<void>(resolve => socket.addEventListener("open", () => resolve())), failed]);

    const pending = new Map<number, (msg: any) => void>();
    const waiters: { method: string; match: (params: any) => boolean; resolve: (params: any) => void }[] = [];
    socket.addEventListener("message", ({ data }) => {
      const msg = JSON.parse(data.toString());
      if (typeof msg.id === "number") {
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
        return;
      }
      const i = waiters.findIndex(w => w.method === msg.method && w.match(msg.params));
      if (i !== -1) waiters.splice(i, 1)[0].resolve(msg.params);
    });

    let nextId = 0;
    return {
      proc,
      send: (method: string, params: Record<string, unknown> = {}) =>
        Promise.race([
          new Promise<any>(resolve => {
            const id = ++nextId;
            pending.set(id, resolve);
            socket.send(JSON.stringify({ id, method, params }));
          }),
          failed,
        ]),
      // Resolves with the params of the next `method` event that `match` accepts.
      event: (method: string, match: (params: any) => boolean = () => true) =>
        Promise.race([new Promise<any>(resolve => waiters.push({ method, match, resolve })), failed]),
      [Symbol.asyncDispose]: dispose,
    };
  } catch (e) {
    await dispose();
    throw e;
  }
}

test("--inspect inline sourcemap sources[0] is a valid path under cwd", async () => {
  // VT (0x0B) / BEL (0x07) in the source exercise quote_for_json's RFC 8259
  // escape handling for sourcesContent.
  const source = "// comment [\x0b\x07]\nsetInterval(() => {}, 200);\n";
  using dir = tempDir("inspect-sourcemap", {
    "sub/target.mjs": source,
  });
  const cwd = fs.realpathSync(String(dir));

  await using session = await inspect(cwd, join("sub", "target.mjs"));
  const scriptParsed = session.event("Debugger.scriptParsed", p => String(p?.url ?? "").endsWith("target.mjs"));
  await Promise.all([session.send("Inspector.enable"), session.send("Debugger.enable")]);
  session.send("Inspector.initialized").catch(() => {});
  const params = await scriptParsed;

  const m = String(params.sourceMapURL ?? "").match(/base64,([A-Za-z0-9+/=]+)/);
  expect(m).not.toBeNull();
  const raw = Buffer.from(m![1], "base64").toString();
  expect(raw).not.toMatch(/\\v|\\x[0-9A-Fa-f]{2}/);
  const map = JSON.parse(raw);

  expect(map.sources[0]).toBe("/sub/target.mjs");
  expect(map.sourcesContent[0]).toBe(source);
});

// A Windows file name cannot contain LF or CR.
test.concurrent.skipIf(isWindows).each([
  ["LF", "\n"],
  ["CR", "\r"],
])("--inspect does not run the part of a module path after a %s as code", async (_, lineBreak) => {
  // A line break ends a `//` comment. If the runtime writes the path into one,
  // the rest of the file name is a statement that sets a global. It is one
  // `var` statement, which has no completion value, so the function wrapper
  // of the CommonJS module stays the result of its script.
  const name = (id: string, ext: string) =>
    `${id}${lineBreak}var x = (globalThis.${id} = 'ran'), y = { ${ext}: 1 }, z = y.${ext}`;
  const esm = name("esm", "mjs");
  const cjs = name("cjs", "cjs");
  using dir = tempDir("inspect-path-line-break", {
    [esm]: "export default 'esm';",
    [cjs]: "module.exports = 'cjs';",
    "main.mjs": `
      import a from ${JSON.stringify("./" + esm)};
      import { createRequire } from "node:module";
      const b = createRequire(import.meta.url)(${JSON.stringify("./" + cjs)});
      console.log(JSON.stringify({ loaded: [a, b], ran: { esm: globalThis.esm, cjs: globalThis.cjs } }));
    `,
  });

  await using proc = spawn({
    cmd: [bunExe(), "--inspect=127.0.0.1:0", "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, exitCode }).toEqual({ stdout: '{"loaded":["esm","cjs"],"ran":{}}\n', exitCode: 0 });
});

test.concurrent("--inspect reports the path and position of a frame in a non-ASCII directory", async () => {
  using dir = tempDir("inspect-non-ascii-path", {
    "sub-é-中/target.mjs": "\nconsole.log(new Error('x').stack.split('\\n')[1]);\n",
  });
  const target = join("sub-é-中", "target.mjs");

  await using proc = spawn({
    cmd: [bunExe(), "--inspect=127.0.0.1:0", target],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trimEnd()).toEndWith(target + ":2:17");
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/15035
test.concurrent("--inspect-wait binds a breakpoint set by URL in a non-ASCII directory", async () => {
  using dir = tempDir("inspect-non-ascii-breakpoint", {
    "script_español/index.js": 'console.log("1");\nconsole.log("2");\nconsole.log("3");\nprocess.exit(0);\n',
  });
  const cwd = fs.realpathSync(String(dir));

  await using session = await inspect(cwd, join("script_español", "index.js"));
  await Promise.all([session.send("Inspector.enable"), session.send("Debugger.enable")]);
  await session.send("Debugger.setBreakpointsActive", { active: true });
  // An editor sets its breakpoints before the script is parsed. `urlRegex` keeps
  // the test independent of how the platform spells the temporary directory.
  await session.send("Debugger.setBreakpointByUrl", { urlRegex: "script_español[\\\\/]index\\.js$", lineNumber: 1 });
  const paused = session.event("Debugger.paused");
  session.send("Inspector.initialized").catch(() => {});

  // If the breakpoint does not bind, the script reaches `process.exit(0)` and this rejects.
  const { reason, callFrames } = await paused;
  expect({ reason, lineNumber: callFrames[0].location.lineNumber }).toEqual({ reason: "Breakpoint", lineNumber: 1 });

  session.send("Debugger.resume").catch(() => {});
  const [stdout, exitCode] = await Promise.all([session.proc.stdout.text(), session.proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "1\n2\n3\n", exitCode: 0 });
});
