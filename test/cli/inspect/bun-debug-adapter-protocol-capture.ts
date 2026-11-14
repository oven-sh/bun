// Writes what a bun reports for bun-debug-adapter-protocol-fixture.ts under the inspector into
// bun-debug-adapter-protocol-maps.json: the generated code and its source map, with the source.
//
//   bun test/cli/inspect/bun-debug-adapter-protocol-capture.ts bun-1.4.4 /path/to/bun-1.4.4/bun
import { spawn } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { format, resolveConfig } from "prettier";

const [name, runtime] = process.argv.slice(2);
const fixture = join(import.meta.dir, "bun-debug-adapter-protocol-fixture.ts");
const maps = join(import.meta.dir, "bun-debug-adapter-protocol-maps.json");

// The program waits for a debugger, so it does not run.
await using debuggee = spawn({
  cmd: [runtime, "--inspect-wait=127.0.0.1:0", fixture],
  env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
  stdout: "ignore",
  stderr: "pipe",
});
let banner = "";
for await (const chunk of debuggee.stderr.pipeThrough(new TextDecoderStream())) {
  banner += chunk;
  if (/ws:\/\/\S+\s/.test(banner)) break;
}
const url = banner.match(/ws:\/\/\S+/)?.[0];
if (!url) {
  throw new Error(`${runtime} did not print the address of its inspector:\n${banner}`);
}

const socket = new WebSocket(url);
const opened = Promise.withResolvers<void>();
socket.onopen = () => opened.resolve();
socket.onerror = () => opened.reject(new Error(`Could not connect to ${url}`));
await opened.promise;

let id = 0;
const results = new Map<number, (result: any) => void>();
const parsed = Promise.withResolvers<{ scriptId: string; sourceMapURL: string }>();
socket.onmessage = ({ data }) => {
  const { id, result, method, params } = JSON.parse(String(data));
  if (typeof id === "number") {
    results.get(id)?.(result);
  } else if (method === "Debugger.scriptParsed" && params.url === fixture) {
    parsed.resolve(params);
  }
};
function send(method: string, params: object = {}): Promise<any> {
  const { promise, resolve } = Promise.withResolvers<any>();
  results.set(++id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
  return promise;
}

await Promise.all([send("Inspector.enable"), send("Debugger.enable")]);
void send("Inspector.initialized");
const { scriptId, sourceMapURL } = await parsed.promise;
const { scriptSource } = await send("Debugger.getScriptSource", { scriptId });
socket.close();

const { version, sourcesContent, mappings } = JSON.parse(
  Buffer.from(sourceMapURL.slice(sourceMapURL.indexOf(",") + 1), "base64").toString("utf8"),
);
const captures = JSON.parse(readFileSync(maps, "utf8"));
captures[name] = {
  generated: scriptSource.slice(0, scriptSource.indexOf("\n//# sourceMappingURL=")),
  // The runtime names the source by its path on this machine.
  map: { version, sources: [basename(fixture)], sourcesContent, mappings },
};
writeFileSync(maps, await format(JSON.stringify(captures), { ...(await resolveConfig(maps)), filepath: maps }));
console.log(`${name}: ${scriptSource.split("\n").length} generated lines, ${mappings.length} characters of mappings`);
