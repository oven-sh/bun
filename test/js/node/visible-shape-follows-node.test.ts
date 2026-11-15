import { expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";
import { Readable, Writable } from "node:stream";

// What a program can see of a few objects of node:http, node:stream and process.

test("ServerResponse keeps chunkedEncoding, writable and shouldKeepAlive as accessors of its prototype", () => {
  const response = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 } as any);
  for (const name of ["chunkedEncoding", "writable", "shouldKeepAlive"]) {
    expect({ name, own: Object.getOwnPropertyDescriptor(response, name) }).toEqual({ name, own: undefined });
    const inherited = Object.getOwnPropertyDescriptor(http.ServerResponse.prototype, name)!;
    expect({ name, inherited }).toEqual({
      name,
      inherited: { get: expect.any(Function), set: expect.any(Function), enumerable: false, configurable: false },
    });
    expect([inherited.get!.name, inherited.get!.length, inherited.set!.name, inherited.set!.length]).toEqual([
      "get",
      0,
      "set",
      1,
    ]);
  }
  expect(Object.keys(response)).not.toContain("chunkedEncoding");
  expect(Object.keys(response)).not.toContain("writable");
  expect(Object.keys(response)).not.toContain("shouldKeepAlive");
  expect([response.chunkedEncoding, response.writable, response.shouldKeepAlive]).toEqual([false, true, true]);
});

test("IncomingMessage creates its own properties in this order", () => {
  expect(Object.keys(new http.IncomingMessage(new net.Socket()))).toEqual([
    "_consuming",
    "_dumped",
    "complete",
    "_closed",
    "rawTrailers",
    "_events",
    "_readableState",
    "_maxListeners",
    "socket",
    "httpVersionMajor",
    "httpVersionMinor",
    "httpVersion",
    "joinDuplicateHeaders",
    "upgrade",
    "url",
    "method",
    "statusCode",
    "statusMessage",
    "client",
  ]);
});

test("process.nextTick prints as native code", () => {
  expect(process.nextTick.name).toBe("nextTick");
  expect(process.nextTick.length).toBe(1);
  expect(Function.prototype.toString.call(process.nextTick)).toBe("function nextTick() { [native code] }");
});

test("the prototypes of ReadableState and WritableState have no constructor of their own", () => {
  for (const State of [(Readable as any).ReadableState, (Writable as any).WritableState]) {
    expect(Object.getOwnPropertyDescriptor(State.prototype, "constructor")).toBeUndefined();
    expect(State.prototype.constructor).toBe(Object);
  }
  expect((new Readable({ read() {} }) as any)._readableState.constructor).toBe(Object);
  expect((new Writable({ write() {} }) as any)._writableState.constructor).toBe(Object);
});
