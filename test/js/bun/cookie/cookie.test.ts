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

// RFC 6265bis 4.1.3: a user agent ignores a cookie whose name carries one of these prefixes
// unless it satisfies the prefix's requirements, so creating one is a mistake worth reporting.
describe("__Secure- and __Host- name prefixes", () => {
  test("__Secure- requires secure", () => {
    expect(() => new Bun.Cookie("__Secure-a", "1")).toThrow(
      'Invalid cookie name: "__Secure-" prefix requires secure: true',
    );
    expect(() => new Bun.Cookie("__Secure-a", "1", { secure: false })).toThrow(
      'Invalid cookie name: "__Secure-" prefix requires secure: true',
    );
    expect(new Bun.Cookie("__Secure-a", "1", { secure: true }).toString()).toBe(
      "__Secure-a=1; Path=/; Secure; SameSite=Lax",
    );
  });

  test("__Secure- allows a domain and any path", () => {
    expect(new Bun.Cookie("__Secure-a", "1", { secure: true, domain: "example.com", path: "/admin" }).toString()).toBe(
      "__Secure-a=1; Domain=example.com; Path=/admin; Secure; SameSite=Lax",
    );
  });

  test("__Host- requires secure", () => {
    expect(() => new Bun.Cookie("__Host-a", "1")).toThrow('Invalid cookie name: "__Host-" prefix requires secure: true');
    expect(new Bun.Cookie("__Host-a", "1", { secure: true }).toString()).toBe(
      "__Host-a=1; Path=/; Secure; SameSite=Lax",
    );
  });

  test("__Host- forbids a domain", () => {
    expect(() => new Bun.Cookie("__Host-a", "1", { secure: true, domain: "example.com" })).toThrow(
      'Invalid cookie name: "__Host-" prefix does not allow a domain',
    );
  });

  test('__Host- requires a path of "/"', () => {
    expect(() => new Bun.Cookie("__Host-a", "1", { secure: true, path: "/admin" })).toThrow(
      'Invalid cookie name: "__Host-" prefix requires path: "/"',
    );
    // An empty path omits the attribute entirely, which __Host- does not allow either.
    expect(() => new Bun.Cookie("__Host-a", "1", { secure: true, path: "" })).toThrow(
      'Invalid cookie name: "__Host-" prefix requires path: "/"',
    );
  });

  test("the prefix is matched case-insensitively, like browsers do", () => {
    expect(() => new Bun.Cookie("__host-a", "1")).toThrow('Invalid cookie name: "__Host-" prefix requires secure: true');
    expect(() => new Bun.Cookie("__SECURE-a", "1")).toThrow(
      'Invalid cookie name: "__Secure-" prefix requires secure: true',
    );
  });

  test("a name that only contains the prefix is unaffected", () => {
    expect(new Bun.Cookie("x__Host-a", "1").toString()).toBe("x__Host-a=1; Path=/; SameSite=Lax");
    expect(new Bun.Cookie("__Host", "1").toString()).toBe("__Host=1; Path=/; SameSite=Lax");
  });

  test("the object and Cookie.from forms are checked too", () => {
    expect(() => new Bun.Cookie({ name: "__Host-a", value: "1" })).toThrow(
      'Invalid cookie name: "__Host-" prefix requires secure: true',
    );
    expect(() => Bun.Cookie.from("__Host-a", "1", { secure: true, domain: "example.com" })).toThrow(
      'Invalid cookie name: "__Host-" prefix does not allow a domain',
    );
  });

  test("Cookie.parse reports what was on the wire without throwing", () => {
    const cookie = Bun.Cookie.parse("__Host-a=1");
    expect(cookie.secure).toBe(false);
    expect(cookie.toString()).toBe("__Host-a=1; Path=/; SameSite=Lax");
  });

  test("a cookie in the wire-invalid state from Cookie.parse can be repaired", () => {
    const cookie = Bun.Cookie.parse("__Host-a=1");
    cookie.secure = true;
    const map = new Bun.CookieMap();
    map.set(cookie);
    expect(map.toSetCookieHeaders()).toEqual(["__Host-a=1; Path=/; Secure; SameSite=Lax"]);
  });

  test("the setters cannot mutate a prefixed cookie into a state browsers ignore", () => {
    const cookie = new Bun.Cookie("__Host-a", "1", { secure: true });
    expect(() => (cookie.secure = false)).toThrow('Invalid cookie name: "__Host-" prefix requires secure: true');
    expect(() => (cookie.domain = "example.com")).toThrow('Invalid cookie name: "__Host-" prefix does not allow a domain');
    expect(() => (cookie.path = "/admin")).toThrow('Invalid cookie name: "__Host-" prefix requires path: "/"');
    expect(cookie.toString()).toBe("__Host-a=1; Path=/; Secure; SameSite=Lax");

    const secureCookie = new Bun.Cookie("__Secure-a", "1", { secure: true });
    expect(() => (secureCookie.secure = false)).toThrow('Invalid cookie name: "__Secure-" prefix requires secure: true');
    // __Secure- constrains nothing but the secure flag.
    secureCookie.domain = "example.com";
    secureCookie.path = "/admin";
    expect(secureCookie.toString()).toBe("__Secure-a=1; Domain=example.com; Path=/admin; Secure; SameSite=Lax");
  });

  test("a cookie already set on a map cannot be mutated into an invalid one", () => {
    // CookieMap.set() keeps a reference to the Cookie, so the object stays reachable.
    const cookie = new Bun.Cookie("__Host-a", "1", { secure: true });
    const map = new Bun.CookieMap();
    map.set(cookie);
    expect(() => (cookie.secure = false)).toThrow('Invalid cookie name: "__Host-" prefix requires secure: true');
    expect(map.toSetCookieHeaders()).toEqual(["__Host-a=1; Path=/; Secure; SameSite=Lax"]);
  });

  test("setters on a cookie without a prefixed name are unaffected", () => {
    const cookie = new Bun.Cookie("a", "1", { secure: true });
    cookie.secure = false;
    cookie.domain = "example.com";
    cookie.path = "/admin";
    expect(cookie.toString()).toBe("a=1; Domain=example.com; Path=/admin; SameSite=Lax");
  });

  test("Bun.serve emits a __Host- cookie the browser accepts", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/": req => {
          req.cookies.set("__Host-sid", "s3cret", { secure: true });
          return new Response("ok");
        },
      },
    });
    const res = await fetch(server.url);
    expect(res.headers.getSetCookie()).toEqual(["__Host-sid=s3cret; Path=/; Secure; SameSite=Lax"]);
    expect(res.status).toBe(200);
  });
});

describe("cookie path attribute", () => {
  test("a path that does not start with / is rejected", () => {
    // RFC 6265 5.2.4: user agents ignore such a Path attribute, and Bun's own parser drops
    // it, so the cookie could not even round-trip through Bun.Cookie.parse.
    expect(() => new Bun.Cookie("a", "b", { path: "x" })).toThrow('Invalid cookie path: must start with "/"');
    expect(() => new Bun.Cookie("a", "b", { path: "../x" })).toThrow('Invalid cookie path: must start with "/"');
    expect(() => Bun.Cookie.from("a", "b", { path: "x" })).toThrow('Invalid cookie path: must start with "/"');
    expect(() => new Bun.CookieMap().delete("a", { path: "x" })).toThrow('Invalid cookie path: must start with "/"');
  });

  test("the path setter rejects a relative path", () => {
    const cookie = new Bun.Cookie("a", "b", { path: "/x" });
    expect(() => (cookie.path = "x")).toThrow('Invalid cookie path: must start with "/"');
    expect(cookie.path).toBe("/x");
  });

  test("an empty path omits the attribute", () => {
    expect(new Bun.Cookie("a", "b", { path: "" }).toString()).toBe("a=b; SameSite=Lax");
  });

  test("an absolute path round-trips through Cookie.parse", () => {
    const serialized = new Bun.Cookie("a", "b", { path: "/x" }).toString();
    expect(serialized).toBe("a=b; Path=/x; SameSite=Lax");
    expect(Bun.Cookie.parse(serialized).path).toBe("/x");
  });
});
