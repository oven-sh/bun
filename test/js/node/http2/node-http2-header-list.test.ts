// A raw header list is the array form of the headers argument of respond() and request():
// [name, value, name, value, ...]. A value slot can hold an array.
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";

// A server and a client session on loopback. `onStream` answers every stream.
async function peers(
  onStream: (stream: any, headers: any, flags: number, rawHeaders: string[]) => void,
  connect = true,
) {
  const server = http2.createServer();
  server.on("stream", onStream);
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = http2.connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  if (connect) await once(client, "connect");
  return {
    client,
    close() {
      client.destroy();
      server.close();
    },
  };
}

// Ends the request. Resolves with the response headers when the stream has closed.
function exchange(req: http2.ClientHttp2Stream): Promise<any> {
  const { promise, resolve, reject } = Promise.withResolvers<any>();
  let response: any;
  req.on("response", headers => (response = headers));
  req.on("error", reject);
  req.on("close", () => resolve(response));
  req.resume();
  req.end();
  return promise;
}

function nonPseudoFields(rawHeaders: string[]) {
  const fields: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (!rawHeaders[i].startsWith(":")) fields.push(rawHeaders[i], rawHeaders[i + 1]);
  }
  return fields;
}

describe("a raw header list does not write into an array that the caller keeps", () => {
  // A caller can keep the array of a value slot in a constant and name the same header again in
  // the same list. The later value must not go into the constant, or every later call carries it.
  // The last three calls of each test also read sentHeaders. Node.js v26.3.0 pushes into the
  // caller's array on that read. Bun does not.
  const users = ["alice", "bob", "carol", "dave", "erin", "frank"];
  const readsSentHeaders = (user: string) => users.indexOf(user) >= 3;
  const THEME = "theme=light; Path=/";
  const ownCookieOnly = { received: users.map(user => [THEME, `sid=${user}`]), kept: [THEME] };

  test("respond()", async () => {
    const kept = [THEME];
    const { client, close } = await peers((stream, headers) => {
      const user = headers["x-user"];
      stream.respond([":status", 200, "set-cookie", kept, "set-cookie", `sid=${user}`]);
      if (readsSentHeaders(user)) void stream.sentHeaders;
      stream.end();
    });
    try {
      const received: string[][] = [];
      for (const user of users) {
        const headers = await exchange(client.request({ ":path": "/", "x-user": user }));
        received.push(headers["set-cookie"]);
      }
      expect({ received, kept }).toEqual(ownCookieOnly);
    } finally {
      close();
    }
  });

  test("respond() on a pushed stream", async () => {
    const kept = [THEME];
    const { client, close } = await peers((stream, headers) => {
      const user = headers["x-user"];
      stream.pushStream({ ":path": "/pushed" }, (err: Error | null, pushed: any) => {
        if (err) return stream.destroy(err);
        pushed.respond([":status", 200, "set-cookie", kept, "set-cookie", `sid=${user}`]);
        if (readsSentHeaders(user)) void pushed.sentHeaders;
        pushed.end();
      });
      stream.respond({ ":status": 200 });
      stream.end();
    });
    try {
      const received: string[][] = [];
      for (const user of users) {
        const { promise: pushedCookies, resolve, reject } = Promise.withResolvers<string[]>();
        client.once("stream", pushed => {
          pushed.on("error", reject);
          pushed.on("push", headers => resolve(headers["set-cookie"] as string[]));
          pushed.resume();
        });
        await exchange(client.request({ ":path": "/", "x-user": user }));
        received.push(await pushedCookies);
      }
      expect({ received, kept }).toEqual(ownCookieOnly);
    } finally {
      close();
    }
  });

  // On the connecting session every request is made before the session connects. The requests are
  // queued, and their header blocks are encoded after the last call returned.
  test.each(["connected", "connecting"])("request() on a %s session", async state => {
    const kept = ["team=core"];
    const received: Record<string, string[]> = {};
    const { client, close } = await peers((stream, headers, _flags, rawHeaders) => {
      received[headers["x-user"]] = nonPseudoFields(rawHeaders);
      stream.respond({ ":status": 200 });
      stream.end();
    }, state === "connected");
    try {
      const exchanges = users.map(user => {
        const list: any = [":path", "/", "x-user", user, "x-tag", kept, "x-tag", `token-${user}`];
        const req = client.request(list);
        if (readsSentHeaders(user)) void req.sentHeaders;
        return exchange(req);
      });
      await Promise.all(exchanges);
      expect({ received, kept }).toEqual({
        received: Object.fromEntries(
          users.map(user => [user, ["x-user", user, "x-tag", "team=core", "x-tag", `token-${user}`]]),
        ),
        kept: ["team=core"],
      });
    } finally {
      close();
    }
  });

  // A write into a frozen array throws. Neither call writes, so neither call throws.
  test("respond() and request() accept a frozen array", async () => {
    const frozen = Object.freeze(["f1"]);
    let received: string[] = [];
    const { client, close } = await peers((stream, _headers, _flags, rawHeaders) => {
      received = nonPseudoFields(rawHeaders);
      stream.respond([":status", 200, "x-frozen", frozen, "x-frozen", "f2"]);
      stream.end();
    });
    try {
      const list: any = [":path", "/", "x-frozen", frozen, "x-frozen", "f2"];
      const headers = await exchange(client.request(list));
      expect({ received, responded: headers["x-frozen"] }).toEqual({
        received: ["x-frozen", "f1", "x-frozen", "f2"],
        responded: "f1, f2",
      });
    } finally {
      close();
    }
  });

  // A Proxy of an array can report any length. The copy reads the length as Array.prototype.join
  // does, so such a value is sent as before and does not make the call throw.
  test("respond() and request() accept a Proxy of an array that reports a length of 1.5", async () => {
    const proxy = new Proxy(["p1"], {
      get: (target, key, receiver) => (key === "length" ? 1.5 : Reflect.get(target, key, receiver)),
    });
    let received: string[] = [];
    const { client, close } = await peers((stream, _headers, _flags, rawHeaders) => {
      received = nonPseudoFields(rawHeaders);
      stream.respond([":status", 200, "x-proxy", proxy]);
      stream.end();
    });
    try {
      const list: any = [":path", "/", "x-proxy", proxy];
      const headers = await exchange(client.request(list));
      expect({ received, responded: headers["x-proxy"] }).toEqual({ received: ["x-proxy", "p1"], responded: "p1" });
    } finally {
      close();
    }
  });
});
