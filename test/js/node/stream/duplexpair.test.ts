import { describe, expect, test } from "bun:test";
import { duplexPair, finished } from "node:stream";

async function turns(n: number) {
  for (let i = 0; i < n; i++) await new Promise<void>(r => setImmediate(r));
}

describe("stream.duplexPair destroy propagation", () => {
  test("destroy() on one side signals end on the peer readable side", async () => {
    const [a, b] = duplexPair();
    const evs: string[] = [];
    b.on("end", () => evs.push("end")).on("close", () => evs.push("close"));
    b.resume();
    a.destroy();
    await turns(10);
    // Peer readable side ends; peer writable side stays open (allowHalfOpen default).
    expect(evs).toEqual(["end"]);
  });

  test("destroy(err) on one side closes the peer without emitting error on it", async () => {
    const [a, b] = duplexPair();
    const evs: string[] = [];
    b.on("error", () => evs.push("error")).on("close", () => evs.push("close"));
    b.resume();
    a.on("error", () => {});
    a.destroy(new Error("boom"));
    await turns(10);
    expect(evs).toEqual(["close"]);
  });

  test("pending data is delivered and followed by end after destroy()", async () => {
    const [a, b] = duplexPair();
    const got: string[] = [];
    a.write("pend1");
    await turns(2);
    b.on("data", c => got.push(String(c))).on("end", () => got.push("<end>"));
    a.destroy();
    await turns(10);
    expect(got).toEqual(["pend1", "<end>"]);
  });

  test("finished() on the peer readable side fires after counterpart destroy()", async () => {
    const [a, b] = duplexPair();
    b.resume();
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    finished(b, { writable: false }, err => (err ? reject(err) : resolve(undefined)));
    a.destroy();
    await promise;
  });

  test("destroying both sides does not throw or double-signal", async () => {
    const [a, b] = duplexPair();
    const evs: string[] = [];
    b.on("error", () => evs.push("b-error"));
    a.on("error", () => evs.push("a-error"));
    a.destroy();
    b.destroy();
    await turns(10);
    expect(evs).toEqual([]);
    expect(a.destroyed).toBe(true);
    expect(b.destroyed).toBe(true);
  });
});
