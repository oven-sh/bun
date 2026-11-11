// One build for each program. A build reads what the program stores on the classes of the library and how it links them
// (class_stores.rs and prototype_links.rs in src/sema/check/aot), so one that held two of these cases would judge each beside
// the other.
import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "./harness/commands";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { test, testOneByOne } from "./supported";

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

// Six answers of "ok", the sizes of the six bodies that the server read, and how often the two functions of a tracing patch were called.
const untraced = "6 5,5,5,5,5,5 0 0\n";
const traced = "6 5,5,5,5,5,5 6 6\n";
const counter = "counter:ClassGuardBitsInvalidated";

/**
 * Builds one program and starts it. The run prints `prints` and nothing else, ends well, and writes one line of the counter.
 * The answer is the number on that line: how many guard bits the run ended.
 */
async function serve(entry: string, prints: string) {
  using dir = tempDir("aot-short-roads-under-a-tracing-patch", { [entry]: files[entry] });
  const folder = String(dir);
  const executable = join(folder, entry.replace(".mjs", isWindows ? ".exe" : ""));
  const counts = executable + ".counts";
  const build = [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation, entry, "--outfile", executable];
  // No more programs are built at once than the machine has processors.
  return await slot(async () => {
    built(await spawned(build, folder, bunEnv));
    const answer = await spawned([executable], folder, { ...bunEnv, BUN_JSC_aotCountsPath: counts });
    expect({ entry, ...answer }).toEqual({ entry, stdout: prints, stderr: "", exitCode: 0, signal: null });
    const counted = readFileSync(counts, "utf8")
      .split("\n")
      .filter(line => line.endsWith(`\t${counter}`));
    expect({ entry, [counter]: counted }).toEqual({ entry, [counter]: [expect.stringMatching(/^\d+\t/)] });
    return Number(counted[0].split("\t")[0]);
  });
}

let quiet: Promise<number> | undefined;
/** The guard bits that the server ends which nothing is laid over. Every other program is held against it, so it is built once. */
const endedByAQuietServer = () => (quiet ??= serve("quiet.mjs", untraced));

// The programs are built beside one another. A debug build of Bun holds more than a gigabyte of memory for each build, so there
// they are built one by one.
const declare = isDebug ? testOneByOne : test.concurrent;

declare("a quiet server answers its six requests, and its run counts the guard bits that it ended", async () => {
  expect(await endedByAQuietServer()).toBeGreaterThanOrEqual(0);
});

declare(
  "plain stores of functions over and beside the library's methods end no guard that a quiet server keeps",
  async () => {
    const [ended, endedByQuiet] = await Promise.all([serve("traced.mjs", traced), endedByAQuietServer()]);
    expect(ended).toBe(endedByQuiet);
  },
);

declare.each(Object.keys(deeds).flatMap(deed => [[deed, "ahead"] as const, [deed, "later"] as const]))(
  "%s, laid %s: what sees a read or a store above the messages of a server ends some guards, whoever wrote its functions",
  async (deed, moment) => {
    const [ended, endedByQuiet] = await Promise.all([serve(`${deed}-${moment}.mjs`, untraced), endedByAQuietServer()]);
    expect(ended).toBeGreaterThan(endedByQuiet);
  },
);
