import { expect, test } from "bun:test";
import { Socket } from "node:net";
import { Duplex, Readable, Writable } from "node:stream";
import { inspect } from "node:util";

test("the prototypes of a stream's state objects hold no constructor", () => {
  const { _readableState: readable, _writableState: writable } = new Duplex();
  for (const state of [readable, writable]) {
    expect(Object.hasOwn(Object.getPrototypeOf(state), "constructor")).toBe(false);
    expect(state.constructor).toBe(Object);
  }
});

test("the state objects of a stream print as plain objects", () => {
  expect(Bun.inspect(new Readable())).toContain("_readableState: {\n");
  expect(Bun.inspect(new Writable())).toContain("_writableState: {\n");
  expect(inspect(new Readable())).toContain("_readableState: {\n");
  expect(inspect(new Writable())).toContain("_writableState: {\n");
  expect(inspect({ socket: new Socket() }, { depth: 1 })).toContain(
    "_readableState: [Object],\n    _writableState: [Object],",
  );
});
