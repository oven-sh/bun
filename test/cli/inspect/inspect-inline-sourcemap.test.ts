import { spawn } from "bun";
import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { SourceMap } from "node:module";
import { join } from "node:path";
import { WebSocket } from "ws";

// VT (0x0B) / BEL (0x07) in the source exercise quote_for_json's RFC 8259
// escape handling for sourcesContent.
const source = "// comment [\x0b\x07]\nsetInterval(() => {}, 200);\n";

/** The JSON of the source map the inspector gets for `sub/target.mjs`. */
async function inlineSourceMap(files: Record<string, string>, args: string[]) {
  using dir = tempDir("inspect-sourcemap", {
    "sub/target.mjs": source,
    ...files,
  });
  const cwd = fs.realpathSync(String(dir));

  await using proc = spawn({
    cmd: [bunExe(), "--inspect-wait=127.0.0.1:0", ...args, join("sub", "target.mjs")],
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

    const pending = new Map<number, (v: any) => void>();
    const scriptParsed = new Promise<any>(resolve => {
      ws.addEventListener("message", ({ data }) => {
        const msg = JSON.parse(data.toString());
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        } else if (msg.method === "Debugger.scriptParsed" && String(msg.params?.url ?? "").endsWith("target.mjs")) {
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
    return Buffer.from(m![1], "base64").toString();
  } finally {
    ws.close();
  }
}

test("--inspect inline sourcemap sources[0] is a valid path under cwd", async () => {
  const raw = await inlineSourceMap({}, []);
  expect(raw).not.toMatch(/\\v|\\x[0-9A-Fa-f]{2}/);
  const map = JSON.parse(raw);

  expect(map.sources[0]).toBe("/sub/target.mjs");
  expect(map.sourcesContent[0]).toBe(source);
});

test("--inspect inline sourcemap is of what a plugin returned, with or without a source map", async () => {
  const map = JSON.parse(
    await inlineSourceMap(
      {
        "plugin.js": `
          Bun.plugin({
            name: "rewrite",
            setup(build) {
              build.onLoad({ filter: /target\\.mjs$/ }, async ({ path }) => {
                // Each line of the file is three lines further down.
                const map = { version: 3, sources: [path], names: [], mappings: ";;;AAAA;AACA" };
                return {
                  contents:
                    "// 1\\n// 2\\n// 3\\n" +
                    (await Bun.file(path).text()) +
                    "//# sourceMappingURL=data:application/json;base64," +
                    btoa(JSON.stringify(map)),
                  loader: "js",
                };
              });
            },
          });
        `,
      },
      ["--preload", "./plugin.js"],
    ),
  );

  expect(map.sources[0]).toBe("/sub/target.mjs");
  expect(map.sourcesContent[0]).toStartWith("// 1\n// 2\n// 3\n" + source);
  const entries = Array.from({ length: 8 }, (_, line) => new SourceMap(map).findEntry(line, 0).originalLine);
  expect(entries.filter(line => line !== undefined)).toEqual([4]);
});
