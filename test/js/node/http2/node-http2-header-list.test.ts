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
  options: object = {},
) {
  const server = http2.createServer(options);
  server.on("stream", onStream);
  await once(server.listen(0, "127.0.0.1"), "listening");
  const authority = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = http2.connect(`http://${authority}`, options);
  if (connect) await once(client, "connect");
  return {
    client,
    authority,
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

const describeError = (err: any) => ({ name: err.constructor.name, code: err.code, message: err.message });

// What `call` throws, in the form of describeError(), or "returned".
function thrownBy(call: () => unknown) {
  try {
    call();
  } catch (err) {
    return describeError(err);
  }
  return "returned";
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

describe("an array in a value slot of a raw header list is sent as one field per element", () => {
  // Node.js sends both header forms through one function (buildNgHeaderString), and an array is
  // one field per element there. The expected values were checked against Node.js v26.3.0. The
  // assertions on what was sent use the flat list that the peer decoded: one name and value per
  // field.

  // Ends the request. Resolves with the response headers and the flat list of the response.
  async function rawExchange(req: http2.ClientHttp2Stream) {
    let rawHeaders: string[] = [];
    req.on("response", (...args: any[]) => (rawHeaders = args[2]));
    return { headers: await exchange(req), rawHeaders };
  }

  // On the connecting session the request is queued and encoded when the session connects.
  test.each(["connected", "connecting"])("request() on a %s session", async state => {
    let received: any;
    const { client, authority, close } = await peers((stream, headers, _flags, rawHeaders) => {
      received = {
        path: headers[":path"],
        sensitive: headers[http2.sensitiveHeaders],
        fields: nonPseudoFields(rawHeaders),
      };
      stream.respond({ ":status": 200 });
      stream.end();
    }, state === "connected");
    try {
      const list: any = [
        ...[":path", ["/raw"]],
        ...["x-multi", ["a", "b"]],
        ...["x-number", [1, 2]],
        ...["x-one", ["only"]],
        ...["x-none", []],
        ...["content-type", []],
        ...["x-plain", "p"],
        ...["x-dup", ["d1"], "x-dup", "d2"],
        ...["x-dup2", "e1", "x-dup2", ["e2", "e3"]],
        ...["x-secret", ["s1", "s2"]],
      ];
      list[http2.sensitiveHeaders] = ["x-secret"];
      const req = client.request(list);
      const sent = req.sentHeaders;
      await exchange(req);

      expect(received).toEqual({
        path: "/raw",
        // The receiver lists a name once for each field that arrived never-indexed.
        sensitive: ["x-secret", "x-secret"],
        fields: [
          ...["x-multi", "a", "x-multi", "b"],
          ...["x-number", "1", "x-number", "2"],
          ...["x-one", "only"],
          ...["x-plain", "p"],
          ...["x-dup", "d1", "x-dup", "d2"],
          ...["x-dup2", "e1", "x-dup2", "e2", "x-dup2", "e3"],
          ...["x-secret", "s1", "x-secret", "s2"],
        ],
      });
      // sentHeaders keeps the slots as the caller gave them. A name that occurs again collects in
      // an array.
      expect(sent).toEqual({
        ":method": "GET",
        ":authority": authority,
        ":scheme": "http",
        ":path": ["/raw"],
        "x-multi": ["a", "b"],
        "x-number": [1, 2],
        "x-one": ["only"],
        "x-none": [],
        "content-type": [],
        "x-plain": "p",
        "x-dup": ["d1", "d2"],
        "x-dup2": ["e1", ["e2", "e3"]],
        "x-secret": ["s1", "s2"],
        [http2.sensitiveHeaders]: ["x-secret"],
      });
    } finally {
      close();
    }
  });

  test("respond()", async () => {
    let sent: any;
    const { client, close } = await peers(stream => {
      const list: any = [
        ...[":status", "200"],
        ...["set-cookie", ["c1=1", "c2=2"]],
        ...["x-multi", ["a", "b"]],
        ...["x-none", []],
        ...["x-dup", ["d1"], "x-dup", "d2"],
        ...["x-secret", ["s1", "s2"]],
        ...["x-plain", "p"],
      ];
      list[http2.sensitiveHeaders] = ["x-secret"];
      stream.respond(list, { sendDate: false });
      sent = stream.sentHeaders;
      stream.end();
    });
    try {
      const { headers, rawHeaders } = await rawExchange(client.request({ ":path": "/" }));
      expect(rawHeaders).toEqual([
        ...[":status", "200"],
        ...["set-cookie", "c1=1", "set-cookie", "c2=2"],
        ...["x-multi", "a", "x-multi", "b"],
        ...["x-dup", "d1", "x-dup", "d2"],
        ...["x-secret", "s1", "x-secret", "s2"],
        ...["x-plain", "p"],
      ]);
      // What a receiver makes of those fields: set-cookie stays a list, and the other repeated
      // fields are joined with ", ". Each element of the never-indexed field arrives never-indexed.
      expect(headers).toEqual({
        ":status": 200,
        "set-cookie": ["c1=1", "c2=2"],
        "x-multi": "a, b",
        "x-dup": "d1, d2",
        "x-secret": "s1, s2",
        "x-plain": "p",
        [http2.sensitiveHeaders]: ["x-secret", "x-secret"],
      });
      expect(sent).toEqual({
        ":status": "200",
        "set-cookie": ["c1=1", "c2=2"],
        "x-multi": ["a", "b"],
        "x-none": [],
        "x-dup": ["d1", "d2"],
        "x-secret": ["s1", "s2"],
        "x-plain": "p",
        [http2.sensitiveHeaders]: ["x-secret"],
      });
    } finally {
      close();
    }
  });

  test("respond() on a pushed stream", async () => {
    const { client, close } = await peers(stream => {
      stream.pushStream({ ":path": "/pushed" }, (err: Error | null, pushed: any) => {
        if (err) return stream.destroy(err);
        const list: any = [":status", 200, "x-secret", ["s1", "s2"], "x-open", ["o1", "o2"]];
        list[http2.sensitiveHeaders] = ["x-secret"];
        pushed.respond(list, { sendDate: false });
        pushed.end();
      });
      stream.respond({ ":status": 200 });
      stream.end();
    });
    try {
      const { promise: pushedHead, resolve, reject } = Promise.withResolvers<any>();
      client.once("stream", pushed => {
        pushed.on("error", reject);
        pushed.on("push", resolve);
        pushed.resume();
      });
      await exchange(client.request({ ":path": "/" }));
      expect(await pushedHead).toEqual({
        ":status": 200,
        "x-secret": "s1, s2",
        "x-open": "o1, o2",
        [http2.sensitiveHeaders]: ["x-secret", "x-secret"],
      });
    } finally {
      close();
    }
  });

  const singleValue = {
    name: "TypeError",
    code: "ERR_HTTP2_HEADER_SINGLE_VALUE",
    message: 'Header field "content-type" must only have a single value',
  };
  const invalidValue = {
    name: "TypeError",
    code: "ERR_HTTP2_INVALID_HEADER_VALUE",
    message: 'Invalid value for header "x-session"',
  };

  // Node.js encodes the header block inside request(). A request made while the session connects
  // is encoded later. The arrays of its list are read at the call: a change that the caller makes
  // afterwards is not sent, and a list that cannot be sent throws from the call.
  test("a queued request() reads the arrays at the call", async () => {
    let received: string[] = [];
    const { client, authority, close } = await peers((stream, _headers, _flags, rawHeaders) => {
      received = nonPseudoFields(rawHeaders);
      stream.respond({ ":status": 200 });
      stream.end();
    }, false);
    try {
      const kept = ["k1"];
      // Every pseudo-header is given, so request() adds none to the list.
      const list: any = [":method", "GET", ":scheme", "http", ":authority", authority, ":path", "/", "x-tag", kept];
      const req = client.request(list);
      kept.push("late-element");
      list.push("x-late", "late-pair");

      const thrown = {
        twoValues: thrownBy(() => client.request([":path", "/", "content-type", ["text/plain", "text/html"]] as any)),
        lineFeed: thrownBy(() => client.request([":path", "/", "x-session", ["sid=1", "en\r\nx"]] as any)),
        toString: thrownBy(() =>
          client.request([
            ":path",
            "/",
            "x-n",
            [
              "a",
              {
                toString: () => {
                  throw new RangeError("boom");
                },
              },
            ],
          ] as any),
        ),
      };

      await exchange(req);
      expect({ received, thrown }).toEqual({
        received: ["x-tag", "k1"],
        thrown: {
          twoValues: singleValue,
          lineFeed: invalidValue,
          toString: { name: "RangeError", code: undefined, message: "boom" },
        },
      });
    } finally {
      close();
    }
  });

  // Array.isArray is true for a Proxy of an array.
  test("request() and respond() send each element of a Proxy of an array", async () => {
    const fields = ["x-proxy", new Proxy(["p1", "p2"], {})];
    const onWire = ["x-proxy", "p1", "x-proxy", "p2"];
    let received: string[] = [];
    const { client, close } = await peers((stream, _headers, _flags, rawHeaders) => {
      received = nonPseudoFields(rawHeaders);
      stream.respond([":status", 200, ...fields], { sendDate: false });
      stream.end();
    });
    try {
      const { rawHeaders } = await rawExchange(client.request([":path", "/", ...fields] as any));
      expect({ received, responded: nonPseudoFields(rawHeaders) }).toEqual({ received: onWire, responded: onWire });
    } finally {
      close();
    }
  });

  // An element goes out as String(element): null and undefined are values, not errors. The second
  // exchange shows that the session still decodes the same block.
  test("request() and respond() send a null or undefined element as text", async () => {
    const fields = ["x-n", ["a", null, undefined, "b"]];
    const onWire = ["x-n", "a", "x-n", "null", "x-n", "undefined", "x-n", "b"];
    const received: string[][] = [];
    const { client, close } = await peers((stream, _headers, _flags, rawHeaders) => {
      received.push(nonPseudoFields(rawHeaders));
      stream.respond([":status", 200, ...fields], { sendDate: false });
      stream.end();
    });
    try {
      const responded: string[][] = [];
      for (let i = 0; i < 2; i++) {
        const { rawHeaders } = await rawExchange(client.request([":path", "/", ...fields] as any));
        responded.push(nonPseudoFields(rawHeaders));
      }
      expect({ received, responded }).toEqual({ received: [onWire, onWire], responded: [onWire, onWire] });
    } finally {
      close();
    }
  });

  // The encoder refuses a value with CR, LF or NUL, and it throws after it has encoded the fields
  // before that value. Then the peer decodes later blocks of the session against the wrong table.
  // An element is checked before the encoder runs: the call throws and the session stays in step.
  test("an element with CR or LF throws before a field of the block is encoded", async () => {
    const errors: unknown[] = [];
    const { client, close } = await peers((stream, headers) => {
      const user = headers["x-user"];
      try {
        stream.respond([":status", 200, "x-session", [`sid=${user}`, user === "mallet" ? "en\r\nx" : "en"]]);
      } catch (err) {
        errors.push(describeError(err));
        stream.respond({ ":status": 500 });
      }
      stream.end();
    });
    try {
      const received: unknown[] = [];
      for (const user of ["alice", "bob", "mallet", "bob", "alice"]) {
        const headers = await exchange(client.request({ ":path": "/", "x-user": user }));
        received.push([headers[":status"], headers["x-session"]]);
      }
      expect({ errors, received }).toEqual({
        errors: [invalidValue],
        received: [
          [200, "sid=alice, en"],
          [200, "sid=bob, en"],
          [500, undefined],
          [200, "sid=bob, en"],
          [200, "sid=alice, en"],
        ],
      });
    } finally {
      close();
    }
  });

  // The single-value rule counts the fields that the list sends: each element of an array is one,
  // an empty array and an undefined value are none, in every slot of the list. A violation throws
  // from the call, before anything is encoded. Every row has the same outcome on Node.js v26.3.0.
  const singleValueRows = [
    { pairs: ["content-type", ["text/plain", "text/html"]], outcome: singleValue },
    { pairs: ["content-type", ["text/plain"], "content-type", "text/html"], outcome: singleValue },
    { pairs: ["content-type", "text/plain", "content-type", ["text/html"]], outcome: singleValue },
    { pairs: ["content-type", "text/plain", "content-type", null], outcome: singleValue },
    { pairs: ["Content-Type", "text/plain", "content-type", "text/html"], outcome: singleValue },
    { pairs: ["x-a", ["a"], "content-type", "text/plain", "content-type", null], outcome: singleValue },
    { pairs: ["x-a", ["a"], "Content-Type", "text/plain", "content-type", "text/html"], outcome: singleValue },
    {
      pairs: ["x-a", ["a"], new String("content-type"), "text/plain", "content-type", "text/html"],
      outcome: singleValue,
    },
    { pairs: ["content-type", [], "content-type", "text/html"], outcome: ["text/html"] },
    { pairs: ["content-type", "text/html", "content-type", []], outcome: ["text/html"] },
    { pairs: ["content-type", ["text/html"], "content-type", []], outcome: ["text/html"] },
    { pairs: ["content-type", [], "content-type", [], "content-type", "text/html"], outcome: ["text/html"] },
    { pairs: ["x-a", ["a"], "content-type", "text/html", "content-type", undefined], outcome: ["text/html"] },
    { pairs: ["Content-Type", "text/html", "content-type", []], outcome: ["text/html"] },
  ];
  const contentTypeValues = (rawHeaders: string[]) => {
    const values: string[] = [];
    for (let i = 0; i < rawHeaders.length; i += 2) {
      if (rawHeaders[i] === "content-type") values.push(rawHeaders[i + 1]);
    }
    return values;
  };

  test("request() applies the single-value rule to each slot of the list", async () => {
    let received: string[] = [];
    const { client, close } = await peers((stream, _headers, _flags, rawHeaders) => {
      received = contentTypeValues(rawHeaders);
      stream.respond({ ":status": 200 });
      stream.end();
    });
    try {
      const outcomes: unknown[] = [];
      for (const { pairs } of singleValueRows) {
        let req: http2.ClientHttp2Stream;
        try {
          req = client.request([":path", "/", ...pairs] as any);
        } catch (err) {
          outcomes.push(describeError(err));
          continue;
        }
        await exchange(req);
        outcomes.push(received);
      }
      expect(outcomes).toEqual(singleValueRows.map(row => row.outcome));
      expect(thrownBy(() => client.request([":path", ["/a", "/b"]] as any))).toEqual({
        ...singleValue,
        message: 'Header field ":path" must only have a single value',
      });
    } finally {
      close();
    }
  });

  test("respond() applies the single-value rule to each slot of the list", async () => {
    let row = singleValueRows[0];
    let respondError: unknown;
    const { client, close } = await peers(stream => {
      try {
        stream.respond([":status", "200", ...row.pairs], { sendDate: false });
      } catch (err) {
        respondError = describeError(err);
        stream.respond({ ":status": 200, "x-threw": "1" });
      }
      stream.end();
    });
    try {
      const outcomes: unknown[] = [];
      for (row of singleValueRows) {
        respondError = undefined;
        const { headers, rawHeaders } = await rawExchange(client.request({ ":path": "/" }));
        outcomes.push(headers["x-threw"] ? respondError : contentTypeValues(rawHeaders));
      }
      expect(outcomes).toEqual(singleValueRows.map(r => r.outcome));
    } finally {
      close();
    }
  });

  // request() reads :method back to decide if the HEADERS frame ends the stream. An array in that
  // slot is sent as the method that it holds. The stream then stays open, as in Node.js.
  test("request() accepts an array in the :method slot", async () => {
    let received: string[] = [];
    const { client, close } = await peers((stream, _headers, _flags, rawHeaders) => {
      received = [];
      for (let i = 0; i < rawHeaders.length; i += 2) {
        if (rawHeaders[i] === ":method") received.push(rawHeaders[i + 1]);
      }
      stream.respond({ ":status": 200 });
      stream.end();
    });
    try {
      const outcomes: unknown[] = [];
      const forms: any[] = [
        [":method", "GET", ":path", "/"],
        [":method", ["GET"], ":path", "/"],
        [":method", "GET", ":method", [], ":path", "/"],
        { ":method": ["GET"], ":path": "/" },
      ];
      for (const headers of forms) {
        const req = client.request(headers);
        const endedByRequest = req.writableEnded;
        await exchange(req);
        outcomes.push({ received, endedByRequest });
      }
      expect(outcomes).toEqual([
        { received: ["GET"], endedByRequest: true },
        { received: ["GET"], endedByRequest: false },
        { received: ["GET"], endedByRequest: false },
        { received: ["GET"], endedByRequest: false },
      ]);
    } finally {
      close();
    }
  });

  // With the single-value rule off, each element of a field is sent. A pseudo-header stays one
  // field: its elements are joined with "," as in Node.js. The join throws for a Symbol.
  test("strictSingleValueFields: false", async () => {
    let received: any;
    const { client, close } = await peers(
      (stream, headers, _flags, rawHeaders) => {
        received = { path: headers[":path"], fields: nonPseudoFields(rawHeaders) };
        stream.respond([":status", "200", "content-type", ["text/plain", "text/html"]], { sendDate: false });
        stream.end();
      },
      true,
      { strictSingleValueFields: false },
    );
    try {
      const list: any = [":path", ["/a", "/b"], "content-type", ["a/b", "c/d"]];
      const { rawHeaders } = await rawExchange(client.request(list));
      const symbolInPseudoHeader: any = thrownBy(() => client.request([":path", ["/a", Symbol("b")]] as any));
      expect({ received, rawHeaders, symbolInPseudoHeader: symbolInPseudoHeader.name }).toEqual({
        received: { path: "/a,/b", fields: ["content-type", "a/b", "content-type", "c/d"] },
        rawHeaders: [":status", "200", "content-type", "text/plain", "content-type", "text/html"],
        symbolInPseudoHeader: "TypeError",
      });
    } finally {
      close();
    }
  });
});
