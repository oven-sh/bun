import { expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";
import { Readable, Writable } from "node:stream";

// What a program can see of a few objects of node:http, node:stream and process.

test("ServerResponse keeps chunkedEncoding, writable and shouldKeepAlive as data properties of its own", () => {
  const response = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 } as any);
  for (const [name, value] of [
    ["chunkedEncoding", false],
    ["writable", true],
    ["shouldKeepAlive", true],
  ] as const) {
    expect({ name, own: Object.getOwnPropertyDescriptor(response, name) }).toEqual({
      name,
      own: { value, writable: true, enumerable: true, configurable: true },
    });
    expect({ name, inherited: name in http.ServerResponse.prototype }).toEqual({ name, inherited: false });
  }
  const keys = Object.keys(response);
  expect(keys.slice(keys.indexOf("outputSize"), keys.indexOf("maxRequestsOnConnectionReached") + 1)).toEqual([
    "outputSize",
    "writable",
    "destroyed",
    "_last",
    "chunkedEncoding",
    "shouldKeepAlive",
    "maxRequestsOnConnectionReached",
  ]);
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
