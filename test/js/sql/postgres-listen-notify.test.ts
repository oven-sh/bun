// sql.listen() / subscription.unlisten() / sql.notify() (PostgreSQL LISTEN/NOTIFY).
//
// Wire-level behavior (which LISTEN/UNLISTEN statements reach the server, how
// NotificationResponse frames are routed, reconnect) is tested against a
// scripted backend: it runs without docker and can produce interleavings a
// real server cannot be made to produce on demand. Behavior only observable
// at process level (exit, uncaught exceptions, RSS) runs in a subprocess.
// End-to-end behavior runs against the docker-compose postgres service.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isDockerEnabled, tempDir } from "harness";
import net from "node:net";
import path from "node:path";
import {
  listeningServer,
  neverAnsweringServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgErrorResponse,
  pgInt32,
  pgNotificationResponse,
  pgRaw,
  pgReadFrontendMessages,
  pgReadyForQuery,
} from "./wire-frames";

const PID = 4242;
const SECRET = 99;
const pgBackendKeyData = (pid: number, secret: number) => pgRaw("K", Buffer.concat([pgInt32(pid), pgInt32(secret)]));
const pgError = (message: string) =>
  Buffer.concat([pgErrorResponse({ S: "ERROR", C: "42601", M: message }), pgReadyForQuery()]);

// Simple queries ('Q', which LISTEN/UNLISTEN use) are recorded per connection
// and acked, unless their channel is held (ack parked until release()) or
// armed to fail once. Extended-protocol queries (which notify() uses) are
// recorded from their Parse and rejected so they settle.
async function mockServer() {
  const connections: string[][] = [];
  const sockets = new Set<net.Socket>();
  const queryWaiters: Array<() => void> = [];
  const closeWaiters: Array<() => void> = [];
  const heldAcks: Array<() => void> = [];
  let held: string[] = [];
  const failOnce = new Set<string>();
  let closed = 0;

  const { port, server } = await listeningServer(socket => {
    const queries: string[] = [];
    connections.push(queries);
    sockets.add(socket);
    let buffered = Buffer.alloc(0);
    const record = (query: string) => {
      queries.push(query);
      for (const wake of queryWaiters.splice(0)) wake();
    };
    socket.once("data", () => {
      socket.write(Buffer.concat([pgAuthenticationOk(), pgBackendKeyData(PID, SECRET), pgReadyForQuery()]));
      socket.on("data", data => {
        buffered = pgReadFrontendMessages(Buffer.concat([buffered, data]), (type, body) => {
          if (type === 0x50 /* Parse: name\0 query\0 ... */) {
            const nameEnd = body.indexOf(0);
            record(body.toString("utf8", nameEnd + 1, body.indexOf(0, nameEnd + 1)));
            socket.write(pgError("mock rejects extended-protocol queries"));
            return;
          }
          if (type !== 0x51 /* Query: query\0 */) return;
          const query = body.toString("utf8", 0, body.length - 1);
          record(query);
          const space = query.indexOf(" ");
          const verb = query.slice(0, space);
          const channel = query.slice(space + 2, -1).replaceAll('""', '"');
          if (verb === "LISTEN" && failOnce.delete(channel)) {
            socket.write(pgError(`cannot LISTEN ${channel}`));
            return;
          }
          const ack = Buffer.concat([pgCommandComplete(verb), pgReadyForQuery()]);
          if (held.includes(channel)) heldAcks.push(() => socket.write(ack));
          else socket.write(ack);
        });
      });
    });
    socket.on("close", () => {
      sockets.delete(socket);
      closed++;
      for (const wake of closeWaiters.splice(0)) wake();
    });
    socket.on("error", () => {});
  });

  const all = () => connections.flat();
  const waitUntil = (waiters: Array<() => void>, done: () => boolean) =>
    done()
      ? Promise.resolve()
      : new Promise<void>(resolve => {
          const check = () => (done() ? resolve() : waiters.push(check));
          waiters.push(check);
        });

  return {
    url: `postgres://u@127.0.0.1:${port}/db`,
    /** Every query received so far, across connections, in arrival order. */
    get queries() {
      return all();
    },
    /** Queries received on each connection, in accept order. */
    connections,
    get liveConnections() {
      return sockets.size;
    },
    untilQuery: (pred: (queries: string[]) => boolean) => waitUntil(queryWaiters, () => pred(all())),
    untilClosed: (count: number) => waitUntil(closeWaiters, () => closed >= count),
    notify(channel: string, payload: string) {
      this.notifyMany([[channel, payload]]);
    },
    /** Several notifications in one segment, so they arrive in one read. */
    notifyMany(frames: Array<[channel: string, payload: string]>) {
      const blob = Buffer.concat(frames.map(([channel, payload]) => pgNotificationResponse(PID, channel, payload)));
      for (const socket of sockets) socket.write(blob);
    },
    hold: (...channels: string[]) => void (held = channels),
    release() {
      held = [];
      for (const ack of heldAcks.splice(0)) ack();
    },
    failNextListen: (channel: string) => void failOnce.add(channel),
    dropConnections() {
      for (const socket of sockets) socket.destroy();
    },
    [Symbol.asyncDispose]: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

const client = (url: string) => new SQL(url, { max: 1, connectionTimeout: 5, idleTimeout: 5 });

/** A promise plus ways to settle it: `open()` now, or `after(n)` on the n-th call of the returned function. */
function gate() {
  const { promise, resolve } = Promise.withResolvers<void>();
  let calls = 0;
  return Object.assign(promise, {
    open: () => resolve(),
    after: (count: number) => () => void (++calls === count && resolve()),
  });
}

describe("listen", () => {
  test("routes notifications to the channel's listener, in order", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const got: string[] = [];
    const third = gate();
    const count = third.after(3);

    const subscription = await sql.listen("orders", payload => {
      got.push(payload);
      count();
    });
    expect(server.queries).toEqual(['LISTEN "orders"']);
    expect(subscription.channel).toBe("orders");

    server.notifyMany([
      ["orders", "1"],
      ["other", "not subscribed"],
      ["orders", ""],
      ["orders", "3"],
    ]);
    await third;
    expect(got).toEqual(["1", "", "3"]);
  });

  test("thousands of notifications across channels arriving in one read", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const total = 3000;
    const counts = { a: 0, b: 0, c: 0 };
    const done = gate();
    const count = done.after(total);
    const listener = (channel: keyof typeof counts) => () => {
      counts[channel]++;
      count();
    };
    await Promise.all([sql.listen("a", listener("a")), sql.listen("b", listener("b")), sql.listen("c", listener("c"))]);

    const channels = ["a", "b", "c"] as const;
    server.notifyMany(Array.from({ length: total }, (_, i) => [channels[i % 3], String(i)]));
    await done;
    expect(counts).toEqual({ a: 1000, b: 1000, c: 1000 });
  });

  test("channel names and payloads are UTF-8", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const got = Promise.withResolvers<string>();
    await sql.listen("канал", got.resolve);
    expect(server.queries).toEqual(['LISTEN "канал"']);
    server.notify("канал", "héllo → 世界 🚀");
    expect(await got.promise).toBe("héllo → 世界 🚀");
  });

  test("channel names are quoted as identifiers", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const channel = 'weird "name"; DROP TABLE x';
    const got = Promise.withResolvers<string>();
    await sql.listen(channel, got.resolve);
    expect(server.queries).toEqual(['LISTEN "weird ""name""; DROP TABLE x"']);
    server.notify(channel, "ok");
    expect(await got.promise).toBe("ok");
  });

  test("channel names are limited to PostgreSQL's 63 identifier bytes, counted in UTF-8", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const ascii63 = Buffer.alloc(63, "c").toString();
    const cjk63 = Buffer.alloc(63, "字").toString(); // 21 characters
    const cjk66 = Buffer.alloc(66, "字").toString(); // 22 characters, 66 bytes
    await expect(sql.listen(ascii63 + "c", () => {})).rejects.toThrow(/63 bytes/);
    await expect(sql.listen(cjk66, () => {})).rejects.toThrow(/63 bytes/);
    expect(() => sql.notify(cjk66)).toThrow(/63 bytes/);

    await sql.listen(ascii63, () => {});
    await sql.listen(cjk63, () => {});
    expect(server.queries).toEqual([`LISTEN "${ascii63}"`, `LISTEN "${cjk63}"`]);
  });

  test("several listeners on one channel share one LISTEN and each receives", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const got: Record<string, string[]> = { a: [], b: [], c: [] };
    const all = gate();
    const count = all.after(3);
    for (const name of Object.keys(got)) {
      await sql.listen("ch", payload => {
        got[name].push(payload);
        count();
      });
    }
    expect(server.queries).toEqual(['LISTEN "ch"']);
    server.notify("ch", "x");
    await all;
    expect(got).toEqual({ a: ["x"], b: ["x"], c: ["x"] });
  });

  test("concurrent listen() calls on a new channel share its round trip", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const all = gate();
    const count = all.after(3);
    const subscriptions = await Promise.all([1, 2, 3].map(() => sql.listen("ch", () => count())));
    expect(server.queries).toEqual(['LISTEN "ch"']);
    expect(subscriptions.map(subscription => subscription.channel)).toEqual(["ch", "ch", "ch"]);
    expect(new Set(subscriptions).size).toBe(3);
    server.notify("ch", "x");
    await all;
  });

  test("a listener that unlistens itself mid-dispatch does not starve the others", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const calls: string[] = [];
    let count = () => {};
    const oneShot = await sql.listen("ch", payload => {
      calls.push("oneShot:" + payload);
      void oneShot.unlisten();
      count();
    });
    for (const name of ["b", "c"]) {
      await sql.listen("ch", payload => {
        calls.push(`${name}:${payload}`);
        count();
      });
    }

    const first = gate();
    count = first.after(3);
    server.notify("ch", "1");
    await first;
    expect(calls).toEqual(["oneShot:1", "b:1", "c:1"]);

    const second = gate();
    count = second.after(2);
    calls.length = 0;
    server.notify("ch", "2");
    await second;
    expect(calls).toEqual(["b:2", "c:2"]);
  });

  test("a listener added from inside a callback receives the next notification, not the current one", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const calls: string[] = [];
    const done = gate();
    const count = done.after(5); // a:1 b:1 a:2 b:2 late:2
    await sql.listen("ch", payload => {
      calls.push("a:" + payload);
      if (payload === "1") {
        // Registers synchronously (the channel is already subscribed); the
        // dispatch in progress must not pick it up.
        void sql.listen("ch", p => {
          calls.push("late:" + p);
          count();
        });
      }
      count();
    });
    await sql.listen("ch", payload => {
      calls.push("b:" + payload);
      count();
    });

    server.notifyMany([
      ["ch", "1"],
      ["ch", "2"],
    ]);
    await done;
    expect(calls).toEqual(["a:1", "b:1", "a:2", "b:2", "late:2"]);
  });

  test("registering the same callback twice is two subscriptions, each removed by its own handle", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    let calls = 0;
    let count = () => {};
    const callback = () => {
      calls++;
      count();
    };
    const first = await sql.listen("ch", callback);
    const second = await sql.listen("ch", callback);
    expect(first).not.toBe(second);

    const both = gate();
    count = both.after(2);
    server.notify("ch", "x");
    await both;
    expect(calls).toBe(2);

    await first.unlisten();
    const one = gate();
    count = one.open;
    server.notify("ch", "y");
    await one;
    // This round trip is ordered after any second delivery of "y".
    await sql.listen("barrier", () => {});
    expect(calls).toBe(3);
    expect(server.queries).toEqual(['LISTEN "ch"', 'LISTEN "barrier"']);

    await second.unlisten();
    expect(server.queries).toEqual(['LISTEN "ch"', 'LISTEN "barrier"', 'UNLISTEN "ch"']);
  });

  test("onlisten runs after the LISTEN ack and before listen() resolves", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const events: string[] = [];
    const subscription = await sql.listen(
      "ch",
      () => {},
      () => events.push(`onlisten after ${server.queries.length} queries`),
    );
    events.push("resolved");
    expect(events).toEqual(["onlisten after 1 queries", "resolved"]);
    expect(subscription.channel).toBe("ch");
  });

  test("a later subscriber's onlisten runs once although no LISTEN is sent", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    await sql.listen("ch", () => {});
    let onlisten = 0;
    await sql.listen(
      "ch",
      () => {},
      () => onlisten++,
    );
    expect(onlisten).toBe(1);
    expect(server.queries).toEqual(['LISTEN "ch"']);
  });
});

describe("unlisten", () => {
  test("removing one of several listeners is local; removing the last sends UNLISTEN", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    await sql.listen("keep", () => {});
    const a = await sql.listen("ch", () => {});
    const b = await sql.listen("ch", () => {});

    await a.unlisten();
    expect(server.queries).toEqual(['LISTEN "keep"', 'LISTEN "ch"']);
    await b.unlisten();
    expect(server.queries).toEqual(['LISTEN "keep"', 'LISTEN "ch"', 'UNLISTEN "ch"']);
  });

  test("unlisten() and `await using` remove exactly that subscription; unlisten() is idempotent", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const kept: string[] = [];
    const arrived = gate();
    await sql.listen("ch", payload => {
      kept.push(payload);
      arrived.open();
    });

    const removed: string[] = [];
    {
      await using _subscription = await sql.listen("ch", payload => removed.push(payload));
    }
    const subscription = await sql.listen("ch", payload => removed.push(payload));
    await subscription.unlisten();
    await subscription.unlisten();

    server.notify("ch", "x");
    await arrived;
    expect(kept).toEqual(["x"]);
    expect(removed).toEqual([]);
    expect(server.queries).toEqual(['LISTEN "ch"']);
  });

  test("delivery stops at unlisten(), before its round trip completes", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    await sql.listen("keep", () => {});
    const got: string[] = [];
    const subscription = await sql.listen("ch", payload => got.push(payload));

    server.hold("ch");
    const unlistening = subscription.unlisten();
    server.notify("ch", "late");
    server.release();
    // The UNLISTEN ack is written after the notification, so by the time
    // this resolves the notification has been processed.
    await unlistening;
    expect(got).toEqual([]);
  });

  test("removing the last subscription closes the connection instead of sending UNLISTEN", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const subscription = await sql.listen("ch", () => {});
    expect(server.liveConnections).toBe(1);
    await subscription.unlisten();
    await server.untilClosed(1);
    expect(server.queries).toEqual(['LISTEN "ch"']);

    await sql.listen("ch", () => {});
    expect(server.connections).toEqual([['LISTEN "ch"'], ['LISTEN "ch"']]);
  });

  test("unlisten() resolves when the connection drops during its round trip", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    await sql.listen("keep", () => {});
    const subscription = await sql.listen("ch", () => {});
    server.hold("ch");
    const unlistening = subscription.unlisten();
    await server.untilQuery(queries => queries.includes('UNLISTEN "ch"'));
    server.dropConnections();
    await unlistening;
  });

  test("a handle from before close() is a no-op afterwards, also for a re-opened client", async () => {
    await using server = await mockServer();
    const sql = client(server.url);
    const stale = await sql.listen("ch", () => {});
    await sql.close();
    await stale.unlisten();

    await using reopened = client(server.url);
    const got = Promise.withResolvers<string>();
    await reopened.listen("ch", got.resolve);
    await stale.unlisten();
    server.notify("ch", "still subscribed");
    expect(await got.promise).toBe("still subscribed");
    expect(server.queries).toEqual(['LISTEN "ch"', 'LISTEN "ch"']);
  });
});

describe("listen/unlisten interleavings", () => {
  test("a re-listen() while the UNLISTEN is in flight gets its own LISTEN, ordered after it", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    await sql.listen("keep", () => {});
    const first = await sql.listen("ch", () => {});
    server.hold("ch");
    const unlistening = first.unlisten();
    const got = Promise.withResolvers<string>();
    const relistening = sql.listen("ch", got.resolve);
    server.release();
    await Promise.all([unlistening, relistening]);
    expect(server.queries).toEqual(['LISTEN "keep"', 'LISTEN "ch"', 'UNLISTEN "ch"', 'LISTEN "ch"']);
    server.notify("ch", "after");
    expect(await got.promise).toBe("after");
  });

  test("a rejected LISTEN rejects that listen() and leaves nothing registered", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    await sql.listen("keep", () => {});
    server.failNextListen("bad");
    await expect(sql.listen("bad", () => {})).rejects.toThrow("cannot LISTEN bad");
    await sql.listen("bad", () => {});
    expect(server.queries).toEqual(['LISTEN "keep"', 'LISTEN "bad"', 'LISTEN "bad"']);
  });

  test("a rejected LISTEN shared by concurrent callers rejects all of them and releases the connection", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    server.hold("ch");
    server.failNextListen("ch");
    const a = sql.listen("ch", () => {});
    const b = sql.listen("ch", () => {});
    server.release();
    const results = await Promise.allSettled([a, b]);
    expect(results.map(result => result.status)).toEqual(["rejected", "rejected"]);
    await server.untilClosed(1);
  });

  test("a connection failure rejects listen()", async () => {
    const { port, server } = await listeningServer(socket => socket.destroy());
    try {
      await using sql = client(`postgres://u@127.0.0.1:${port}/db`);
      await expect(sql.listen("ch", () => {})).rejects.toThrow();
    } finally {
      server.close();
    }
  });
});

describe("reconnect", () => {
  test("re-subscribes every channel, runs onlisten again, resumes delivery", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const bothAgain = gate();
    const onlisten = bothAgain.after(4); // two channels, twice each
    const got = Promise.withResolvers<string>();
    await sql.listen("a", got.resolve, onlisten);
    await sql.listen("b", () => {}, onlisten);

    server.dropConnections();
    await bothAgain;
    expect(server.connections).toHaveLength(2);
    expect(server.connections[1].toSorted()).toEqual(['LISTEN "a"', 'LISTEN "b"']);

    server.notify("a", "after");
    expect(await got.promise).toBe("after");
  });

  test("an unlistened subscription's onlisten does not run again on reconnect", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const keptAgain = gate();
    const removed = { onlisten: 0 };
    await sql.listen("ch", () => {}, keptAgain.after(2));
    const subscription = await sql.listen(
      "ch",
      () => {},
      () => removed.onlisten++,
    );
    expect(removed.onlisten).toBe(1);
    await subscription.unlisten();

    server.dropConnections();
    await keptAgain;
    expect(removed.onlisten).toBe(1);
  });

  test("a listen() during the backoff brings the connection up and re-subscribes the rest on it", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const oldAgain = gate();
    await sql.listen("old", () => {}, oldAgain.after(2));
    server.dropConnections();
    await server.untilClosed(1);

    // The adapter may observe the drop a moment after the server did; a
    // listen() landing on the dying connection rejects, so retry.
    let added = false;
    while (!added) {
      await sql
        .listen("new", () => {})
        .then(
          () => (added = true),
          () => {},
        );
    }
    await oldAgain;
    const replacement = server.connections.at(-1)!;
    expect(replacement.toSorted()).toEqual(['LISTEN "new"', 'LISTEN "old"']);
  });

  test("a channel whose re-LISTEN is rejected is retried with backoff and warns", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
    try {
      const resubscribed = gate();
      await sql.listen("flaky", () => {}, resubscribed.after(2));
      server.failNextListen("flaky");
      server.dropConnections();
      await resubscribed;
      expect(server.connections.at(-1)!.filter(query => query === 'LISTEN "flaky"')).toHaveLength(2);
      expect(warnings).toEqual([expect.stringContaining('LISTEN "flaky" failed, retrying: cannot LISTEN flaky')]);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("unlistening everything during the backoff cancels the reconnect", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const subscription = await sql.listen("ch", () => {});
    server.dropConnections();
    await server.untilClosed(1);
    await subscription.unlisten();

    // Span at least one backoff period deterministically: a second client
    // goes through a full drop-and-reconnect against the same server. Had the
    // first client's timer still been armed, it would have fired within it.
    await using other = client(server.url);
    const reconnected = gate();
    await other.listen("other", () => {}, reconnected.after(2));
    server.dropConnections();
    await reconnected;

    expect(server.queries.filter(query => query === 'LISTEN "ch"')).toHaveLength(1);
    expect(server.liveConnections).toBe(1);
  });

  test("a listen() that reconnects but has its LISTEN rejected still gets the channel's other listener repaired", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const repaired = gate();
    const got = Promise.withResolvers<string>();
    await sql.listen("ch", got.resolve, repaired.after(2));

    // Plain awaits rather than expect().rejects: that one runs the event loop
    // re-entrantly, and this code is still inside the dropped connection's
    // data callback; on Windows the inner run frees the socket under it.
    const outcome = (promise: Promise<unknown>) =>
      promise.then(
        () => "resolved",
        (err: Error) => err.message,
      );

    // Issued in the same tick as the drop, this lands on the dying connection
    // and rejects once the client has processed the drop, which is the moment
    // the client considers "ch" unsubscribed and has armed its backoff.
    server.dropConnections();
    expect(await outcome(sql.listen("probe", () => {}))).toMatch(/closed/i);

    // This listen() brings the connection back (cancelling the backoff) and is
    // the one sending LISTEN "ch"; its rejection must not strand the first listener.
    server.failNextListen("ch");
    expect(await outcome(sql.listen("ch", () => {}))).toBe("cannot LISTEN ch");

    await repaired;
    expect(server.connections).toEqual([['LISTEN "ch"'], ['LISTEN "ch"', 'LISTEN "ch"']]);
    server.notify("ch", "after");
    expect(await got.promise).toBe("after");
  });
});

describe("onconnect/onclose", () => {
  test("fire for the listen connection on connect, drop, and reconnect", async () => {
    await using server = await mockServer();
    const events: string[] = [];
    const reconnected = gate();
    await using sql = new SQL(server.url, {
      max: 1,
      onconnect: (err: Error | null) => events.push(`onconnect ${err === null ? "null" : err.message}`),
      onclose: (err: Error) => events.push(`onclose ${err.message}`),
    });
    await sql.listen("orders", () => {}, reconnected.after(2));
    expect(events).toEqual(["onconnect null"]);

    server.dropConnections();
    await reconnected; // the second onlisten marks the reconnect
    // The drop error depends on how the peer close surfaces (FIN vs RST), so
    // only the event order is pinned.
    expect(events).toEqual(["onconnect null", expect.stringMatching(/^onclose .+/), "onconnect null"]);
  });

  test("sql.close() fires onclose for the listen connection", async () => {
    await using server = await mockServer();
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    const sql = new SQL(server.url, {
      max: 1,
      onconnect: () => events.push("onconnect"),
      onclose: (err: Error) => {
        events.push(`onclose ${err.message}`);
        closed.resolve();
      },
    });
    await sql.listen("orders", () => {});
    await sql.close();
    await closed.promise;
    expect(events).toEqual(["onconnect", "onclose Connection closed"]);
  });

  test("failed reconnect attempts fire neither onconnect nor onclose", async () => {
    // The mid-test dispose makes the scope-exit dispose a harmless second close.
    await using server = await mockServer();
    const events: string[] = [];
    const dropped = Promise.withResolvers<void>();
    await using sql = new SQL(server.url, {
      max: 1,
      onconnect: () => events.push("onconnect"),
      onclose: () => {
        events.push("onclose");
        dropped.resolve();
      },
    });
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
    try {
      await sql.listen("orders", () => {});
      const closing = server[Symbol.asyncDispose](); // stop accepting, so every retry dial fails
      server.dropConnections();
      await closing;
      await dropped.promise;
      // each failed dial logs the retry warning; wait for two attempts
      const deadline = Date.now() + 4000;
      while (warnings.length < 2 && Date.now() < deadline) await Bun.sleep(10);
      expect(warnings.length).toBeGreaterThanOrEqual(2);
      expect(events).toEqual(["onconnect", "onclose"]);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("close()", () => {
  test("tears down the listen connection and rejects an in-flight listen()", async () => {
    await using server = await mockServer();
    const sql = client(server.url);
    const subscription = await sql.listen("ch", () => {});
    server.hold("pending");
    const pending = sql.listen("pending", () => {});
    await server.untilQuery(queries => queries.includes('LISTEN "pending"'));

    await sql.close();
    await expect(pending).rejects.toThrow();
    await server.untilClosed(1);
    await expect(sql.listen("ch", () => {})).rejects.toThrow("Connection closed");
    await subscription.unlisten();
  });

  test("in the same tick as a listen() on the live connection rejects it before any LISTEN is sent", async () => {
    await using server = await mockServer();
    const sql = client(server.url);
    await sql.listen("keep", () => {});
    // Plain awaits: this continuation is inside the live connection's data callback (see the reconnect suite).
    const outcome = sql
      .listen("ch", () => {})
      .then(
        () => "resolved",
        (err: Error) => err.message,
      );
    const closing = sql.close();
    expect(await outcome).toBe("Connection closed");
    await closing;
    expect(server.queries).toEqual(['LISTEN "keep"']);
  });

  test("during the handshake aborts it and rejects the listen()", async () => {
    const { port, server } = await neverAnsweringServer();
    try {
      const sql = new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1, connectionTimeout: 60 });
      const listening = sql.listen("ch", () => {});
      await sql.close();
      await expect(listening).rejects.toThrow();
    } finally {
      server.close();
    }
  });

  test("an invalid timeout rejects before touching the subscriptions", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    const got = Promise.withResolvers<string>();
    await sql.listen("ch", got.resolve);
    await expect(sql.close({ timeout: -1 })).rejects.toThrow();
    server.notify("ch", "still subscribed");
    expect(await got.promise).toBe("still subscribed");
  });
});

describe("arguments", () => {
  test.each(["postgres", "sqlite"] as const)("%s: invalid arguments fail before any I/O", async adapter => {
    await using sql = adapter === "postgres" ? client("postgres://u@127.0.0.1:1/db") : new SQL("sqlite://:memory:");
    const callback = () => {};
    await expect(sql.listen("", callback)).rejects.toThrow(/non-empty/);
    await expect(sql.listen("a\0b", callback)).rejects.toThrow(/null bytes/);
    await expect(sql.listen("ch", 1 as any)).rejects.toThrow(/onnotify/);
    await expect(sql.listen("ch", callback, 1 as any)).rejects.toThrow(/onlisten/);
    expect(() => sql.notify("", "p")).toThrow(/non-empty/);
    expect(() => sql.notify("ch", null as any)).toThrow(/payload/);
    expect(() => sql.notify("ch", 1 as any)).toThrow(/payload/);
  });

  test("non-Postgres adapters reject with a clear error", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await expect(sql.listen("ch", () => {})).rejects.toThrow("PostgreSQL only");
    await expect(sql.notify("ch", "p")).rejects.toThrow("PostgreSQL only");
    await expect(sql.notify("ch")).rejects.toThrow("PostgreSQL only");
  });

  test("reserved connections expose listen() on the client's shared listen connection; unlisten lives on the subscription only", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    using reserved = await sql.reserve();
    expect("unlisten" in sql).toBe(false);
    expect("unlisten" in reserved).toBe(false);
    const viaReserved = await reserved.listen("ch", () => {});
    expect(typeof viaReserved.unlisten).toBe("function");
    const viaClient = await sql.listen("ch", () => {});
    expect(server.queries).toEqual(['LISTEN "ch"']);
    await viaReserved.unlisten();
    await viaClient.unlisten();
    await server.untilClosed(1);
    expect(server.queries).toEqual(['LISTEN "ch"']);
    expect(typeof reserved.notify).toBe("function");
  });
});

describe("notify()", () => {
  test("is sent through the pool without being awaited, and opens no listen connection", async () => {
    await using server = await mockServer();
    await using sql = client(server.url);
    // Both calls share one prepared statement, so a single Parse arrives and
    // the mock's rejection of it settles both. Payload values are checked end
    // to end in the docker suite.
    const settled = Promise.allSettled([sql.notify("ch", "payload"), sql.notify("signal")]);
    await server.untilQuery(queries => queries.some(query => query.includes("pg_notify($1, $2)")));
    expect((await settled).map(result => result.status)).toEqual(["rejected", "rejected"]);
    expect(server.liveConnections).toBe(1);
  });
});

describe("in a subprocess", () => {
  const wireFrames = path.join(import.meta.dir, "wire-frames.ts");
  // The mock runs inside the child and is unref'd, so only the subscription
  // under test can hold the child open. `notifyMany`, `dropConnections`,
  // `sockets`, `pgNotificationResponse` and `sql` are in scope for `body`.
  async function run(body: string, env: Record<string, string> = {}) {
    using dir = tempDir("pg-listen-subprocess", {
      "fixture.ts": `
        import { SQL } from "bun";
        import { listeningServer, pgAuthenticationOk, pgReadyForQuery, pgCommandComplete, pgNotificationResponse, pgReadFrontendMessages, pgRaw, pgInt32 } from ${JSON.stringify(wireFrames)};
        const sockets = new Set();
        const { port, server } = await listeningServer(socket => {
          sockets.add(socket);
          socket.unref();
          let buffered = Buffer.alloc(0);
          socket.once("data", () => {
            socket.write(Buffer.concat([pgAuthenticationOk(), pgRaw("K", Buffer.concat([pgInt32(1), pgInt32(2)])), pgReadyForQuery()]));
            socket.on("data", data => {
              buffered = pgReadFrontendMessages(Buffer.concat([buffered, data]), (type, body) => {
                if (type !== 0x51) return;
                socket.write(Buffer.concat([pgCommandComplete(body.toString("utf8", 0, body.indexOf(" "))), pgReadyForQuery()]));
              });
            });
          });
          socket.on("close", () => sockets.delete(socket));
        });
        server.unref();
        const notifyMany = frames => {
          const blob = Buffer.concat(frames.map(([channel, payload]) => pgNotificationResponse(1, channel, payload)));
          for (const socket of sockets) socket.write(blob);
        };
        const dropConnections = () => { for (const socket of sockets) socket.destroy(); };
        const sql = new SQL("postgres://u@127.0.0.1:" + port + "/db", { max: 1 });
        ${body}
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      cwd: String(dir),
      env: { ...bunEnv, ...env },
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stdout,
      stderr: stderr
        .split("\n")
        .filter(line => line && !line.startsWith("WARNING: ASAN"))
        .join("\n"),
      exitCode,
      signal: proc.signalCode,
    };
  }
  const clean = (stdout: string) => ({ stdout, stderr: "", exitCode: 0, signal: null });

  test("a subscription keeps the process alive until it is removed", async () => {
    const result = await run(`
      const subscription = await sql.listen("ch", async payload => {
        console.log("got " + payload);
        await subscription.unlisten();
        console.log("unlistened");
      });
      console.log("subscribed");
      // Sent from an unref'd timer after top-level code finishes, so the
      // subscription is the only thing keeping the process here.
      setTimeout(() => notifyMany([["ch", "wake"]]), 20).unref();
    `);
    expect(result).toEqual(clean("subscribed\ngot wake\nunlistened\n"));
  });

  test("a dropped connection keeps the process alive through the backoff and reconnects", async () => {
    const result = await run(`
      let subscribes = 0;
      const subscription = await sql.listen("ch", () => {}, () => {
        if (++subscribes === 2) { console.log("reconnected"); subscription.unlisten(); }
      });
      console.log("subscribed");
      dropConnections();
    `);
    expect(result).toEqual(clean("subscribed\nreconnected\n"));
  });

  test("sql.close() releases a subscription so the process exits", async () => {
    const result = await run(`
      await sql.listen("ch", () => {});
      await sql.close();
      console.log("closed");
    `);
    expect(result).toEqual(clean("closed\n"));
  });

  test("a throwing listener surfaces as uncaughtException; the channel's other listeners and later notifications are unaffected", async () => {
    const result = await run(`
      process.on("uncaughtException", err => console.log("uncaught: " + err.message));
      const first = await sql.listen("ch", payload => {
        console.log("first got " + payload);
        if (payload === "bad") throw new Error("listener failed");
      });
      const second = await sql.listen("ch", payload => {
        console.log("second got " + payload);
        if (payload === "good") { first.unlisten(); second.unlisten(); }
      });
      notifyMany([["ch", "bad"], ["ch", "good"]]);
    `);
    expect(result).toEqual(
      clean(
        ["first got bad", "uncaught: listener failed", "second got bad", "first got good", "second got good", ""].join(
          "\n",
        ),
      ),
    );
  });

  test("a lone throwing listener surfaces as uncaughtException and later notifications still arrive", async () => {
    const result = await run(`
      process.on("uncaughtException", err => console.log("uncaught: " + err.message));
      const subscription = await sql.listen("ch", payload => {
        console.log("got " + payload);
        if (payload === "bad") throw new Error("listener failed");
        subscription.unlisten();
      });
      notifyMany([["ch", "bad"], ["ch", "good"]]);
    `);
    expect(result).toEqual(clean("got bad\nuncaught: listener failed\ngot good\n"));
  });

  test("a throwing onlisten surfaces as uncaughtException; listen() resolves and the reconnect is not retried", async () => {
    // An empty stderr is the assertion that the reconnect sweep did not take
    // the second throw for a failed LISTEN (which it warns about and retries).
    const result = await run(`
      process.on("uncaughtException", err => console.log("uncaught: " + err.message));
      let calls = 0;
      const subscription = await sql.listen("ch", () => {}, () => {
        console.log("onlisten " + ++calls);
        if (calls === 2) subscription.unlisten().then(() => console.log("unlistened"));
        throw new Error("onlisten failed " + calls);
      });
      console.log("subscribed to " + subscription.channel);
      dropConnections();
    `);
    expect(result).toEqual(
      clean(
        [
          "onlisten 1",
          "uncaught: onlisten failed 1",
          "subscribed to ch",
          "onlisten 2",
          "uncaught: onlisten failed 2",
          "unlistened",
          "",
        ].join("\n"),
      ),
    );
  });

  test("a throwing onconnect surfaces as uncaughtException and does not break the subscription", async () => {
    const result = await run(`
      process.on("uncaughtException", err => console.log("uncaught: " + err.message));
      const sql2 = new SQL("postgres://u@127.0.0.1:" + port + "/db", {
        max: 1,
        onconnect: () => { throw new Error("onconnect failed"); },
      });
      const subscription = await sql2.listen("ch", payload => {
        console.log("got " + payload);
        subscription.unlisten();
      });
      console.log("subscribed");
      notifyMany([["ch", "wake"]]);
    `);
    expect(result).toEqual(clean("uncaught: onconnect failed\nsubscribed\ngot wake\n"));
  });

  test("delivering many notifications retains nothing", async () => {
    // Measured by RSS so a leaked native string backing (invisible to the JS
    // heap) is caught. Each phase delivers its volume twice and reports the
    // growth across the second pass: the first pass takes RSS to its steady
    // state (the allocator keeps the GC's between-collection high-water mark
    // of payload strings as free memory), after which a correct
    // implementation shows roughly no growth and leaking one string per
    // notification shows the pass's full payload volume.
    const result = await run(
      `
      const channels = ["a", "b", "c", "d"];
      let listener;
      for (const channel of channels) await sql.listen(channel, payload => listener(payload));
      const segment = (count, payload) => [count, Buffer.concat(Array.from({ length: count }, (_, i) => pgNotificationResponse(1, channels[i % 4], payload)))];
      const deliver = ([count, blob]) => new Promise(done => {
        let remaining = count;
        listener = () => { if (--remaining === 0) done(); };
        for (const socket of sockets) socket.write(blob);
      });
      const rss = () => { Bun.gc(true); return process.memoryUsage.rss(); };
      const measure = async (seg, rounds) => {
        const pass = async () => { for (let i = 0; i < rounds; i++) await deliver(seg); };
        await pass();
        const base = rss();
        await pass();
        return Math.round((rss() - base) / 1024 / 1024);
      };
      // 256 KiB per segment, 96 segments = 24 MiB per pass.
      const small = await measure(segment(256, Buffer.alloc(1024, 0x61).toString()), 96);
      const large = await measure(segment(4, Buffer.alloc(64 * 1024, 0x62).toString()), 96);
      console.log(JSON.stringify({ small, large }));
      await sql.close();
    `,
      { ASAN_OPTIONS: "quarantine_size_mb=4:detect_leaks=0" },
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const growth = JSON.parse(result.stdout);
    // Steady state drifts by a few MiB between passes; a leak adds ~24 MiB.
    expect(growth).toEqual({ small: expect.any(Number), large: expect.any(Number) });
    expect(growth.small, JSON.stringify(growth)).toBeLessThan(6);
    expect(growth.large, JSON.stringify(growth)).toBeLessThan(6);
  }, 30_000);
});

if (isDockerEnabled()) {
  describeWithContainer("postgres", { image: "postgres_plain" }, container => {
    const connect = () =>
      new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, { max: 2 });
    // The listening backend is the session whose last statement is our LISTEN.
    const terminateListeningBackend = async (sql: SQL, channel: string) => {
      const terminated = await sql`
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query = ${`LISTEN "${channel}"`}
      `;
      expect(terminated).toHaveLength(1);
    };

    test("notify() round trips payloads, including empty and omitted", async () => {
      await container.ready;
      await using sql = connect();
      const got: string[] = [];
      const three = gate();
      const count = three.after(3);
      await using subscription = await sql.listen("e2e", payload => {
        got.push(payload);
        count();
      });
      expect(subscription.channel).toBe("e2e");
      await sql.notify("e2e", JSON.stringify({ n: 1 }));
      await sql.notify("e2e", "");
      await sql.notify("e2e");
      await three;
      expect(got).toEqual(['{"n":1}', "", ""]);
    });

    test("notify() in a transaction is delivered on commit and dropped on rollback", async () => {
      await container.ready;
      await using sql = connect();
      const got: string[] = [];
      const barrier = gate();
      await using _subscription = await sql.listen("e2e_tx", payload => {
        got.push(payload);
        if (payload === "barrier") barrier.open();
      });

      await expect(
        sql.begin(async tx => {
          await tx.notify("e2e_tx", "rolled back");
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      await sql.begin(tx => tx.notify("e2e_tx", "committed"));
      await sql.notify("e2e_tx", "barrier");
      await barrier;
      expect(got).toEqual(["committed", "barrier"]);
    });

    // The LISTEN/NOTIFY tests of postgres.js (tests/index.js), adapted to the
    // subscription object, with its delay() calls replaced by waiting for the
    // deliveries themselves. Notifications to one connection arrive in order,
    // so a later delivery proves an earlier notification was or was not
    // delivered.
    describe("ported from postgres.js", () => {
      test("listen and notify", async () => {
        await container.ready;
        await using sql = connect();
        const result = Promise.withResolvers<string>();
        await sql.listen("pgjs_hello", result.resolve);
        await sql.notify("pgjs_hello", "works");
        expect(await result.promise).toBe("works");
      });

      test("double listen", async () => {
        await container.ready;
        await using sql = connect();
        let count = 0;
        for (let i = 0; i < 2; i++) {
          const received = Promise.withResolvers<string>();
          await sql.listen("pgjs_hello", received.resolve);
          await sql.notify("pgjs_hello", "world");
          await received.promise;
          count++;
        }
        await sql.listen("pgjs_weee", () => {});
        expect(count).toBe(2);
      });

      test("multiple listeners work after a reconnect", async () => {
        await container.ready;
        await using sql = connect();
        const xs: string[] = [];
        let count = () => {};
        const resubscribed = gate();
        await sql.listen(
          "pgjs_reconnect_multi",
          x => {
            xs.push("1" + x);
            count();
          },
          resubscribed.after(2),
        );
        await sql.listen("pgjs_reconnect_multi", x => {
          xs.push("2" + x);
          count();
        });

        const a = gate();
        count = a.after(2);
        await sql.notify("pgjs_reconnect_multi", "a");
        await a;
        await terminateListeningBackend(sql, "pgjs_reconnect_multi");
        await resubscribed;
        const b = gate();
        count = b.after(2);
        await sql.notify("pgjs_reconnect_multi", "b");
        await b;
        expect(xs.join("")).toBe("1a2a1b2b");
      });

      test("listen and notify with weird name", async () => {
        await container.ready;
        await using sql = connect();
        const channel = "wat-;.ø.§";
        const got: string[] = [];
        const first = gate();
        const subscription = await sql.listen(channel, payload => {
          got.push(payload);
          first.open();
        });
        await sql.notify(channel, "works");
        await first;
        await subscription.unlisten();

        const barrier = gate();
        await sql.listen("pgjs_barrier", barrier.open);
        await sql.notify(channel, "after unlisten");
        await sql.notify("pgjs_barrier", "");
        await barrier;
        expect(got).toEqual(["works"]);
      });

      test("listen and notify with upper case", async () => {
        await container.ready;
        await using sql = connect();
        const result = Promise.withResolvers<string>();
        await sql.listen("withUpperChar", result.resolve);
        await sql.notify("withUpperChar", "works");
        expect(await result.promise).toBe("works");
      });

      test("listen reconnects", async () => {
        await container.ready;
        await using sql = connect();
        const a = gate();
        const b = gate();
        const resolvers: Record<string, () => void> = { a: a.open, b: b.open };
        let connects = 0;
        const reconnected = gate();
        await sql.listen(
          "pgjs_reconnect",
          x => resolvers[x]?.(),
          () => {
            if (++connects === 2) reconnected.open();
          },
        );
        await sql.notify("pgjs_reconnect", "a");
        await a;
        await terminateListeningBackend(sql, "pgjs_reconnect");
        await reconnected;
        await sql.notify("pgjs_reconnect", "b");
        await b;
        expect(connects).toBe(2);
      });

      test("listen result reports correct connection state after reconnection", async () => {
        await container.ready;
        await using sql = connect();
        const listeningPids = async () =>
          (await sql`SELECT pid FROM pg_stat_activity WHERE query = ${'LISTEN "pgjs_state"'}`).map(
            (row: { pid: number }) => row.pid,
          );
        const resubscribed = gate();
        await sql.listen("pgjs_state", () => {}, resubscribed.after(2));
        const [initialPid] = await listeningPids();
        expect(initialPid).toBeNumber();

        await terminateListeningBackend(sql, "pgjs_state");
        await resubscribed;
        // The terminated backend may still be winding down, so only require a new one.
        expect((await listeningPids()).some(pid => pid !== initialPid)).toBe(true);
      });

      test("unlisten removes subscription", async () => {
        await container.ready;
        await using sql = connect();
        const xs: string[] = [];
        const a = gate();
        const subscription = await sql.listen("pgjs_test", x => {
          xs.push(x);
          a.open();
        });
        await sql.notify("pgjs_test", "a");
        await a;
        await subscription.unlisten();

        const barrier = gate();
        await sql.listen("pgjs_barrier", barrier.open);
        await sql.notify("pgjs_test", "b");
        await sql.notify("pgjs_barrier", "");
        await barrier;
        expect(xs.join("")).toBe("a");
      });

      test("listen after unlisten", async () => {
        await container.ready;
        await using sql = connect();
        const xs: string[] = [];
        let received = () => {};
        const listener = (x: string) => {
          xs.push(x);
          received();
        };

        const a = gate();
        received = a.open;
        const subscription = await sql.listen("pgjs_test", listener);
        await sql.notify("pgjs_test", "a");
        await a;
        await subscription.unlisten();
        await sql.notify("pgjs_test", "b");

        const c = gate();
        received = c.open;
        await sql.listen("pgjs_test", listener);
        await sql.notify("pgjs_test", "c");
        await c;
        expect(xs.join("")).toBe("ac");
      });

      test("multiple listeners and unlisten one", async () => {
        await container.ready;
        await using sql = connect();
        const xs: string[] = [];
        let count = () => {};
        await sql.listen("pgjs_test", x => {
          xs.push("1" + x);
          count();
        });
        const s2 = await sql.listen("pgjs_test", x => {
          xs.push("2" + x);
          count();
        });

        const a = gate();
        count = a.after(2);
        await sql.notify("pgjs_test", "a");
        await a;
        await s2.unlisten();

        const b = gate();
        count = b.open;
        await sql.notify("pgjs_test", "b");
        await b;
        expect(xs.join("")).toBe("1a2a1b");
      });
    });
  });
}
