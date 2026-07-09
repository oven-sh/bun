/**
 * All tests in this file also run in Node.js.
 */
import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";

describe("writeHead with array headers preserves wire order", () => {
  async function readHead(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
    await using server = http.createServer(handler);
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const { promise, resolve, reject } = Promise.withResolvers<{ statusLine: string; headers: string[] }>();
    const chunks: Buffer[] = [];
    const socket = connect(port, "127.0.0.1", () => {
      socket.write("GET / HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n");
    });
    socket.on("data", d => chunks.push(d));
    socket.on("error", reject);
    socket.on("close", () => {
      const all = Buffer.concat(chunks).toString("latin1").split("\r\n\r\n")[0].split("\r\n");
      resolve({
        statusLine: all[0],
        headers: all.slice(1).filter(l => !/^(date|connection|content-length|transfer-encoding|keep-alive):/i.test(l)),
      });
    });
    return await promise;
  }

  it("emits a flat [name, value, ...] list verbatim when no setHeader was called", async () => {
    let sawGetHeader;
    const { headers } = await readHead((req, res) => {
      res.writeHead(200, ["X-D", "1", "X-A", "q", "X-D", "2", "Content-Type", "a/b", "Content-Type", "c/d"]);
      sawGetHeader = { xd: res.getHeader("x-d"), has: res.hasHeader("x-d") };
      res.end("ok");
    });
    expect(headers).toEqual(["X-D: 1", "X-A: q", "X-D: 2", "Content-Type: a/b", "Content-Type: c/d"]);
    // Like Node.js: the raw array never populates the progressive header map.
    expect(sawGetHeader).toEqual({ xd: undefined, has: false });
  });

  it("emits a nested [[name, value], ...] list verbatim", async () => {
    const { headers } = await readHead((req, res) => {
      res.writeHead(200, [
        ["X-D", "1"],
        ["X-A", "q"],
        ["X-D", "2"],
      ]);
      res.end("ok");
    });
    expect(headers).toEqual(["X-D: 1", "X-A: q", "X-D: 2"]);
  });

  it("merges into the progressive map after setHeader (Node.js's slow path)", async () => {
    let sawGetHeader;
    const { headers } = await readHead((req, res) => {
      res.setHeader("X-Pre", "pre");
      res.writeHead(200, ["X-D", "1", "X-A", "q", "X-D", "2"]);
      sawGetHeader = res.getHeader("x-d");
      res.end("ok");
    });
    // Node.js folds the array into kOutHeaders here, regrouping same-named
    // fields at the first occurrence.
    expect(headers).toEqual(["X-Pre: pre", "X-D: 1", "X-D: 2", "X-A: q"]);
    expect(sawGetHeader).toEqual(["1", "2"]);
  });

  it("emits verbatim when a reason phrase is also passed", async () => {
    const { statusLine, headers } = await readHead((req, res) => {
      res.writeHead(200, "Fine", ["X-B", "1", "X-A", "q", "X-B", "2"]);
      res.end("ok");
    });
    expect(statusLine).toBe("HTTP/1.1 200 Fine");
    expect(headers).toEqual(["X-B: 1", "X-A: q", "X-B: 2"]);
  });

  it("snapshots the array: mutation after writeHead does not change the wire", async () => {
    const { headers } = await readHead((req, res) => {
      const arr = ["X-D", "1", "X-A", "q", "X-D", "2"];
      res.writeHead(200, arr);
      arr[0] = "X-Mutated";
      arr[3] = "mutated";
      res.end("ok");
    });
    expect(headers).toEqual(["X-D: 1", "X-A: q", "X-D: 2"]);
  });
});
