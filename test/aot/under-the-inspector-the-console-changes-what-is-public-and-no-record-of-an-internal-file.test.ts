// An executable built with --compile-inspector keeps the records that the library's INTERNAL files hand out in the compiler's sight, and freezes each where its file hands it back:
// the console reaches every object of the heap (Heap.snapshot, Heap.getRemoteObject), so no door stands between it and such a record.
// A store on one is refused: a TypeError in strict code. What is public takes stores from the console as under `bun --inspect`, and compiled code sees them.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "main.ts": `
import fs from "node:fs";
import http from "node:http";
import { Readable } from "node:stream";
const shown = ((globalThis as any).shown = new Readable({ read() {} }));
const look = () => [JSON.stringify(fs.globSync("*.made-up-ending")), String(http.validateHeaderName("good")), shown.readableObjectMode, shown.readableLength].join(" ");
console.log(look());
(globalThis as any).lookAgain = () => console.log(look());
const timer = setInterval(() => {}, 1000);
(globalThis as any).leave = () => clearInterval(timer);
`,
};

function address() {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const url = `ws://127.0.0.1:${server.port}/made-up`;
  server.stop(true);
  return url;
}

async function talk(
  command: (url: string) => string[],
  env: (url: string) => Record<string, string | undefined>,
  cwd: string,
) {
  const url = address();
  await using started = Bun.spawn(command(url), { cwd, env: env(url), stdout: "pipe", stderr: "ignore" });
  let socket: WebSocket | undefined;
  while (!socket) {
    socket = await new Promise<WebSocket | undefined>(done => {
      const made = new WebSocket(url);
      made.onopen = () => done(made);
      made.onerror = () => done(undefined);
    });
    if (!socket) await Bun.sleep(20);
  }
  let number = 0;
  const waiting = new Map<number, (message: any) => void>();
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  };
  let isClosed = false;
  const closed = { result: { result: { value: "the socket closed" } } };
  socket.onclose = () => {
    isClosed = true;
    for (const done of waiting.values()) done(closed);
  };
  const send = (method: string, params = {}) =>
    new Promise<any>(done => {
      if (isClosed) return done(closed.result);
      waiting.set(++number, message => done(message.result ?? message));
      socket.send(JSON.stringify({ id: number, method, params }));
    });
  const shown = (answer: any) =>
    answer.wasThrown ? "thrown: " + String(answer.result.description).split(":")[0] : String(answer.result.value);
  const evaluate = async (expression: string) => shown(await send("Runtime.evaluate", { expression }));
  await send("Runtime.enable");
  await send("Heap.enable");

  const said: string[] = [];
  const heap = JSON.parse((await send("Heap.snapshot")).snapshotData);
  const names = ["glob", "globSync", "Glob"].map(name => heap.edgeNames.indexOf(name));
  const property = heap.edgeTypes.indexOf("Property");
  const held = new Map<number, Set<number>>();
  for (let at = 0; at < heap.edges.length; at += 4) {
    if (heap.edges[at + 2] !== property || !names.includes(heap.edges[at + 3])) continue;
    if (!held.has(heap.edges[at])) held.set(heap.edges[at], new Set());
    held.get(heap.edges[at])!.add(heap.edges[at + 3]);
  }
  for (const [heapObjectId, found] of held) {
    if (found.size !== names.length) continue;
    const { objectId } = (await send("Heap.getRemoteObject", { heapObjectId })).result;
    const call = async (functionDeclaration: string) =>
      shown(await send("Runtime.callFunctionOn", { objectId, functionDeclaration }));
    if ((await call("function () { return Object.keys(this).join(); }")) !== "glob,globSync,Glob") continue;
    said.push("the record: frozen " + (await call("function () { return Object.isFrozen(this); }")));
    said.push(
      "a strict store: " +
        (await call("function () { 'use strict'; this.globSync = () => ['replaced']; return 'stored'; }")),
    );
    said.push(
      "a sloppy store: " +
        (await call(
          "function () { const kept = this.globSync; this.globSync = () => ['replaced']; return this.globSync === kept ? 'nothing' : 'stored'; }",
        )),
    );
    said.push(
      "what lies in it: " + (await call("function () { return typeof this.globSync('*.made-up-ending').length; }")),
    );
  }
  said.push(await evaluate(`process.getBuiltinModule("node:http").validateHeaderName = () => "replaced"; "stored"`));
  said.push(
    await evaluate(
      `const state = shown._readableState; state[Object.getOwnPropertySymbols(state).find(name => typeof state[name] === "number")] |= 1; state.length = 7; "stored"`,
    ),
  );
  await evaluate("lookAgain(); leave()");
  socket.close();
  return { said, stdout: await started.stdout.text(), exitCode: await started.exited };
}

test("under the inspector the console changes what is public and no record of an internal file", async () => {
  using dir = tempDir("aot-console-and-records", files);
  const cwd = String(dir);
  const plain = await talk(
    url => [bunExe(), "--inspect=" + url, "main.ts"],
    () => bunEnv,
    cwd,
  );
  expect(plain).toEqual({
    said: [
      "the record: frozen false",
      "a strict store: stored",
      "a sloppy store: stored",
      "what lies in it: number",
      "stored",
      "stored",
    ],
    stdout: '[] undefined false 0\n["replaced"] replaced true 7\n',
    exitCode: 0,
  });
  const executable = join(cwd, "program");
  const build = [bunExe(), "build", "--compile", "--aot", "--compile-inspector", "main.ts", "--outfile", executable];
  expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
  expect(
    await talk(
      () => [executable],
      url => ({ ...bunEnv, BUN_INSPECT: url }),
      cwd,
    ),
  ).toEqual({
    said: [
      "the record: frozen true",
      "a strict store: thrown: TypeError",
      "a sloppy store: nothing",
      "what lies in it: number",
      "stored",
      "stored",
    ],
    stdout: "[] undefined false 0\n[] replaced true 7\n",
    exitCode: 0,
  });
}, 240_000);
