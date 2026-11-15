import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const head = `
import http from "node:http";
import stream from "node:stream";
import util from "node:util";
import { EventEmitter } from "node:events";
const seen = { emits: 0, ends: 0 };
`;
const server = `
const sizes = [];
const server = http.createServer((request, response) => {
  let size = 0;
  request.on("data", chunk => { size += chunk.length; });
  request.on("end", () => { sizes.push(size); response.end("ok"); });
});
server.listen(0, async () => {
  let right = 0;
  for (let i = 0; i < 6; i++) {
    if (i === 3) later();
    const answer = await fetch(\`http://127.0.0.1:\${server.address().port}/\`, { method: "POST", body: "abcde" });
    if ((await answer.text()) === "ok") right++;
  }
  console.log(right, sizes.join(), seen.emits, seen.ends);
  server.close();
});
`;
const deeds = {
  "accessor": `Object.defineProperty(EventEmitter.prototype, "madeUp", { get() { return 1; }, configurable: true });`,
  "read-only": `Object.defineProperty(http.IncomingMessage.prototype, "madeUp", { value: 1, writable: false, configurable: true });`,
  "wrapped": `Object.defineProperty(http.ServerResponse.prototype, "madeUp", { get: util.deprecate(() => 1, "made up"), configurable: true });`,
  "copied": `Object.defineProperty(http.IncomingMessage.prototype, "madeUp", Object.getOwnPropertyDescriptor(stream.Readable.prototype, "destroyed"));`,
  "state": `Object.defineProperty(Object.getPrototypeOf(new stream.Readable()._readableState), "madeUp", { get() { return 1; }, configurable: true });`,
  "replaced": `http.ServerResponse.prototype = Object.create(http.OutgoingMessage.prototype, Object.getOwnPropertyDescriptors(http.ServerResponse.prototype));`,
  "link": `Object.setPrototypeOf(http.IncomingMessage.prototype, Object.create(stream.Readable.prototype));`,
};
const files: Record<string, string> = {
  "quiet.mjs": `${head}const later = () => {};${server}`,
  "traced.mjs": `${head}const later = () => {};
    const emitOfServers = http.Server.prototype.emit;
    http.Server.prototype.emit = function (name, ...rest) { if (name === "request") seen.emits++; return emitOfServers.call(this, name, ...rest); };
    EventEmitter.prototype.madeUpTrace = function () { return this.listenerCount("data"); };
    const endOfResponses = http.ServerResponse.prototype.end;
    http.ServerResponse.prototype.end = function (...rest) { seen.ends++; return endOfResponses.apply(this, rest); };
    ${server}`,
};
for (const [name, deed] of Object.entries(deeds)) {
  files[`${name}-ahead.mjs`] = `${head}const later = () => {};${deed}${server}`;
  files[`${name}-later.mjs`] = `${head}const later = () => { ${deed} };${server}`;
}

async function serve(dir: string, entry: string) {
  const executable = join(dir, entry.replace(".mjs", isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], dir, bunEnv);
  expect(built.exitCode).toBe(0);
  const path = executable + ".counts";
  const { stdout, exitCode } = await run([executable], dir, { ...bunEnv, BUN_JSC_aotCountsPath: path });
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find(line => line.endsWith("\tcounter:ClassGuardBitsInvalidated"));
  return { stdout, exitCode, guardBitsEnded: Number(line?.split("\t")[0] ?? 0) };
}

test("plain stores of functions over and beside the library's methods end no guard that a quiet server keeps; what sees a read or a store above its messages ends some, whoever wrote its functions and whenever it is laid", async () => {
  using dir = tempDir("aot-short-roads-under-a-tracing-patch", files);
  const quiet = await serve(String(dir), "quiet.mjs");
  expect(quiet).toMatchObject({ stdout: "6 5,5,5,5,5,5 0 0\n", exitCode: 0 });
  expect(await serve(String(dir), "traced.mjs")).toEqual({ ...quiet, stdout: "6 5,5,5,5,5,5 6 6\n" });
  const endsMore: Record<string, boolean> = {};
  for (const entry of Object.keys(files).filter(entry => /-(ahead|later)\.mjs$/.test(entry))) {
    const { guardBitsEnded, ...answer } = await serve(String(dir), entry);
    expect({ entry, ...answer }).toEqual({ entry, stdout: quiet.stdout, exitCode: 0 });
    endsMore[entry] = guardBitsEnded > quiet.guardBitsEnded;
  }
  expect(endsMore).toEqual(Object.fromEntries(Object.keys(endsMore).map(entry => [entry, true])));
}, 900_000);
