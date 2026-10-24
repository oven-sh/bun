import { expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";
import { Readable, Writable } from "node:stream";

// What a program can see of a few objects of node:http, node:stream and process, as Node.js has it.

test("ServerResponse keeps chunkedEncoding, writable and shouldKeepAlive as its own data properties", () => {
  const response = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 } as any);
  for (const name of ["chunkedEncoding", "writable", "shouldKeepAlive"]) {
    expect({ name, own: Object.getOwnPropertyDescriptor(response, name) }).toEqual({
      name,
      own: { value: expect.any(Boolean), writable: true, enumerable: true, configurable: true },
    });
    expect(Object.getOwnPropertyDescriptor(http.ServerResponse.prototype, name)).toBeUndefined();
  }
  expect(Object.keys(response)).toContain("chunkedEncoding");
  expect(Object.keys(response)).toContain("writable");
  expect(Object.keys(response)).toContain("shouldKeepAlive");
});

test("IncomingMessage creates its own properties in Node.js' order", () => {
  const orderInNode = [
    "_events",
    "_readableState",
    "_maxListeners",
    "socket",
    "httpVersionMajor",
    "httpVersionMinor",
    "httpVersion",
    "complete",
    "rawHeaders",
    "rawTrailers",
    "joinDuplicateHeaders",
    "aborted",
    "upgrade",
    "url",
    "method",
    "statusCode",
    "statusMessage",
    "client",
    "_consuming",
    "_dumped",
  ];
  const keys = Object.keys(new http.IncomingMessage(new net.Socket()));
  expect(keys.filter(key => orderInNode.includes(key))).toEqual(orderInNode.filter(key => keys.includes(key)));
  expect(keys.slice(0, 4)).toEqual(["_events", "_readableState", "_maxListeners", "socket"]);
});

test("process.nextTick is a JavaScript function", () => {
  expect(process.nextTick.name).toBe("nextTick");
  expect(process.nextTick.length).toBe(1);
  expect(Function.prototype.toString.call(process.nextTick)).not.toContain("[native code]");
});

test("the prototypes of ReadableState and WritableState name their constructors", () => {
  for (const State of [(Readable as any).ReadableState, (Writable as any).WritableState]) {
    expect(Object.getOwnPropertyDescriptor(State.prototype, "constructor")).toEqual({
      value: State,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  expect((new Readable({ read() {} }) as any)._readableState.constructor).toBe((Readable as any).ReadableState);
  expect((new Writable({ write() {} }) as any)._writableState.constructor).toBe((Writable as any).WritableState);
});
