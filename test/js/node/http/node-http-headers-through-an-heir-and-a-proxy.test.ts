import { expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

// The methods of a response are called on an object that stands in its place: one that inherits from it, or a Proxy of it.

const standIns: Record<string, (response: http.ServerResponse) => http.ServerResponse> = {
  "an heir": response => Object.create(response),
  "a Proxy": response => new Proxy(response, {}),
  "a Proxy with traps": response =>
    new Proxy(response, {
      get: (target, key, receiver) => Reflect.get(target, key, receiver),
      set: (target, key, value, receiver) => Reflect.set(target, key, value, receiver),
    }),
};

const stores: Record<string, (other: http.ServerResponse) => void> = {
  "setHeader()": other => void other.setHeader("x-a", "1"),
  "setHeaders()": other => void other.setHeaders(new Map([["x-a", "1"]])),
  "appendHeader()": other => void other.appendHeader("x-a", "1"),
  "writeHead()": other => void other.writeHead(200, { "x-a": "1" }),
  "writeHead() with a list": other => void other.writeHead(200, ["x-a", "1"]),
};

const earlier: Record<string, (response: http.ServerResponse) => void> = {
  "no header": () => {},
  "a header": response => void response.setHeader("x-first", "0"),
  "a header that was removed": response => {
    response.setHeader("x-first", "0");
    response.removeHeader("x-first");
  },
};

const rows: [string, string, string][] = [];
for (const standIn in standIns) {
  for (const store in stores) {
    for (const first in earlier) rows.push([store, standIn, first]);
  }
}

test.each(rows)("a header stored by %s of %s is sent, behind %s on the response", async (store, standIn, first) => {
  const server = http.createServer((_request, response) => {
    earlier[first](response);
    const other = standIns[standIn](response);
    stores[store](other);
    other.end("body");
  });
  try {
    await new Promise<void>(resolve => void server.listen(0, "127.0.0.1", resolve));
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    expect({
      status: response.status,
      "x-a": response.headers.get("x-a"),
      "x-first": response.headers.get("x-first"),
      body: await response.text(),
    }).toEqual({ status: 200, "x-a": "1", "x-first": first === "a header" ? "0" : null, body: "body" });
  } finally {
    server.close();
  }
});
