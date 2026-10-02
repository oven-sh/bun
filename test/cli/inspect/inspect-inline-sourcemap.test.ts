import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { SourceMapConsumer } from "source-map";
import { WebSocket } from "ws";

// Starts `entry` under --inspect-wait, connects, and returns its
// Debugger.scriptParsed event together with the inline source map the runtime
// transpiler attached to it.
async function runtimeSourceMap(files: Record<string, string>, entry: string) {
  using dir = tempDir("inspect-sourcemap", files);
  const cwd = fs.realpathSync(String(dir));

  await using proc = spawn({
    cmd: [bunExe(), "--inspect-wait=127.0.0.1:0", entry],
    env: bunEnv,
    cwd,
    stdout: "ignore",
    stderr: "pipe",
  });

  let url: URL | undefined;
  let stderr = "";
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr as ReadableStream) {
    stderr += decoder.decode(chunk);
    for (const line of stderr.split("\n")) {
      try {
        url = new URL(line);
      } catch {}
      if (url?.protocol.includes("ws")) break;
    }
    if (stderr.includes("Listening:")) break;
  }
  if (!url) {
    process.stderr.write(stderr);
    throw new Error("Unable to find listening URL");
  }

  const ws = new WebSocket(url);
  try {
    const failed = new Promise<never>((_, reject) => {
      ws.addEventListener("error", cause => reject(new Error("WebSocket error", { cause })));
      ws.addEventListener("close", cause => reject(new Error("WebSocket closed", { cause })));
      proc.exited.then(code => reject(new Error(`inspectee exited (${code})`)));
    });
    failed.catch(() => {});

    await Promise.race([new Promise<void>(resolve => ws.addEventListener("open", () => resolve())), failed]);

    const entryFile = entry.split(/[\\/]/).pop()!;
    const pending = new Map<number, (v: any) => void>();
    const scriptParsed = new Promise<any>(resolve => {
      ws.addEventListener("message", ({ data }) => {
        const msg = JSON.parse(data.toString());
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        } else if (msg.method === "Debugger.scriptParsed" && String(msg.params?.url ?? "").endsWith(entryFile)) {
          resolve(msg.params);
        }
      });
    });
    let nextId = 0;
    const send = (method: string, params: Record<string, unknown> = {}) =>
      Promise.race([
        new Promise<any>(resolve => {
          const id = ++nextId;
          pending.set(id, resolve);
          ws.send(JSON.stringify({ id, method, params }));
        }),
        failed,
      ]);

    await Promise.all([send("Inspector.enable"), send("Debugger.enable")]);
    send("Inspector.initialized").catch(() => {});
    const params = await Promise.race([scriptParsed, failed]);

    const m = String(params.sourceMapURL ?? "").match(/base64,([A-Za-z0-9+/=]+)/);
    expect(m).not.toBeNull();
    const raw = Buffer.from(m![1], "base64").toString();
    return { cwd, params, raw, map: JSON.parse(raw) };
  } finally {
    ws.close();
  }
}

type Mapping = { generatedLine: number; generatedColumn: number; originalLine: number; originalColumn: number };

async function mappingsOf(map: any): Promise<Mapping[]> {
  const found: Mapping[] = [];
  await SourceMapConsumer.with(map, null, consumer => {
    consumer.eachMapping(({ generatedLine, generatedColumn, originalLine, originalColumn }) => {
      found.push({ generatedLine, generatedColumn, originalLine, originalColumn });
    });
  });
  return found;
}

test("--inspect inline sourcemap sources[0] is a valid path under cwd", async () => {
  // VT (0x0B) / BEL (0x07) in the source exercise quote_for_json's RFC 8259
  // escape handling for sourcesContent.
  const source = "// comment [\x0b\x07]\nsetInterval(() => {}, 200);\n";
  const { raw, map } = await runtimeSourceMap({ "sub/target.mjs": source }, join("sub", "target.mjs"));
  expect(raw).not.toMatch(/\\v|\\x[0-9A-Fa-f]{2}/);
  expect(map.sources[0]).toBe("/sub/target.mjs");
  expect(map.sourcesContent[0]).toBe(source);
});

test("--inspect inline sourcemap for a module in a non-ASCII directory", async () => {
  // The regex makes the module's transpiled text UTF-16, so the source map
  // comment is appended to, and has to be found in, a 16-bit string. The
  // script's URL comes from the module loader; no sourceURL comment is added.
  const source = "const re = /中/u;\nsetInterval(() => {}, 200);\n";
  const { cwd, params, map } = await runtimeSourceMap(
    { "sub-é-中/target.mjs": source },
    join("sub-é-中", "target.mjs"),
  );
  expect(params.url).toBe(join(cwd, "sub-é-中", "target.mjs"));
  expect(map.sources[0]).toBe("/sub-é-中/target.mjs");
  expect(map.sourcesContent[0]).toBe(source);
});

// The runtime transpiler prints this line exactly as written, so every mapping
// on it must have equal generated and original columns, and since each
// variant's texts occupy the same number of UTF-16 code units, the variants
// must produce the same mappings as each other. The regex is the first
// non-ASCII text of its module: the 8-bit variant pins that a Latin-1 buffer is
// counted one column per byte after it, and the widening variant pins that the
// buffer is counted in code units from the point where the regex widened it
// (astral text counting two), including the raw template text written after
// the switch.
describe.concurrent("--inspect inline sourcemap columns after verbatim text", () => {
  test.each([
    ["ASCII", "xyz", "w"],
    ["8-bit", "éÿ©", "ü"],
    ["widening", "中🐰", "é"],
  ])("%s", async (_name, regexText, rawText) => {
    const line = `const x = [/${regexText}/u, new Error("b"), String.raw\`${rawText}\`, f()];`;
    const source = `function f() {}\n${line}\nsetInterval(() => {}, 200);\n`;
    const { map } = await runtimeSourceMap({ "target.mjs": source }, "target.mjs");

    const onLine = (await mappingsOf(map)).filter(m => m.generatedLine === 2);
    const columns = onLine.map(m => m.generatedColumn);
    expect(onLine).toEqual(
      columns.map(column => ({ generatedLine: 2, generatedColumn: column, originalLine: 2, originalColumn: column })),
    );
    // Expressions after the regex (and, for `f()`, after the raw text) are
    // mapped at their own columns.
    expect(columns).toContain(line.indexOf("new Error"));
    expect(columns).toContain(line.indexOf("String.raw"));
    expect(columns).toContain(line.indexOf("f()"));
  });
});
