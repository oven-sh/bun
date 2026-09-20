// node validates the headers, then options (parent, exclusive, silent, endStream, signal), and acts on the
// session state last. Every expectation holds on node v26.3.0: failureOf() takes node's stream error and bun's throw.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L1812-L1937
import { describe, expect, it } from "bun:test";
import type { EventEmitter } from "node:events";
import http2, { type ClientHttp2Session, type ClientHttp2Stream, type ServerHttp2Stream } from "node:http2";
import type { AddressInfo } from "node:net";

type State = "open" | "destroyed" | "closed" | "closed by a GOAWAY";

const invalidHeaders: [label: string, headers: () => any, code: string][] = [
  ["an invalid name", () => ({ "bad name": "x" }), "ERR_INVALID_HTTP_TOKEN"],
  ["an invalid name in a raw list", () => ["bad name", "x"], "ERR_INVALID_HTTP_TOKEN"],
  ["an unknown pseudo-header", () => ({ ":foo": "x" }), "ERR_HTTP2_INVALID_PSEUDOHEADER"],
  ["an unknown pseudo-header in a raw list", () => [":foo", "x"], "ERR_HTTP2_INVALID_PSEUDOHEADER"],
  ["a repeated single-value header", () => ({ "content-type": ["a", "b"] }), "ERR_HTTP2_HEADER_SINGLE_VALUE"],
  ["CONNECT without :authority", () => ({ ":method": "CONNECT" }), "ERR_HTTP2_CONNECT_AUTHORITY"],
  ["CONNECT without :authority in a raw list", () => [":method", "CONNECT"], "ERR_HTTP2_CONNECT_AUTHORITY"],
  [
    "CONNECT with :scheme",
    () => ({ ":method": "CONNECT", ":authority": "a", ":scheme": "http" }),
    "ERR_HTTP2_CONNECT_SCHEME",
  ],
  ["CONNECT with :path", () => ({ ":method": "CONNECT", ":authority": "a", ":path": "/" }), "ERR_HTTP2_CONNECT_PATH"],
];
// In the order node validates them.
const invalidOptions: [name: string, value: any][] = [
  ["parent", "x"],
  ["exclusive", 1],
  ["silent", 1],
  ["endStream", 1],
  ["signal", {}],
];
// Valid for request(). nghttp2 rejects them at send time, and bun reports that on the stream.
const rejectedAtSendTime: any[] = [{ ":path": "/a b" }, { ":method": "HEAD", "content-length": "1" }];

// `failure` is the error of a valid request, as a string.
const sessionStates: Record<
  State,
  { enter(client: ClientHttp2Session): Promise<void>; expected: object; failure?: string }
> = {
  "open": {
    async enter() {},
    expected: { closed: false, destroyed: false },
  },
  "destroyed": {
    async enter(client) {
      client.destroy();
    },
    expected: { destroyed: true },
    failure: "Error [ERR_HTTP2_INVALID_SESSION]: The session has been destroyed",
  },
  "closed": {
    async enter(client) {
      await responseOf(client, "/hang");
      client.close();
    },
    expected: { closed: true, destroyed: false },
    failure: "Error [ERR_HTTP2_GOAWAY_SESSION]: New streams cannot be created after receiving a GOAWAY",
  },
  "closed by a GOAWAY": {
    async enter(client) {
      await Promise.all([eventOf(client, "goaway"), responseOf(client, "/goaway")]);
    },
    expected: { closed: true, destroyed: false },
    failure: "Error [ERR_HTTP2_GOAWAY_SESSION]: New streams cannot be created after receiving a GOAWAY",
  },
};
const states = Object.keys(sessionStates) as State[];
const unusableStates = states.filter(state => sessionStates[state].failure !== undefined);

// Resolves with the arguments of the event. Rejects on 'error', and on a 'close' that comes first.
function eventOf(emitter: EventEmitter, name: string) {
  const { promise, resolve, reject } = Promise.withResolvers<any[]>();
  emitter.once(name, (...args) => resolve(args));
  emitter.once("error", reject);
  emitter.once("close", () => reject(new Error(`closed before '${name}'`)));
  return promise;
}

// Resolves once the response headers arrived. The server leaves the stream open, so the
// session stays alive after close() or a graceful GOAWAY.
async function responseOf(client: ClientHttp2Session, path: string) {
  const req = client.request({ ":path": path });
  req.on("error", () => {});
  req.resume();
  await eventOf(req, "response");
}

async function sessionIn(state: State) {
  const server = http2.createServer();
  server.on("stream", (stream: ServerHttp2Stream, headers) => {
    stream.on("error", () => {});
    stream.respond({ ":status": 200, "x-method": headers[":method"] });
    if (headers[":path"] === "/goaway") stream.session!.goaway();
    else if (headers[":path"] !== "/hang") stream.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = http2.connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  client.on("error", () => {});
  try {
    await eventOf(client, "connect");
    await sessionStates[state].enter(client);
  } catch (e) {
    client.destroy();
    server.close();
    throw e;
  }
  return { server, client };
}

// What request() throws, or undefined when it returns a stream.
function thrownBy(client: ClientHttp2Session, headers: any, options?: any): any {
  let req: ClientHttp2Stream;
  try {
    req = client.request(headers, options);
  } catch (e) {
    return e;
  }
  req.on("error", () => {});
}

// Resolves with the error the stream is destroyed with.
function errorOf(req: ClientHttp2Stream) {
  const { promise, resolve, reject } = Promise.withResolvers<any>();
  req.on("error", resolve);
  req.on("close", () => reject(new Error("the stream closed without an error")));
  return promise;
}

// The error of a request that cannot start: thrown by request(), or emitted on its stream.
async function failureOf(client: ClientHttp2Session, headers: any, options?: any) {
  let req: ClientHttp2Stream;
  try {
    req = client.request(headers, options);
  } catch (e) {
    return e;
  }
  return errorOf(req);
}

// How a stream that cannot start looks when request() returns, and the events that follow.
function observe(req: ClientHttp2Stream) {
  const seen = {
    writableEnded: req.writableEnded,
    sentHeaders: Object.keys(req.sentHeaders),
    events: [] as string[],
  };
  req.on("aborted", () => seen.events.push("aborted"));
  req.on("error", (error: any) => seen.events.push(error.name === "AbortError" ? "AbortError" : error.code));
  const { promise, resolve } = Promise.withResolvers<typeof seen>();
  req.on("close", () => resolve(seen));
  return promise;
}

describe("http2 client.request() validates headers, then options, then looks at the session state", () => {
  it.each(states)("on a session that is %s", async state => {
    const { server, client } = await sessionIn(state);
    try {
      expect({ closed: client.closed, destroyed: client.destroyed }).toMatchObject(sessionStates[state].expected);

      // A header error wins, with no options and with each invalid option.
      const headerErrors: Record<string, unknown> = {};
      const expectedHeaderErrors: Record<string, string> = {};
      for (const [label, headers, code] of invalidHeaders) {
        headerErrors[label] = thrownBy(client, headers())?.code;
        expectedHeaderErrors[label] = code;
        for (const [name, value] of invalidOptions) {
          headerErrors[`${label} + options.${name}`] = thrownBy(client, headers(), { [name]: value })?.code;
          expectedHeaderErrors[`${label} + options.${name}`] = code;
        }
      }
      expect(headerErrors).toEqual(expectedHeaderErrors);

      // With valid headers, the first invalid option in node's order is the one reported. The
      // properties are inserted in reverse, so the result cannot come from the property order.
      const options = Object.fromEntries(invalidOptions.toReversed());
      const optionErrors: { code: unknown; reported: unknown }[] = [];
      for (const [name] of invalidOptions) {
        const error = thrownBy(client, { ":path": "/" }, { ...options });
        const reported = error?.message.match(/^The "([^"]+)" property must be /)?.[1];
        optionErrors.push({ code: error?.code, reported });
        delete options[name];
      }
      expect(optionErrors).toEqual(
        invalidOptions.map(([name]) => ({ code: "ERR_INVALID_ARG_TYPE", reported: `options.${name}` })),
      );

      // options is read once, and only when the header block is valid.
      let reads = 0;
      const counted = {
        get silent() {
          reads++;
          return false;
        },
      };
      expect(thrownBy(client, { "bad name": "x" }, counted)?.code).toBe("ERR_INVALID_HTTP_TOKEN");
      expect(reads).toBe(0);
      thrownBy(client, { ":path": "/" }, counted);
      expect(reads).toBe(1);
    } finally {
      client.destroy();
      server.close();
    }
  });

  it.each(unusableStates)("a session that is %s fails every request that has valid arguments", async state => {
    const { server, client } = await sessionIn(state);
    try {
      // A :method that is not a string is valid, node sends String(value). nghttp2 rejects the
      // last two at send time, which is after the session state.
      const valid = [{ ":path": "/" }, { ":method": 1 }, [":method", 1], ...rejectedAtSendTime];
      const failures = valid.map(headers => failureOf(client, headers));
      expect((await Promise.all(failures)).map(String)).toEqual(Array(valid.length).fill(sessionStates[state].failure));
    } finally {
      client.destroy();
      server.close();
    }
  });

  it("fails a request that a closing session never sent with the same error", async () => {
    const server = http2.createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const client = http2.connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    client.on("error", () => {});
    try {
      // Queued behind the connect, then the session closes before it connects.
      const failure = errorOf(client.request({ ":path": "/" }));
      client.close();
      expect(String(await failure)).toBe(sessionStates.closed.failure!);
    } finally {
      client.destroy();
      server.close();
    }
  });

  it("sends a :method that is not a string as String(value)", async () => {
    const { server, client } = await sessionIn("open");
    try {
      const methods: unknown[] = [];
      for (const headers of [{ ":method": 1 }, [":method", 1]] as any[]) {
        const req = client.request(headers);
        req.on("error", () => {});
        req.resume();
        req.end();
        const [response] = await eventOf(req, "response");
        methods.push(response["x-method"]);
      }
      expect(methods).toEqual(["1", "1"]);
    } finally {
      client.destroy();
      server.close();
    }
  });

  it("validates options.signal before nghttp2 can reject the request", async () => {
    const { server, client } = await sessionIn("open");
    try {
      for (const headers of rejectedAtSendTime) {
        expect(thrownBy(client, headers, { signal: {} })?.code).toBe("ERR_INVALID_ARG_TYPE");
        const error = await errorOf(client.request(headers, { signal: AbortSignal.abort() }));
        expect(error.name).toBe("AbortError");
      }
    } finally {
      client.destroy();
      server.close();
    }
  });

  it("a destroyed session fails a stream that has the header defaults, endStream and the signal applied", async () => {
    const { server, client } = await sessionIn("destroyed");
    try {
      const controller = new AbortController();
      const requests: [label: string, seen: ReturnType<typeof observe>][] = [
        ["GET", observe(client.request({ "x-a": "1" }))],
        ["GET, raw list", observe(client.request(["x-a", "1"]))],
        ["POST", observe(client.request({ ":method": "POST" }))],
        ["aborted signal", observe(client.request({ ":path": "/" }, { signal: AbortSignal.abort() }))],
        ["signal aborted in the same tick", observe(client.request({ ":path": "/" }, { signal: controller.signal }))],
      ];
      controller.abort();
      const observed: Record<string, unknown> = {};
      for (const [label, seen] of requests) observed[label] = await seen;
      expect(observed).toEqual({
        "GET": {
          writableEnded: true,
          sentHeaders: ["x-a", ":method", ":authority", ":scheme", ":path"],
          events: ["ERR_HTTP2_INVALID_SESSION"],
        },
        "GET, raw list": {
          writableEnded: true,
          sentHeaders: [":method", ":authority", ":scheme", ":path", "x-a"],
          events: ["ERR_HTTP2_INVALID_SESSION"],
        },
        "POST": {
          writableEnded: false,
          sentHeaders: [":method", ":authority", ":scheme", ":path"],
          events: ["aborted", "ERR_HTTP2_INVALID_SESSION"],
        },
        "aborted signal": {
          writableEnded: true,
          sentHeaders: [":path", ":method", ":authority", ":scheme"],
          events: ["AbortError"],
        },
        "signal aborted in the same tick": {
          writableEnded: true,
          sentHeaders: [":path", ":method", ":authority", ":scheme"],
          events: ["AbortError"],
        },
      });
    } finally {
      client.destroy();
      server.close();
    }
  });
});
