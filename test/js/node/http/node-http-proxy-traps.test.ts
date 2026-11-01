import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { EventEmitter } from "node:events";
import http from "node:http";
import { join } from "node:path";

function trapsOf(target: object, enter: (receiver: any) => unknown) {
  const traps: string[] = [];
  const text = (key: PropertyKey) => (typeof key === "symbol" ? `[${key.description}]` : String(key));
  const receiver = new Proxy(target, {
    get(target, key, receiver) {
      traps.push(text(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value) {
      traps.push(text(key) + " =");
      return Reflect.set(target, key, value);
    },
  });
  try {
    enter(receiver);
  } catch {}
  return traps;
}

test("IncomingMessage.prototype._dump reads nothing extra through a Proxy", () => {
  expect(
    trapsOf(Object.create(http.IncomingMessage.prototype), receiver =>
      http.IncomingMessage.prototype._dump.call(receiver),
    ),
  ).toEqual(["_dumped", "_dumped =", "removeAllListeners", "_events", "resume", "_readableState"]);
});

test("EventEmitter.call(proxy) performs every read and store in order", () => {
  expect(trapsOf(Object.create(EventEmitter.prototype), receiver => EventEmitter.call(receiver))).toEqual([
    "_events",
    "_events =",
    "_eventsCount =",
    "[shapeMode] =",
    "_maxListeners",
    "_maxListeners =",
    "[kCapture] =",
    "[kCapture] =",
  ]);
  expect(
    trapsOf(Object.assign(Object.create(EventEmitter.prototype), { _events: {} }), receiver =>
      EventEmitter.call(receiver),
    ),
  ).toEqual([
    "_events",
    "_events",
    "__proto__",
    "[shapeMode] =",
    "_maxListeners",
    "_maxListeners =",
    "[kCapture] =",
    "[kCapture] =",
  ]);
});

test("Proxy traps seen by node:http match the expected output", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "../../../aot/parallel/node-http/http-proxy-traps.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const expected = await Bun.file(join(import.meta.dir, "node-http-proxy-traps.expected.txt")).text();
  expect(stdout.split("\n")).toEqual(expected.split("\n"));
  expect(exitCode).toBe(0);
}, 60_000);
