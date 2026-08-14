import { afterAll, describe, expect, test } from "bun:test";

describe("Bun.Cookie validation tests", () => {
  describe("expires validation", () => {
    test("accepts valid Date for expires", () => {
      const futureDate = new Date(Date.now() + 86400000); // 1 day in the future
      const cookie = new Bun.Cookie("name", "value", { expires: futureDate });
      expect(cookie.expires).toBeDefined();
      expect(cookie.expires).toBeDate();
      expect(cookie.expires).toEqual(futureDate);
    });

    test("accepts valid number for expires", () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 86400; // 1 day in the future (in seconds)
      const cookie = new Bun.Cookie("name", "value", { expires: futureTimestamp });
      expect(cookie.expires).toEqual(new Date(futureTimestamp * 1000));
    });

    test("throws for NaN Date", () => {
      const invalidDate = new Date("invalid date"); // Creates a Date with NaN value
      expect(() => {
        new Bun.Cookie("name", "value", { expires: invalidDate });
      }).toThrow("expires must be a valid Date (or Number)");
    });

    test("throws for NaN number", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: NaN });
      }).toThrow("expires must be a valid Number");
    });

    test("throws for non-finite number (Infinity)", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: Infinity });
      }).toThrow("expires must be a valid Number");
    });

    test("does not throw for negative number", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: -1 });
      }).not.toThrow();

      expect(new Bun.Cookie("name", "value", { expires: -1 }).expires).toEqual(new Date(-1 * 1000));
    });

    test("handles undefined expires correctly", () => {
      const cookie = new Bun.Cookie("name", "value", { expires: undefined });
      expect(cookie.expires).toBeUndefined();
    });

    test("handles null expires correctly", () => {
      // @ts-expect-error
      const cookie = new Bun.Cookie("name", "value", { expires: null });
      expect(cookie.expires).toBeUndefined();
    });
  });

  describe("Cookie.from validation", () => {
    test("throws for NaN Date in Cookie.from", () => {
      const invalidDate = new Date("invalid date");
      expect(() => {
        Bun.Cookie.from("name", "value", { expires: invalidDate });
      }).toThrow("expires must be a valid Date (or Number)");
    });

    test("throws for NaN number in Cookie.from", () => {
      expect(() => {
        Bun.Cookie.from("name", "value", { expires: NaN });
      }).toThrow("expires must be a valid Number");
    });

    test("throws for non-finite number in Cookie.from", () => {
      expect(() => {
        Bun.Cookie.from("name", "value", { expires: Infinity });
      }).toThrow("expires must be a valid Number");
    });
  });

  describe("CookieInit validation", () => {
    test("throws with invalid expires when creating with options object", () => {
      expect(() => {
        new Bun.Cookie({
          name: "test",
          value: "value",
          expires: NaN,
        });
      }).toThrow("expires must be a valid Number");
    });

    test("accepts valid expires when creating with options object", () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 86400;
      const cookie = new Bun.Cookie({
        name: "test",
        value: "value",
        expires: futureTimestamp,
      });
      expect(cookie.expires).toEqual(new Date(futureTimestamp * 1000));
    });
  });
});

// RFC 6265bis: browsers drop a SameSite=None or Partitioned cookie that isn't Secure, and a
// __Secure-/__Host- cookie that doesn't meet the prefix rules. Bun refuses to build a cookie
// every browser would silently drop.
describe("attribute combinations every browser rejects", () => {
  const sameSiteNoneError = /"sameSite: none" requires secure: true/;
  const partitionedError = /"partitioned: true" requires secure: true/;
  const hostSecureError = /"__Host-" name prefix requires secure: true/;
  const hostDomainError = /"__Host-" name prefix does not allow a domain/;
  const hostPathError = /"__Host-" name prefix requires path: "\/"/;
  const securePrefixError = /"__Secure-" name prefix requires secure: true/;

  const expectTypeError = (fn: () => unknown, message: RegExp) => {
    expect(fn).toThrow(TypeError);
    expect(fn).toThrow(message);
  };

  const setEntryPoints = [
    ["new Bun.Cookie(name, value, options)", (n: string, o: Bun.CookieInit) => new Bun.Cookie(n, "v", o)],
    ["new Bun.Cookie(options)", (n: string, o: Bun.CookieInit) => new Bun.Cookie({ name: n, value: "v", ...o })],
    ["Bun.Cookie.from(name, value, options)", (n: string, o: Bun.CookieInit) => Bun.Cookie.from(n, "v", o)],
    [
      "CookieMap.set(name, value, options)",
      (n: string, o: Bun.CookieInit) => {
        const map = new Bun.CookieMap();
        map.set(n, "v", o);
        return Bun.Cookie.parse(map.toSetCookieHeaders()[0]);
      },
    ],
    [
      "CookieMap.set(options)",
      (n: string, o: Bun.CookieInit) => {
        const map = new Bun.CookieMap();
        map.set({ name: n, value: "v", ...o });
        return Bun.Cookie.parse(map.toSetCookieHeaders()[0]);
      },
    ],
  ] as const;

  describe.each(setEntryPoints)("%s", (_, make) => {
    test.each([
      ["sameSite: 'none' without secure", "s", { sameSite: "none" } as const, sameSiteNoneError],
      ["sameSite: 'none' with secure: false", "s", { sameSite: "none", secure: false } as const, sameSiteNoneError],
      ["partitioned: true without secure", "s", { partitioned: true }, partitionedError],
      ["partitioned: true with secure: false", "s", { partitioned: true, secure: false }, partitionedError],
      ["__Host- without secure", "__Host-s", {}, hostSecureError],
      ["__Host- with a domain", "__Host-s", { secure: true, domain: "example.com" }, hostDomainError],
      ["__Host- with a non-/ path", "__Host-s", { secure: true, path: "/admin" }, hostPathError],
      ["__Host- with an empty path", "__Host-s", { secure: true, path: "" }, hostPathError],
      ["__Secure- without secure", "__Secure-s", {}, securePrefixError],
      ["__Secure- with secure: false", "__Secure-s", { secure: false }, securePrefixError],
    ])("throws for %s", (_, name, options, error) => {
      expectTypeError(() => make(name, options), error);
    });

    test.each([
      [{ sameSite: "none", secure: true } as const, "s=v; Path=/; Secure; SameSite=None"],
      [{ partitioned: true, secure: true }, "s=v; Path=/; Secure; Partitioned; SameSite=Lax"],
      [
        { sameSite: "none", partitioned: true, secure: true } as const,
        "s=v; Path=/; Secure; Partitioned; SameSite=None",
      ],
    ])("accepts %p", (options, serialized) => {
      expect(make("s", options).toString()).toBe(serialized);
    });

    test.each([
      ["__Host-s", { secure: true }, "__Host-s=v; Path=/; Secure; SameSite=Lax"],
      ["__Host-s", { secure: true, sameSite: "none" } as const, "__Host-s=v; Path=/; Secure; SameSite=None"],
      ["__Secure-s", { secure: true }, "__Secure-s=v; Path=/; Secure; SameSite=Lax"],
      [
        "__Secure-s",
        { secure: true, domain: "example.com", path: "/admin" },
        "__Secure-s=v; Domain=example.com; Path=/admin; Secure; SameSite=Lax",
      ],
    ])("accepts prefixed %p with %p", (name, options, serialized) => {
      expect(make(name, options).toString()).toBe(serialized);
    });
  });

  test("the name prefix is matched case-insensitively, like browsers do", () => {
    expectTypeError(() => new Bun.Cookie("__host-s", "v"), hostSecureError);
    expectTypeError(() => new Bun.Cookie("__SECURE-s", "v"), securePrefixError);
  });

  test("a name that merely contains a prefix token is unaffected", () => {
    expect(new Bun.Cookie("x__Host-s", "v").toString()).toBe("x__Host-s=v; Path=/; SameSite=Lax");
    expect(new Bun.Cookie("__Host", "v").toString()).toBe("__Host=v; Path=/; SameSite=Lax");
    expect(new Bun.Cookie("__Secure", "v").toString()).toBe("__Secure=v; Path=/; SameSite=Lax");
  });

  test("Cookie.parse reports what was on the wire without throwing", () => {
    const cases = [
      ["a=b; SameSite=None", { sameSite: "none", secure: false }],
      ["a=b; Partitioned", { partitioned: true, secure: false }],
      ["__Host-a=b", { name: "__Host-a", secure: false }],
      ["__Host-a=b; Domain=example.com; Secure", { name: "__Host-a", domain: "example.com", secure: true }],
      ["__Secure-a=b", { name: "__Secure-a", secure: false }],
    ] as const;
    for (const [header, expected] of cases) {
      const parsed = Bun.Cookie.parse(header);
      for (const [key, value] of Object.entries(expected)) {
        expect(parsed[key as keyof Bun.Cookie]).toBe(value);
      }
    }
  });

  test.each([
    ["s=v; SameSite=None", sameSiteNoneError, "s=v; Path=/; Secure; SameSite=None"],
    ["p=v; Partitioned", partitionedError, "p=v; Path=/; Secure; Partitioned; SameSite=Lax"],
    ["__Host-s=v", hostSecureError, "__Host-s=v; Path=/; Secure; SameSite=Lax"],
    ["__Secure-s=v", securePrefixError, "__Secure-s=v; Path=/; Secure; SameSite=Lax"],
  ] as const)("CookieMap.set(Cookie) re-validates a parsed %p cookie", (header, error, fixed) => {
    const parsed = Bun.Cookie.parse(header);
    expect(parsed.secure).toBe(false);

    const map = new Bun.CookieMap();
    expectTypeError(() => map.set(parsed), error);
    expect(map.toSetCookieHeaders()).toEqual([]);

    parsed.secure = true;
    map.set(parsed);
    expect(map.toSetCookieHeaders()).toEqual([fixed]);
  });

  test("a rejected CookieMap.set leaves the existing entry in place", () => {
    const map = new Bun.CookieMap();
    map.set("s", "old");
    expectTypeError(() => map.set("s", "new", { sameSite: "none" }), sameSiteNoneError);
    expect(map.get("s")).toBe("old");

    // set(Cookie) path: validation must run before the old entry is removed.
    expectTypeError(() => map.set(Bun.Cookie.parse("s=new; SameSite=None")), sameSiteNoneError);
    expect(map.get("s")).toBe("old");
    expect(map.toSetCookieHeaders()).toEqual(["s=old; Path=/; SameSite=Lax"]);
  });

  describe("property setters on an existing Cookie", () => {
    test("sameSite = 'none' throws while secure is false", () => {
      const c = new Bun.Cookie("s", "v");
      expectTypeError(() => (c.sameSite = "none"), sameSiteNoneError);
      expect(c.sameSite).toBe("lax");

      c.secure = true;
      c.sameSite = "none";
      expect(c.toString()).toBe("s=v; Path=/; Secure; SameSite=None");
    });

    test("partitioned = true throws while secure is false", () => {
      const c = new Bun.Cookie("p", "v");
      expectTypeError(() => (c.partitioned = true), partitionedError);
      expect(c.partitioned).toBe(false);

      c.secure = true;
      c.partitioned = true;
      expect(c.toString()).toBe("p=v; Path=/; Secure; Partitioned; SameSite=Lax");
    });

    test("secure = false throws while sameSite is 'none' or partitioned is true", () => {
      const c = new Bun.Cookie("s", "v", { secure: true, sameSite: "none" });
      expectTypeError(() => (c.secure = false), sameSiteNoneError);
      expect(c.secure).toBe(true);
      c.sameSite = "lax";
      c.secure = false;
      expect(c.secure).toBe(false);

      const p = new Bun.Cookie("p", "v", { secure: true, partitioned: true });
      expectTypeError(() => (p.secure = false), partitionedError);
      expect(p.secure).toBe(true);
      p.partitioned = false;
      p.secure = false;
      expect(p.secure).toBe(false);
    });

    test("secure = false throws on a prefixed cookie", () => {
      const host = new Bun.Cookie("__Host-s", "v", { secure: true });
      expectTypeError(() => (host.secure = false), hostSecureError);
      expect(host.secure).toBe(true);

      const sec = new Bun.Cookie("__Secure-s", "v", { secure: true });
      expectTypeError(() => (sec.secure = false), securePrefixError);
      expect(sec.secure).toBe(true);
    });

    test("domain / path setters throw on a __Host- cookie", () => {
      const host = new Bun.Cookie("__Host-s", "v", { secure: true });
      expectTypeError(() => (host.domain = "example.com"), hostDomainError);
      expectTypeError(() => (host.path = "/admin"), hostPathError);
      expectTypeError(() => (host.path = ""), hostPathError);
      expect(host.toString()).toBe("__Host-s=v; Path=/; Secure; SameSite=Lax");

      // __Secure- only constrains the secure flag.
      const sec = new Bun.Cookie("__Secure-s", "v", { secure: true });
      sec.domain = "example.com";
      sec.path = "/admin";
      expect(sec.toString()).toBe("__Secure-s=v; Domain=example.com; Path=/admin; Secure; SameSite=Lax");
    });

    test("setters on an unprefixed cookie are otherwise unaffected", () => {
      const c = new Bun.Cookie("a", "v", { secure: true });
      c.secure = false;
      c.domain = "example.com";
      c.path = "/admin";
      expect(c.toString()).toBe("a=v; Domain=example.com; Path=/admin; SameSite=Lax");
    });

    test("a setter only rejects violations involving the field being changed", () => {
      // A parsed __Host- cookie can be wrong on several axes at once. Each setter guards only its
      // own field, so the cookie can be repaired one field at a time instead of deadlocking.
      const c = Bun.Cookie.parse("__Host-s=v; Domain=example.com; Path=/admin");
      expect(c.secure).toBe(false);
      expect(c.domain).toBe("example.com");
      expect(c.path).toBe("/admin");

      c.secure = true;
      c.domain = "";
      c.path = "/";
      expect(c.toString()).toBe("__Host-s=v; Path=/; Secure; SameSite=Lax");

      // Each assignment that would itself introduce a violation is still rejected.
      expectTypeError(() => (c.secure = false), hostSecureError);
      expectTypeError(() => (c.domain = "example.com"), hostDomainError);
      expectTypeError(() => (c.path = "/admin"), hostPathError);
    });
  });

  test("Bun.serve req.cookies.set emits Secure alongside SameSite=None", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/": req => {
          req.cookies.set("session", "TOKEN", { sameSite: "none", secure: true, httpOnly: true });
          req.cookies.set("__Host-id", "TOKEN", { secure: true });
          return new Response("ok");
        },
      },
      fetch: () => new Response("nf", { status: 404 }),
    });
    const res = await fetch(server.url);
    expect(res.headers.getSetCookie()).toEqual([
      "session=TOKEN; Path=/; Secure; HttpOnly; SameSite=None",
      "__Host-id=TOKEN; Path=/; Secure; SameSite=Lax",
    ]);
    expect(res.status).toBe(200);
  });

  test("Bun.serve req.cookies.set without secure throws before reaching the wire", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/": req => {
          let caught: unknown;
          try {
            req.cookies.set("session", "TOKEN", { sameSite: "none", httpOnly: true });
          } catch (e) {
            caught = e;
          }
          return Response.json({
            name: caught instanceof TypeError ? caught.name : "not a TypeError",
            message: caught instanceof Error ? caught.message : String(caught),
          });
        },
      },
      fetch: () => new Response("nf", { status: 404 }),
    });
    const res = await fetch(server.url);
    const body = await res.json();
    expect(body.name).toBe("TypeError");
    expect(body.message).toMatch(sameSiteNoneError);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.status).toBe(200);
  });
});

describe("Expires serialization", () => {
  // RFC 6265 expects an IMF-fixdate: "Wdy, DD Mon YYYY HH:MM:SS GMT".
  // Date.prototype.toUTCString() produces exactly that, so the two must agree.
  test("Expires is an IMF-fixdate matching Date.toUTCString() for every weekday", () => {
    // 7 consecutive UTC days covers every weekday; the 9th keeps the day zero-padded.
    for (let i = 0; i < 7; i++) {
      const date = new Date(Date.UTC(2031, 5, 9 + i, 4, 5, 6));
      const cookie = new Bun.Cookie("a", "b", { expires: date });
      expect(cookie.toString()).toBe(`a=b; Path=/; Expires=${date.toUTCString()}; SameSite=Lax`);
    }
  });

  test("Expires=0 serializes the epoch, not the day after", () => {
    const cookie = new Bun.Cookie("a", "b", { expires: new Date(0) });
    expect(cookie.toString()).toBe("a=b; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax");
  });

  test("CookieMap.delete emits an IMF-fixdate epoch", () => {
    const map = new Bun.CookieMap();
    map.delete("gone");
    expect(map.toSetCookieHeaders()).toEqual(["gone=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax"]);
  });
});

console.log("describe Bun.serve() cookies");
describe("Bun.serve() cookies", () => {
  const server = Bun.serve({
    port: 0,
    routes: {
      "/tester": {
        POST: async req => {
          const body: [string, string | null, { domain?: string; path?: string } | undefined][] = await req.json();
          for (const [key, value, options] of body) {
            if (value == null) {
              req.cookies.delete({
                name: key,
                ...options,
              });
            } else {
              req.cookies.set(key, value, options);
            }
          }
          return new Response(JSON.stringify(req.cookies), {
            headers: {
              "Content-Type": "application/json",
            },
          });
        },
      },
    },
  });
  afterAll(() => {
    server.stop();
  });

  test("set-cookie", async () => {
    const res = await fetch(server.url + "/tester", {
      method: "POST",
      body: JSON.stringify([["test", "test"]]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchInlineSnapshot(`
      {
        "test": "test",
      }
    `);
    expect(res.headers.getAll("Set-Cookie")).toMatchInlineSnapshot(`
      [
        "test=test; Path=/; SameSite=Lax",
      ]
    `);
  });
  test("set two cookies", async () => {
    const res = await fetch(server.url + "/tester", {
      method: "POST",
      body: JSON.stringify([
        ["test", "test"],
        ["test2", "test2"],
      ]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchInlineSnapshot(`
      {
        "test": "test",
        "test2": "test2",
      }
    `);
    expect(res.headers.getAll("Set-Cookie")).toMatchInlineSnapshot(`
      [
        "test=test; Path=/; SameSite=Lax",
        "test2=test2; Path=/; SameSite=Lax",
      ]
    `);
  });
  test("delete cookie", async () => {
    const res = await fetch(server.url + "/tester", {
      method: "POST",
      body: JSON.stringify([["test", null]]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchInlineSnapshot(`{}`);
    expect(res.headers.getAll("Set-Cookie")).toMatchInlineSnapshot(`
      [
        "test=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax",
      ]
    `);
  });
  test("request with cookies", async () => {
    const res = await fetch(server.url + "/tester", {
      method: "POST",
      body: JSON.stringify([
        ["do_modify", "c"],
        ["add_cookie", "d"],
      ]),
      headers: {
        "Cookie": "dont_modify=a;do_modify=b",
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchInlineSnapshot(`
      {
        "add_cookie": "d",
        "do_modify": "c",
        "dont_modify": "a",
      }
    `);
    expect(res.headers.getAll("Set-Cookie")).toMatchInlineSnapshot(`
      [
        "do_modify=c; Path=/; SameSite=Lax",
        "add_cookie=d; Path=/; SameSite=Lax",
      ]
    `);
  });
  test("request that doesn't modify cookies doesn't set cookies", async () => {
    const res = await fetch(server.url + "/tester", {
      method: "POST",
      body: JSON.stringify([]),
      headers: {
        "Cookie": "dont_modify=a;another_cookie=b",
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchInlineSnapshot(`
      {
        "another_cookie": "b",
        "dont_modify": "a",
      }
    `);
    expect(res.headers.getAll("Set-Cookie")).toMatchInlineSnapshot(`[]`);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
  test("getAllChanges", () => {
    const map = new Bun.CookieMap("dont_modify=ONE; do_modify=TWO; do_delete=THREE");
    map.set("do_modify", "FOUR");
    map.delete("do_delete");
    map.set("do_modify", "FIVE");
    expect(map.toSetCookieHeaders()).toMatchInlineSnapshot(`
      [
        "do_delete=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax",
        "do_modify=FIVE; Path=/; SameSite=Lax",
      ]
    `);
    expect(map.toJSON()).toMatchInlineSnapshot(`
      {
        "do_modify": "FIVE",
        "dont_modify": "ONE",
      }
    `);
  });
});

describe("Bun.serve() cookies 2", () => {
  const server = Bun.serve({
    port: 0,
    routes: {
      "/": req => {
        // Access request cookies
        const cookies = req.cookies;

        // Get a specific cookie
        const sessionCookie = cookies.get("session");
        if (sessionCookie != null) {
          // console.log(sessionCookie);
        }

        // Check if a cookie exists
        if (cookies.has("theme")) {
          // ...
        }

        // Set a cookie, it will be automatically applied to the response
        cookies.set("visited", "true");

        console.log(cookies.toSetCookieHeaders());

        return new Response("Hello");
      },
      "/redirect": req => {
        req.cookies.set("redirected", "true");
        return Response.redirect("/redirect-target");
      },
    },
  });
  afterAll(() => {
    server.stop();
  });

  test("server sets cookie", async () => {
    const response = await fetch(server.url, {
      headers: {
        "Cookie": "abc=def; ghi=jkl",
      },
    });
    expect(response.headers.getAll("Set-Cookie")).toMatchInlineSnapshot(`
      [
        "visited=true; Path=/; SameSite=Lax",
      ]
    `);
  });
  test("server sets cookie on redirect", async () => {
    const response = await fetch(server.url + "/redirect", {
      headers: {
        "Cookie": "abc=def; ghi=jkl",
      },
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/redirect-target");
    expect(response.headers.getAll("Set-Cookie")).toMatchInlineSnapshot(`
      [
        "redirected=true; Path=/; SameSite=Lax",
      ]
    `);
  });
});

describe("cookie path option", () => {
  const server = Bun.serve({
    port: 0,
    routes: {
      "/x/y": {
        GET(r) {
          r.cookies.set("user", "a", { maxAge: 3600, path: "/" });
          const cookie = r.cookies.toSetCookieHeaders().at(0)!;
          return new Response("ok", {
            headers: { "set-cookie": cookie },
          });
        },
      },
    },
  });
  afterAll(() => server.stop());

  test("cookie path option", async () => {
    const response = await fetch(server.url + "/x/y");
    expect(response.status).toBe(200);
    expect(response.headers.getAll("Set-Cookie")).toMatchInlineSnapshot(`
      [
        "user=a; Path=/; Max-Age=3600; SameSite=Lax",
        "user=a; Path=/; Max-Age=3600; SameSite=Lax",
      ]
    `);
  });
});
test("delete cookie path option", () => {
  const map = new Bun.CookieMap();
  map.delete("a", { path: "/b" });
  map.delete("b", { path: "" });
  map.delete("c", {});
  map.delete("d", { path: "/" });
  expect(map.toSetCookieHeaders()).toMatchInlineSnapshot(`
    [
      "a=; Path=/b; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax",
      "b=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax",
      "c=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax",
      "d=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax",
    ]
  `);
});
test("delete cookie invalid path option", () => {
  const map = new Bun.CookieMap();
  expect(() => map.delete("a", { path: "\n" })).toThrowErrorMatchingInlineSnapshot(
    `"Invalid cookie path: contains invalid characters"`,
  );
  expect(() => map.delete("a", { domain: "\n" })).toThrowErrorMatchingInlineSnapshot(
    `"Invalid cookie domain: contains invalid characters"`,
  );
  expect(() => map.delete("\n", {})).toThrowErrorMatchingInlineSnapshot(
    `"Invalid cookie name: contains invalid characters"`,
  );
});

describe("Bun.CookieMap constructor", () => {
  test("throws for invalid array", () => {
    expect(() => new Bun.CookieMap([["abc defg =fhaingj809读写汉字学中文"]])).toThrowErrorMatchingInlineSnapshot(
      `"Expected arrays of exactly two strings"`,
    );
  });
  test("accepts unicode cookie value in object", () => {
    const map = new Bun.CookieMap({
      "cookie key": "读写汉字学中文",
    });
    expect(map.get("cookie key")).toBe("读写汉字学中文");
  });
  test("accepts unicode cookie value in array", () => {
    const map = new Bun.CookieMap([["cookie key", "读写汉字学中文"]]);
    expect(map.get("cookie key")).toBe("读写汉字学中文");
  });
  test("accepts unicode cookie value in string", () => {
    const map = new Bun.CookieMap("cookie key=读写汉字学中文");
    expect(map.get("cookie key")).toBe("读写汉字学中文");
  });
  test("serializes unicode cookie value", () => {
    const map = new Bun.CookieMap();
    map.set("cookiekey", "读写汉字学中文");
    expect(map.toSetCookieHeaders()).toMatchInlineSnapshot(`
      [
        "cookiekey=%E8%AF%BB%E5%86%99%E6%B1%89%E5%AD%97%E5%AD%A6%E4%B8%AD%E6%96%87; Path=/; SameSite=Lax",
      ]
    `);
    // re-parse
    const reparsed = new Bun.CookieMap(map.toSetCookieHeaders()[0].split(";")[0]!);
    expect(reparsed.get("cookiekey")).toBe("读写汉字学中文");
  });
  test("doesn't parse percent encoded value in object or array", () => {
    const map = new Bun.CookieMap({
      "cookiekey": "%E8%AF%BB%E5%86%99%E6%B1%89%E5%AD%97%E5%AD%A6%E4%B8%AD%E6%96%87",
    });
    const map2 = new Bun.CookieMap([["cookiekey", "%E8%AF%BB%E5%86%99%E6%B1%89%E5%AD%97%E5%AD%A6%E4%B8%AD%E6%96%87"]]);
    expect(map.get("cookiekey")).toBe("%E8%AF%BB%E5%86%99%E6%B1%89%E5%AD%97%E5%AD%A6%E4%B8%AD%E6%96%87");
    expect(map2.get("cookiekey")).toBe("%E8%AF%BB%E5%86%99%E6%B1%89%E5%AD%97%E5%AD%A6%E4%B8%AD%E6%96%87");
  });
});

describe("cookie name parsing from Cookie header", () => {
  test("does not percent-decode cookie names when parsing a Cookie header string", () => {
    // A cookie literally named "__%48ost-session" must not alias "__Host-session":
    // browsers enforce __Host-/__Secure- prefix rules on the literal, un-decoded name,
    // so decoding the name would let an unprotected cookie shadow a protected one.
    const map = new Bun.CookieMap("__%48ost-session=attacker; __Host-session=legit");
    expect(map.get("__Host-session")).toBe("legit");
    expect(map.get("__%48ost-session")).toBe("attacker");

    // A lone encoded name must not surface under the decoded name at all.
    const only = new Bun.CookieMap("__%48ost-session=attacker");
    expect(only.get("__Host-session")).toBeNull();
    expect(only.get("__%48ost-session")).toBe("attacker");

    // Values are still percent-decoded.
    expect(new Bun.CookieMap("plain=%E8%AF%BB").get("plain")).toBe("读");
  });

  test("request cookie lookup matches names literally", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/": req =>
          Response.json({
            host: req.cookies.get("__Host-session"),
            raw: req.cookies.get("__%48ost-session"),
          }),
      },
    });
    const res = await fetch(server.url, {
      headers: { "Cookie": "__%48ost-session=attacker" },
    });
    expect(await res.json()).toEqual({ host: null, raw: "attacker" });
    expect(res.status).toBe(200);
  });
});
