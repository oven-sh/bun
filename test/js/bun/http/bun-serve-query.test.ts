import type { BunRequest, Server } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

let server: Server;

afterAll(() => {
  server.stop(true);
});

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    routes: {
      "/echo-query": req => {
        return new Response("hello");
      },
    },
  });
  server.unref();
});

describe("request.searchParams basic functionality", () => {
  beforeEach(() => {
    server.reload({
      port: 0,
      routes: {
        "/echo-query": req => {
          if (!req.searchParams) {
            throw new Error("query is undefined");
          }
          if (!(req.searchParams instanceof URLSearchParams)) {
            throw new Error("query is not a URLSearchParams");
          }

          console.log(req);

          return new Response(
            JSON.stringify({
              // Convert URLSearchParams to plain object for easier assertions
              asObject: Object.fromEntries(req.searchParams),
              // Also test the raw URLSearchParams toString() result
              asString: req.searchParams.toString(),
            }),
          );
        },
      },
    });
  });

  it("handles simple query parameters", async () => {
    const res = await fetch(`${server.url}echo-query?foo=bar`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.asObject).toEqual({
      foo: "bar",
    });
    expect(data.asString).toBe("foo=bar");
  });

  it("handles multiple query parameters", async () => {
    const res = await fetch(`${server.url}echo-query?foo=bar&baz=qux`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.asObject).toEqual({
      foo: "bar",
      baz: "qux",
    });
    expect(data.asString).toBe("foo=bar&baz=qux");
  });

  it("handles empty query parameters", async () => {
    const res = await fetch(`${server.url}echo-query?empty=&foo=bar`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.asObject).toEqual({
      empty: "",
      foo: "bar",
    });
    expect(data.asString).toBe("empty=&foo=bar");
  });

  it("handles key-only query parameters", async () => {
    const res = await fetch(`${server.url}echo-query?flag&foo=bar`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.asObject).toEqual({
      flag: "",
      foo: "bar",
    });
    expect(data.asString).toBe("flag=&foo=bar");
  });

  it("handles no query parameters", async () => {
    const res = await fetch(`${server.url}echo-query`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.asObject).toEqual({});
    expect(data.asString).toBe("");
  });

  it("handles encoded query parameters", async () => {
    const res = await fetch(`${server.url}echo-query?email=user%40example.com&message=hello%20world`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.asObject).toEqual({
      email: "user@example.com",
      message: "hello world",
    });
  });

  it("handles unicode query parameters", async () => {
    const res = await fetch(`${server.url}echo-query?emoji=🦊&text=こんにちは`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.asObject).toEqual({
      emoji: "🦊",
      text: "こんにちは",
    });
  });
});

describe("request.searchParams URLSearchParams methods", () => {
  beforeEach(() => {
    server.reload({
      port: 0,
      routes: {
        "/has": req => new Response(req.searchParams.has("key").toString()),
        "/get": req => new Response(req.searchParams.get("key") || "null"),
        "/getAll": req => new Response(JSON.stringify(req.searchParams.getAll("key"))),
        "/entries": req => {
          const entries = Array.from(req.searchParams.entries());
          return new Response(JSON.stringify(entries));
        },
        "/keys": req => {
          const keys = Array.from(req.searchParams.keys());
          return new Response(JSON.stringify(keys));
        },
        "/values": req => {
          const values = Array.from(req.searchParams.values());
          return new Response(JSON.stringify(values));
        },
      },
    });
  });

  it("implements has() method", async () => {
    let res = await fetch(`${server.url}has?key=value`);
    expect(await res.text()).toBe("true");

    res = await fetch(`${server.url}has?otherkey=value`);
    expect(await res.text()).toBe("false");
  });

  it("implements get() method", async () => {
    let res = await fetch(`${server.url}get?key=value`);
    expect(await res.text()).toBe("value");

    res = await fetch(`${server.url}get?otherkey=value`);
    expect(await res.text()).toBe("null");
  });

  it("implements getAll() method for repeated parameters", async () => {
    const res = await fetch(`${server.url}getAll?key=value1&key=value2&key=value3`);
    const values = await res.json();
    expect(values).toEqual(["value1", "value2", "value3"]);
  });

  it("implements entries() method", async () => {
    const res = await fetch(`${server.url}entries?a=1&b=2&c=3`);
    const entries = await res.json();
    expect(entries).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
  });

  it("implements keys() method", async () => {
    const res = await fetch(`${server.url}keys?a=1&b=2&c=3`);
    const keys = await res.json();
    expect(keys).toEqual(["a", "b", "c"]);
  });

  it("implements values() method", async () => {
    const res = await fetch(`${server.url}values?a=1&b=2&c=3`);
    const values = await res.json();
    expect(values).toEqual(["1", "2", "3"]);
  });
});

describe("request.searchParams with route parameters", () => {
  beforeEach(() => {
    server.reload({
      port: 0,
      routes: {
        "/users/:id": (req: BunRequest<"/users/:id">) => {
          return new Response(
            JSON.stringify({
              params: req.params,
              query: Object.fromEntries(req.searchParams),
            }),
          );
        },
      },
    });
  });

  it("combines route parameters with query parameters", async () => {
    const res = await fetch(`${server.url}users/123?sort=name&filter=active`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      params: { id: "123" },
      query: {
        sort: "name",
        filter: "active",
      },
    });
  });
});

describe("request.searchParams manipulation", () => {
  beforeEach(() => {
    server.reload({
      port: 0,
      routes: {
        "/append": req => {
          const query = req.searchParams;
          query.append("added", "value");
          return new Response(query.toString());
        },
        "/set": req => {
          const query = req.searchParams;
          query.set("key", "newvalue");
          return new Response(query.toString());
        },
        "/delete": req => {
          const query = req.searchParams;
          query.delete("key");
          return new Response(query.toString());
        },
      },
    });
  });

  it("allows appending new parameters", async () => {
    const res = await fetch(`${server.url}append?existing=value`);
    expect(await res.text()).toBe("existing=value&added=value");
  });

  it("allows setting parameter values", async () => {
    const res = await fetch(`${server.url}set?key=oldvalue&other=value`);
    expect(await res.text()).toBe("key=newvalue&other=value");
  });

  it("allows deleting parameters", async () => {
    const res = await fetch(`${server.url}delete?key=value&other=value`);
    expect(await res.text()).toBe("other=value");
  });
});

describe("request.searchParams in async handlers", () => {
  beforeEach(() => {
    server.reload({
      port: 0,
      routes: {
        "/async-echo-query": async req => {
          await Bun.sleep(1);
          if (!req.searchParams) {
            throw new Error("query is undefined in async handler");
          }
          if (!(req.searchParams instanceof URLSearchParams)) {
            throw new Error("query is not a URLSearchParams in async handler");
          }
          return new Response(
            JSON.stringify({
              asObject: Object.fromEntries(req.searchParams),
              asString: req.searchParams.toString(),
            }),
          );
        },
        "/async-methods": async req => {
          await Bun.sleep(1);
          const result = {
            has: req.searchParams.has("key"),
            get: req.searchParams.get("key"),
            getAll: req.searchParams.getAll("key"),
            entries: Array.from(req.searchParams.entries()),
            keys: Array.from(req.searchParams.keys()),
            values: Array.from(req.searchParams.values()),
          };
          return new Response(JSON.stringify(result));
        },
        "/async-manipulation": async req => {
          await Bun.sleep(1);
          const query = req.searchParams;
          query.append("added", "value");
          query.set("existing", "updated");
          if (query.has("delete")) {
            query.delete("delete");
          }
          return new Response(query.toString());
        },
      },
    });
  });

  it("handles query parameters in async handlers", async () => {
    const res = await fetch(`${server.url}async-echo-query?foo=bar&baz=qux`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.asObject).toEqual({
      foo: "bar",
      baz: "qux",
    });
    expect(data.asString).toBe("foo=bar&baz=qux");
  });

  it("supports URLSearchParams methods in async handlers", async () => {
    const res = await fetch(`${server.url}async-methods?key=value&other=test`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.has).toBe(true);
    expect(data.get).toBe("value");
    expect(data.getAll).toEqual(["value"]);
    expect(data.entries).toEqual([
      ["key", "value"],
      ["other", "test"],
    ]);
    expect(data.keys).toEqual(["key", "other"]);
    expect(data.values).toEqual(["value", "test"]);
  });

  it("allows manipulation in async handlers", async () => {
    const res = await fetch(`${server.url}async-manipulation?existing=original&delete=remove`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("existing=updated&added=value");
  });
});
