// An executable built with --compile-inspector still knows everything that the program does with an object that never leaves compiled code.
// The console reaches such an object through a heap snapshot (Heap.snapshot, Heap.getRemoteObject). It reads it, calls its methods and stores what fits.
// A change that no statement of the program makes throws a TypeError and leaves the object, or its class, as it was. The process goes on: it once aborted.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "main.ts": `
const hidden = { count: 1, grow() { return 2; } };
class Meter { level = 4; read() { return this.level; } }
const meter = new Meter();
const look = () => console.log(hidden.count + " " + hidden.grow() + " " + meter.read());
look();
(globalThis as any).lookAgain = look;
const timer = setInterval(() => {}, 1000);
(globalThis as any).leave = () => clearInterval(timer);
`,
};

const doors: [name: string, deed: string][] = [
  ["a call of its method", "this.read()"],
  ["a call through native code", "[this].map(one => one.read())[0]"],
  ["a store of the same type", "this.level = 40"],
  ["a store of another type", "this.level = 'forty'"],
  ["a new name", "this.other = 1"],
  ["an element", "this[0] = 1"],
  ["a symbol", "this[Symbol('made')] = 1"],
  ["Reflect.set", "Reflect.set(this, 'level', 'forty')"],
  ["an accessor", "Object.defineProperty(this, 'level', { get() { return 9; } })"],
  ["read only", "Object.defineProperty(this, 'level', { writable: false })"],
  ["a defined name", "Object.defineProperties(this, { other: { value: 1 } })"],
  ["Reflect.defineProperty", "Reflect.defineProperty(this, 'level', { get() { return 9; } })"],
  ["delete", "delete this.level"],
  ["Reflect.deleteProperty", "Reflect.deleteProperty(this, 'level')"],
  ["setPrototypeOf", "Object.setPrototypeOf(this, null)"],
  ["Reflect.setPrototypeOf", "Reflect.setPrototypeOf(this, {})"],
  ["a store under __proto__", "this.__proto__ = {}"],
  ["preventExtensions", "Object.preventExtensions(this)"],
  ["Reflect.preventExtensions", "Reflect.preventExtensions(this)"],
  ["seal", "Object.seal(this)"],
  ["freeze", "Object.freeze(this)"],
  ["Object.assign of another type", "Object.assign(this, { level: 'forty' })"],
  ["Object.assign of a new name", "Object.assign(this, { other: 1 })"],
  ["a method of the class replaced", "Object.getPrototypeOf(this).read = () => 0"],
  [
    "a method of the class redefined",
    "Object.defineProperty(Object.getPrototypeOf(this), 'read', { get() { return () => 0; } })",
  ],
  ["a method of the class deleted", "delete Object.getPrototypeOf(this).read"],
  ["a name added to the class", "Object.getPrototypeOf(this).other = 1"],
  ["what the class extends", "Object.setPrototypeOf(Object.getPrototypeOf(this), null)"],
  ["a method called on something else", "this.read.call({ level: 'text' })"],
];

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
  deeds: typeof doors,
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
  await send("Runtime.enable");
  await send("Heap.enable");

  const heap = JSON.parse((await send("Heap.snapshot")).snapshotData);
  const className = heap.nodeClassNames.indexOf("Meter");
  const fieldsOfNode = heap.type === "GCDebugging" ? 7 : 4;
  const found: number[] = [];
  for (let at = 0; at < heap.nodes.length; at += fieldsOfNode)
    if (heap.nodes[at + 2] === className) found.push(heap.nodes[at]);
  const said: Record<string, string> = { found: String(found.length) };
  const { objectId } = (await send("Heap.getRemoteObject", { heapObjectId: found[0] })).result;
  const call = async (functionDeclaration: string) =>
    shown(await send("Runtime.callFunctionOn", { objectId, functionDeclaration }));
  for (const [name, deed] of deeds)
    said[name] = await call(
      `function () { "use strict"; try { const answer = (function () { return ${deed}; }).call(this); return "taken: " + (typeof answer === "object" || typeof answer === "function" ? typeof answer : answer); } catch (error) { return error.constructor.name; } }`,
    );
  said["left as"] = await call(
    `function () { const holder = Object.getPrototypeOf(this); return [JSON.stringify(this), Object.isExtensible(this), Object.getOwnPropertyNames(holder), Object.getPrototypeOf(holder) === Object.prototype, this.read()].join(" "); }`,
  );
  await send("Runtime.evaluate", { expression: "lookAgain(); leave()" });
  socket.close();
  return { said, stdout: await started.stdout.text(), exitCode: await started.exited };
}

test("under the inspector the console is refused what the program never does", async () => {
  using dir = tempDir("aot-console-and-proofs", files);
  const cwd = String(dir);
  const fits = doors.slice(0, 3);
  const plain = await talk(
    url => [bunExe(), "--inspect=" + url, "main.ts"],
    () => bunEnv,
    cwd,
    fits,
  );
  const whatFits = {
    "found": "1",
    "a call of its method": "taken: 4",
    "a call through native code": "taken: 4",
    "a store of the same type": "taken: 40",
  };
  expect(plain).toEqual({
    said: { ...whatFits, "left as": '{"level":40} true constructor,read true 40' },
    stdout: "1 2 4\n1 2 40\n",
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
      doors,
    ),
  ).toEqual({
    said: {
      ...whatFits,
      ...Object.fromEntries(doors.slice(3).map(([name]) => [name, "TypeError"])),
      "left as": '{"level":40} true constructor,read true 40',
    },
    stdout: "1 2 4\n1 2 40\n",
    exitCode: 0,
  });
}, 240_000);
