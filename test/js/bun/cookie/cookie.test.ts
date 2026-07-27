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

// RFC 6265bis 5.6.20: a browser rejects SameSite=None without Secure. CHIPS likewise requires
// Partitioned cookies to be Secure. Bun refuses to build a cookie a browser would silently drop.
describe("SameSite=None / Partitioned require Secure", () => {
  const sameSiteNoneError = /"sameSite: none" requires secure: true/;
  const partitionedError = /"partitioned: true" requires secure: true/;

  describe.each([
    ["new Bun.Cookie(name, value, options)", (o: Bun.CookieInit) => new Bun.Cookie("s", "v", o)],
    ["new Bun.Cookie(options)", (o: Bun.CookieInit) => new Bun.Cookie({ name: "s", value: "v", ...o })],
    ["Bun.Cookie.from(name, value, options)", (o: Bun.CookieInit) => Bun.Cookie.from("s", "v", o)],
  ] as const)("%s", (_, make) => {
    test("sameSite: 'none' without secure throws", () => {
      expect(() => make({ sameSite: "none" })).toThrow(sameSiteNoneError);
      expect(() => make({ sameSite: "none", secure: false })).toThrow(sameSiteNoneError);
    });

    test("partitioned: true without secure throws", () => {
      expect(() => make({ partitioned: true })).toThrow(partitionedError);
      expect(() => make({ partitioned: true, secure: false })).toThrow(partitionedError);
    });

    test("sameSite: 'none' with secure: true includes Secure", () => {
      expect(make({ sameSite: "none", secure: true }).toString()).toBe("s=v; Path=/; Secure; SameSite=None");
    });

    test("partitioned: true with secure: true includes Secure", () => {
      expect(make({ partitioned: true, secure: true }).toString()).toBe("s=v; Path=/; Secure; Partitioned; SameSite=Lax");
    });

    test("both together with secure: true", () => {
      expect(make({ sameSite: "none", partitioned: true, secure: true }).toString()).toBe(
        "s=v; Path=/; Secure; Partitioned; SameSite=None",
      );
    });
  });

  test("CookieMap.set throws for the same combinations", () => {
    const map = new Bun.CookieMap();
    expect(() => map.set("s", "v", { sameSite: "none" })).toThrow(sameSiteNoneError);
    expect(() => map.set("p", "v", { partitioned: true })).toThrow(partitionedError);
    expect(() => map.set({ name: "s", value: "v", sameSite: "none", httpOnly: true })).toThrow(sameSiteNoneError);
    expect(map.size).toBe(0);

    map.set("s", "v", { sameSite: "none", secure: true });
    map.set("p", "v", { partitioned: true, secure: true });
    expect(map.toSetCookieHeaders()).toEqual([
      "s=v; Path=/; Secure; SameSite=None",
      "p=v; Path=/; Secure; Partitioned; SameSite=Lax",
    ]);
  });

  test("CookieMap.set(Cookie) re-validates a parsed cookie", () => {
    // Cookie.parse() reports what was on the wire; a non-Secure SameSite=None cookie is only
    // rejected when it is handed back to the write path.
    const parsed = Bun.Cookie.parse("s=v; SameSite=None");
    expect(parsed.sameSite).toBe("none");
    expect(parsed.secure).toBe(false);

    const map = new Bun.CookieMap();
    expect(() => map.set(parsed)).toThrow(sameSiteNoneError);
    expect(map.toSetCookieHeaders()).toEqual([]);

    parsed.secure = true;
    map.set(parsed);
    expect(map.toSetCookieHeaders()).toEqual(["s=v; Path=/; Secure; SameSite=None"]);
  });

  test("a rejected CookieMap.set leaves the existing entry in place", () => {
    const map = new Bun.CookieMap();
    map.set("s", "old");
    expect(() => map.set("s", "new", { sameSite: "none" })).toThrow(sameSiteNoneError);
    expect(map.get("s")).toBe("old");
  });

  describe("property setters on an existing Cookie", () => {
    test("sameSite = 'none' throws while secure is false", () => {
      const c = new Bun.Cookie("s", "v");
      expect(() => (c.sameSite = "none")).toThrow(sameSiteNoneError);
      expect(c.sameSite).toBe("lax");

      c.secure = true;
      c.sameSite = "none";
      expect(c.toString()).toBe("s=v; Path=/; Secure; SameSite=None");
    });

    test("partitioned = true throws while secure is false", () => {
      const c = new Bun.Cookie("p", "v");
      expect(() => (c.partitioned = true)).toThrow(partitionedError);
      expect(c.partitioned).toBe(false);

      c.secure = true;
      c.partitioned = true;
      expect(c.toString()).toBe("p=v; Path=/; Secure; Partitioned; SameSite=Lax");
    });

    test("secure = false throws while sameSite is 'none' or partitioned is true", () => {
      const c = new Bun.Cookie("s", "v", { secure: true, sameSite: "none" });
      expect(() => (c.secure = false)).toThrow(sameSiteNoneError);
      expect(c.secure).toBe(true);
      c.sameSite = "lax";
      c.secure = false;
      expect(c.secure).toBe(false);

      const p = new Bun.Cookie("p", "v", { secure: true, partitioned: true });
      expect(() => (p.secure = false)).toThrow(partitionedError);
      expect(p.secure).toBe(true);
      p.partitioned = false;
      p.secure = false;
      expect(p.secure).toBe(false);
    });
  });

  test("Bun.serve req.cookies.set emits Secure alongside SameSite=None", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/": req => {
          req.cookies.set("session", "TOKEN", { sameSite: "none", secure: true, httpOnly: true });
          return new Response("ok");
        },
      },
      fetch: () => new Response("nf", { status: 404 }),
    });
    const res = await fetch(server.url);
    expect(res.headers.getSetCookie()).toEqual(["session=TOKEN; Path=/; Secure; HttpOnly; SameSite=None"]);
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
          return Response.json({ message: String(caught) });
        },
      },
      fetch: () => new Response("nf", { status: 404 }),
    });
    const res = await fetch(server.url);
    const body = await res.json();
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
