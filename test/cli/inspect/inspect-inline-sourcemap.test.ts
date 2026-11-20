import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { SourceMapConsumer } from "source-map";
import { WebSocket } from "ws";

// Runs `entry` under --inspect-wait. Returns its Debugger.scriptParsed event, the text that the debugger has of it,
// and the source map that the text names.
async function inspected(files: Record<string, string>, entry: string) {
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

    const file = entry.split(/[\\/]/).pop()!;
    const pending = new Map<number, (v: any) => void>();
    const scriptParsed = new Promise<any>(resolve => {
      ws.addEventListener("message", ({ data }) => {
        const msg = JSON.parse(data.toString());
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        } else if (msg.method === "Debugger.scriptParsed" && String(msg.params?.url ?? "").endsWith(file)) {
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
    const { result } = await send("Debugger.getScriptSource", { scriptId: params.scriptId });

    const m = String(params.sourceMapURL ?? "").match(/base64,([A-Za-z0-9+/=]+)/);
    expect(m).not.toBeNull();
    const raw = Buffer.from(m![1], "base64").toString();
    return { params, text: String(result?.scriptSource), raw, map: JSON.parse(raw) };
  } finally {
    ws.close();
  }
}

test("--inspect inline sourcemap sources[0] is a valid path under cwd", async () => {
  // VT (0x0B) / BEL (0x07) in the source exercise quote_for_json's RFC 8259
  // escape handling for sourcesContent.
  const source = "// comment [\x0b\x07]\nsetInterval(() => {}, 200);\n";
  const { raw, map } = await inspected({ "sub/target.mjs": source }, join("sub", "target.mjs"));
  expect(raw).not.toMatch(/\\v|\\x[0-9A-Fa-f]{2}/);

  expect(map.sources[0]).toBe("/sub/target.mjs");
  expect(map.sourcesContent[0]).toBe(source);
});

// The runtime prints a regex literal as it is written, so the text of its module is 8-bit with Latin-1 text in it and
// UTF-16 with wider text. The comments that name the source map and the module are added to it in that width.
describe.concurrent("--inspect inline sourcemap of a module with a non-ASCII regex literal", () => {
  test.each([
    ["ASCII text, for the same line with nothing to widen", "e-y-c", ""],
    ["Latin-1 text, which leaves the text of its module 8-bit", "éÿ©", ""],
    ["CJK and astral text, which makes the text of its module UTF-16", "ÿ-中文🐰", ""],
    ["CJK text, in a directory with a non-ASCII name", "中", "sub-é-中/"],
  ])("%s", async (_, regex, directory) => {
    const line = `const made = [/${regex}/u, new Error("after the literal"), f()];`;
    const source = `function f() {}\n${line}\nsetInterval(() => {}, 200);\n`;
    const name = `${directory}target.mjs`;
    const { params, text, map } = await inspected({ [name]: source }, join(directory, "target.mjs"));

    // The path is added as it always was, one character for each of its bytes.
    const path = Buffer.from(params.url).toString("latin1");
    expect({
      line: text.split("\n")[1],
      trailer: text.slice(text.indexOf("\n//# sourceMappingURL=")),
      sourceURL: params.sourceURL,
    }).toEqual({
      line,
      trailer: `\n//# sourceMappingURL=${params.sourceMapURL}\n//# sourceURL=${path}\n`,
      // JSC reads the comment back unless the path has whitespace or a quote in it.
      sourceURL: /[\s"']/.test(path) ? undefined : path,
    });
    expect(map.sources[0]).toBe(`/${name}`);
    expect(map.sourcesContent[0]).toBe(source);

    // The line is printed as it is written and a column is a UTF-16 code unit on both sides, so each mapping on the
    // line has the column that it came from.
    const onLine: { generatedColumn: number; originalLine: number; originalColumn: number }[] = [];
    await SourceMapConsumer.with(map, null, consumer => {
      consumer.eachMapping(({ generatedLine, generatedColumn, originalLine, originalColumn }) => {
        if (generatedLine === 2) onLine.push({ generatedColumn, originalLine, originalColumn });
      });
    });
    const columns = onLine.map(mapping => mapping.generatedColumn);
    expect(onLine).toEqual(
      columns.map(column => ({ generatedColumn: column, originalLine: 2, originalColumn: column })),
    );
    expect(columns).toContain(line.indexOf("new Error"));
    expect(columns).toContain(line.indexOf("f()"));
  });
});
