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
    proc.exited.then(code => fail(new Error(`inspectee exited (${code})`)), fail);

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

// A line break ends a `//` comment. If the runtime writes a module's path into
// one, the text after the line break is a statement that sets a global. It is
// one `var` statement, which has no completion value, so the function wrapper
// of a CommonJS module stays the result of its script.
const nameWithCode = (id: string, lineBreak: string, ext: string) =>
  `${id}${lineBreak}var x = (globalThis.${id} = 'ran'), y = { ${ext}: 1 }, z = y.${ext}`;

async function runMain(cwd: string, ...args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, exitCode };
}

// A Windows file name cannot contain LF or CR.
test.concurrent.skipIf(isWindows).each([
  ["LF", "--inspect", "\n"],
  ["CR", "--inspect", "\r"],
  ["LF", "inspector.open()", "\n"],
  ["CR", "inspector.open()", "\r"],
])("%s in a module path does not run the rest of the path as code under %s", async (_, entryPoint, lineBreak) => {
  const esm = nameWithCode("esm", lineBreak, "mjs");
  const cjs = nameWithCode("cjs", lineBreak, "cjs");
  using dir = tempDir("inspect-path-line-break", {
    [esm]: "export default 'esm';",
    [cjs]: "module.exports = 'cjs';",
    "main.mjs": `
      import inspector from "node:inspector";
      import { createRequire } from "node:module";
      const open = process.argv[2] === "open";
      if (open) inspector.open(0, "127.0.0.1", false);
      const { default: a } = await import(${JSON.stringify("./" + esm)});
      const b = createRequire(import.meta.url)(${JSON.stringify("./" + cjs)});
      console.log(JSON.stringify({ loaded: [a, b], ran: { esm: globalThis.esm, cjs: globalThis.cjs } }));
      if (open) inspector.close();
    `,
  });

  const args = entryPoint === "--inspect" ? ["--inspect=127.0.0.1:0", "main.mjs"] : ["main.mjs", "open"];
  expect(await runMain(String(dir), ...args)).toEqual({ stdout: '{"loaded":["esm","cjs"],"ran":{}}\n', exitCode: 0 });
});

// A module that a plugin serves has no file, so these cases run on every platform.
test.concurrent.each([
  ["LF", "\n"],
  ["CR", "\r"],
])("%s in a plugin module id does not run the rest of the id as code under --inspect", async (_, lineBreak) => {
  const viaModule = "virtual:" + nameWithCode("viaModule", lineBreak, "js");
  const viaOnLoad = "ns:" + nameWithCode("viaOnLoad", lineBreak, "js");
  using dir = tempDir("inspect-plugin-id-line-break", {
    "main.mjs": `
      Bun.plugin({
        name: "module ids with a line break",
        setup(build) {
          build.module(${JSON.stringify(viaModule)}, () => ({ contents: "export default 'module';", loader: "js" }));
          build.onResolve({ filter: /.*/, namespace: "ns" }, ({ path }) => ({ path, namespace: "ns" }));
          build.onLoad({ filter: /.*/, namespace: "ns" }, () => ({ contents: "export default 'onLoad';", loader: "js" }));
        },
      });
      const { default: a } = await import(${JSON.stringify(viaModule)});
      const { default: b } = await import(${JSON.stringify(viaOnLoad)});
      console.log(JSON.stringify({ loaded: [a, b], ran: { viaModule: globalThis.viaModule, viaOnLoad: globalThis.viaOnLoad } }));
    `,
  });

  expect(await runMain(String(dir), "--inspect=127.0.0.1:0", "main.mjs")).toEqual({
    stdout: '{"loaded":["module","onLoad"],"ran":{}}\n',
    exitCode: 0,
  });
});

// The non-ASCII names below have no space, quote or 0xA0 byte in UTF-8 (as in
// `à` or `根`). JSC discards a `//# sourceURL=` value that has one, and these
// tests would then pass with the comment back in place.
test.concurrent("--inspect reports the path and position of a frame in a non-ASCII directory", async () => {
  using dir = tempDir("inspect-non-ascii-path", {
    "sub-é-中/target.mjs": "\nconsole.log(new Error('x').stack.split('\\n')[1]);\n",
  });
  const target = join("sub-é-中", "target.mjs");

  const { stdout, exitCode } = await runMain(String(dir), "--inspect=127.0.0.1:0", target);
  expect(stdout.trimEnd()).toEndWith(target + ":2:17");
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/15035
// Not concurrent: when a test times out, bun:test kills its child processes only
// if it runs alone, and this inspectee waits for a debugger.
test.each([
  ["directory", "script_español/index.js", "script_español[\\\\/]index\\.js$"],
  ["file name", "ñ.ts", "[\\\\/]ñ\\.ts$"],
])("--inspect-wait binds a breakpoint set by URL for a non-ASCII %s", async (_, file, urlRegex) => {
  using dir = tempDir("inspect-non-ascii-breakpoint", {
    [file]: 'console.log("1");\nconsole.log("2");\nconsole.log("3");\nprocess.exit(0);\n',
  });
  const cwd = fs.realpathSync(String(dir));

  await using session = await inspect(cwd, join(file));
  await Promise.all([session.send("Inspector.enable"), session.send("Debugger.enable")]);
  await session.send("Debugger.setBreakpointsActive", { active: true });
  // An editor sets its breakpoints before the script is parsed. `urlRegex` keeps
  // the test independent of how the platform spells the temporary directory.
  await session.send("Debugger.setBreakpointByUrl", { urlRegex, lineNumber: 1 });
  const paused = session.event("Debugger.paused");
  session.send("Inspector.initialized").catch(() => {});

  // If the breakpoint does not bind, the script reaches `process.exit(0)` and this rejects.
  const { reason, callFrames } = await paused;
  expect({ reason, lineNumber: callFrames[0].location.lineNumber }).toEqual({ reason: "Breakpoint", lineNumber: 1 });

  session.send("Debugger.resume").catch(() => {});
  const [stdout, exitCode] = await Promise.all([session.proc.stdout.text(), session.proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "1\n2\n3\n", exitCode: 0 });
});
