import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { Duplex, Readable, Transform, Writable } from "node:stream";

function readsOf(target: object, enter: (receiver: any) => unknown) {
  const reads: PropertyKey[] = [];
  const receiver = new Proxy(target, {
    get(target, key, receiver) {
      reads.push(key);
      return Reflect.get(target, key, receiver);
    },
  });
  try {
    enter(receiver);
  } catch {}
  return reads;
}
const getter = (prototype: object, name: string) => (receiver: object) => Reflect.get(prototype, name, receiver);

test("Readable and Writable accessors read the state twice through a Proxy", () => {
  const readable = () => new Readable({ read() {} });
  for (const name of ["readableObjectMode", "readableEncoding", "errored", "closed", "destroyed", "readableEnded"]) {
    expect([name, readsOf(readable(), getter(Readable.prototype, name))]).toEqual([
      name,
      ["_readableState", "_readableState"],
    ]);
    expect([name, readsOf({}, getter(Readable.prototype, name))]).toEqual([name, ["_readableState"]]);
  }
  expect(readsOf(readable(), getter(Readable.prototype, "readableAborted"))).toEqual([
    "_readableState",
    "_readableState",
    "_readableState",
  ]);
  for (const name of ["closed", "destroyed"]) {
    expect([name, readsOf(new Writable(), getter(Writable.prototype, name))]).toEqual([
      name,
      ["_writableState", "_writableState"],
    ]);
  }
});

test("Duplex.prototype.destroyed stops at the first missing state", () => {
  const destroyed = getter(Duplex.prototype, "destroyed");
  expect(readsOf({}, destroyed)).toEqual(["_readableState"]);
  expect(readsOf({ _readableState: {} }, destroyed)).toEqual(["_readableState", "_writableState"]);
  expect(readsOf(new Duplex(), destroyed)).toEqual(["_readableState", "_writableState", "_readableState"]);
  const duplex = new Duplex();
  duplex.destroy();
  expect(readsOf(duplex, destroyed)).toEqual(["_readableState", "_writableState", "_readableState", "_writableState"]);
});

test("end(chunk) reads _writableState twice", () => {
  expect(readsOf({}, receiver => Writable.prototype.end.call(receiver, "a"))).toEqual([
    "_writableState",
    "_writableState",
  ]);
  expect(readsOf({}, receiver => Writable.prototype.end.call(receiver))).toEqual(["_writableState"]);
});

function counting(target: object, name: string) {
  const count = { reads: 0 };
  const receiver: any = new Proxy(target, {
    get(target, key, receiver) {
      if (key === name) count.reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  return { count, receiver };
}

test("pipe() reads dest.write once per chunk", async () => {
  for (const isReplaced of [false, true]) {
    const destination = new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    });
    if (isReplaced) {
      destination.write = function (this: Writable, chunk: unknown) {
        return Writable.prototype.write.call(this, chunk);
      } as typeof destination.write;
    }
    const { count, receiver } = counting(destination, "write");
    const source = new Readable({ read() {} });
    source.pipe(receiver);
    const before = count.reads;
    source.push("one");
    source.push("two");
    await new Promise(resolve => setImmediate(resolve));
    expect({ isReplaced, reads: count.reads - before }).toEqual({ isReplaced, reads: 2 });
  }
});

test("Transform reads this.push once per chunk", () => {
  for (const isReplaced of [false, true]) {
    const transform = new Transform({
      transform(chunk, encoding, callback) {
        callback(null, chunk);
      },
    });
    if (isReplaced) {
      transform.push = function (this: Transform, chunk: unknown) {
        return Readable.prototype.push.call(this, chunk);
      };
    }
    const { count, receiver } = counting(transform, "push");
    Transform.prototype._write.call(receiver, Buffer.from("a"), "buffer", () => {});
    expect({ isReplaced, reads: count.reads }).toEqual({ isReplaced, reads: 1 });
  }
});

test("Proxy traps seen by node:stream match the expected output", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "../../../aot/parallel/library-modules/stream-proxy-traps.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const expected = await Bun.file(join(import.meta.dir, "node-stream-proxy-traps.expected.txt")).text();
  expect(stdout.split("\n")).toEqual(expected.split("\n"));
  expect(exitCode).toBe(0);
}, 60_000);
