import { describe, expect, it } from "bun:test";
import { bunRun } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import { connect, createServer, Socket } from "node:net";
import { join } from "node:path";

// The kernel takes a part of a write and the socket keeps the rest until the
// peer reads. Node keeps such a write in a write request of the handle. The
// request completes in the async context of the write() call, and the close of
// the handle completes it with ECANCELED once destroy() has returned.
describe("a write that waits for the peer to read", () => {
  type ErrnoException = NodeJS.ErrnoException;
  // Three of these are more than a kernel takes from a peer that reads nothing.
  const BIG = Buffer.alloc(4 * 1024 * 1024, "a");

  // `writer` is the accepted socket ("server") or the connecting one ("client"). `reader` reads nothing.
  async function stalledPair(side: "server" | "client") {
    const server = createServer();
    await once(server.listen(0, "127.0.0.1"), "listening");
    const accepted = once(server, "connection") as Promise<[Socket]>;
    const client = connect((server.address() as import("node:net").AddressInfo).port, "127.0.0.1");
    const [[peer]] = await Promise.all([accepted, once(client, "connect")]);
    const [writer, reader] = side === "server" ? [peer, client] : [client, peer];
    reader.pause();
    reader.on("error", () => {});
    return {
      writer,
      reader,
      [Symbol.dispose]() {
        client.destroy();
        peer.destroy();
        server.close();
      },
    };
  }

  // The write callbacks and the 'close' of `writer`, in order.
  function eventLog(writer: Socket, describeError: (e: ErrnoException) => string) {
    const events: string[] = [];
    const closed = new Promise<void>(resolve => {
      writer.on("close", () => {
        events.push(`close with ${writer.writableLength} bytes`);
        resolve();
      });
    });
    writer.on("error", () => {});
    const written = (n: number) => (e?: ErrnoException | null) =>
      void events.push(`write#${n} ${e ? describeError(e) : "done"}`);
    return { events, closed, written };
  }

  it("destroy() completes it with ECANCELED, once destroy() has returned", async () => {
    using pair = await stalledPair("server");
    const { writer } = pair;
    const { events, closed, written } = eventLog(writer, e => `${e.code} ${e.syscall}`);
    for (let n = 1; n <= 3; n++) writer.write(BIG, written(n));
    expect(writer.writableLength).toBeGreaterThan(0);
    // A kernel that takes a whole write completes it inside write().
    const waiting = [1, 2, 3].slice(events.length);
    const before = events.length;

    events.push("destroy()");
    writer.destroy();
    events.push("destroy() returned");
    await closed;
    expect(events.slice(before)).toEqual([
      "destroy()",
      "destroy() returned",
      ...waiting.map(n => `write#${n} ECANCELED write`),
      "close with 0 bytes",
    ]);
  });

  it.each(["server", "client"] as const)("a reset from the peer fails it before 'close' (%s side)", async side => {
    using pair = await stalledPair(side);
    const { writer, reader } = pair;
    const { events, closed, written } = eventLog(writer, () => "failed");
    for (let n = 1; n <= 3; n++) writer.write(BIG, written(n));
    expect(writer.writableLength).toBeGreaterThan(0);
    const waiting = [1, 2, 3].slice(events.length);
    const before = events.length;

    reader.resetAndDestroy();
    await closed;
    expect(events.slice(before)).toEqual([...waiting.map(n => `write#${n} failed`), "close with 0 bytes"]);
  });

  it("completes in the async context of the write() call", async () => {
    using pair = await stalledPair("server");
    const { writer, reader } = pair;
    const storage = new AsyncLocalStorage<string>();
    const stores: (string | undefined)[] = [];
    const written = Promise.withResolvers<void>();
    // The socket was accepted in another context: a callback that runs where the socket reports its drain is not "writer".
    storage.run("writer", () => {
      for (let n = 1; n <= 3; n++) {
        writer.write(BIG, () => {
          if (stores.push(storage.getStore()) === 3) written.resolve();
        });
      }
    });
    expect(writer.writableLength).toBeGreaterThan(0);
    reader.resume();
    await written.promise;
    expect(stores).toEqual(["writer", "writer", "writer"]);
  });

  // Node reports it where the write request completes. The socket has no part in it.
  it("a throw in its callback reaches uncaughtException, and the socket keeps writing", async () => {
    const { stdout, stderr, exitCode } = await bunRun(
      join(import.meta.dir, "node-net-write-callback-throw-fixture.js"),
    );
    expect({ stdout, exitCode, ...(exitCode === 0 ? {} : { stderr }) }).toEqual({
      stdout: JSON.stringify(["waited:true", "write#1", "uncaught:write-boom", "write#2", "end", "close:false"]),
      exitCode: 0,
    });
  });
});
