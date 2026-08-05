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

describe("Bun.Cookie.parse Expires (RFC 6265bis §5.1.1 cookie-date)", () => {
  // The cookie-date algorithm diverges from a general HTTP-date parser on four
  // observable axes: two-digit-year cutoff, timezone handling, range limits, and
  // token-order independence. Browsers run §5.1.1, so we must too.
  const parseExpires = (d: string) => Bun.Cookie.parse("a=v; Expires=" + d).expires?.toISOString();

  test("two-digit years use the 0-69 => 20xx, 70-99 => 19xx rule", () => {
    expect(parseExpires("21 Oct 65 07:28:00 GMT")).toBe("2065-10-21T07:28:00.000Z");
    expect(parseExpires("21 Oct 69 07:28:00 GMT")).toBe("2069-10-21T07:28:00.000Z");
    expect(parseExpires("21 Oct 70 07:28:00 GMT")).toBe("1970-10-21T07:28:00.000Z");
    expect(parseExpires("21 Oct 99 07:28:00 GMT")).toBe("1999-10-21T07:28:00.000Z");
    // A cookie 39 years in the future must not be reported as already expired.
    expect(Bun.Cookie.parse("a=v; Expires=21 Oct 65 07:28:00 GMT").isExpired()).toBe(false);
  });

  test("timezone tokens are ignored, not honored and not fatal", () => {
    const want = "2015-10-21T07:28:00.000Z";
    expect(parseExpires("21 Oct 2015 07:28:00 EST")).toBe(want);
    expect(parseExpires("21 Oct 2015 07:28:00 PST")).toBe(want);
    expect(parseExpires("21 Oct 2015 07:28:00 CET")).toBe(want);
    expect(parseExpires("21 Oct 2015 07:28:00 JST")).toBe(want);
    expect(parseExpires("21 Oct 2015 07:28:00 Z")).toBe(want);
    expect(parseExpires("21 Oct 2015 07:28:00 +0500")).toBe(want);
    expect(parseExpires("21 Oct 2015 07:28:00 -0800")).toBe(want);
  });

  test("years below 1601 are rejected", () => {
    expect(parseExpires("21 Oct 1600 07:28:00 GMT")).toBeUndefined();
    expect(parseExpires("21 Oct 1601 07:28:00 GMT")).toBe("1601-10-21T07:28:00.000Z");
    // 3-digit years stay as-is (no +1900/+2000) and are then rejected by the 1601 floor.
    expect(parseExpires("21 Oct 100 07:28:00 GMT")).toBeUndefined();
  });

  test("time must be H:M:S; H:M is not a cookie-date", () => {
    expect(parseExpires("21 Oct 2015 07:28 GMT")).toBeUndefined();
    expect(parseExpires("21 Oct 2015 07:28:00 GMT")).toBe("2015-10-21T07:28:00.000Z");
    expect(parseExpires("21 Oct 2015 7:8:9 GMT")).toBe("2015-10-21T07:08:09.000Z");
  });

  test("tokens may appear in any order", () => {
    const want = "2015-10-21T07:28:00.000Z";
    expect(parseExpires("07:28:00 21 Oct 2015")).toBe(want);
    expect(parseExpires("2015 Oct 21 07:28:00")).toBe(want);
    expect(parseExpires("Oct 21 07:28:00 2015")).toBe(want);
  });

  test("canonical Set-Cookie date formats still parse", () => {
    const want = "2025-10-21T07:28:00.000Z";
    expect(parseExpires("Tue, 21 Oct 2025 07:28:00 GMT")).toBe(want);
    expect(parseExpires("Tue, 21-Oct-2025 07:28:00 GMT")).toBe(want);
    expect(parseExpires("Tue Oct 21 07:28:00 2025")).toBe(want);
  });

  test("out-of-range components are rejected", () => {
    expect(parseExpires("21 Oct 2015 24:00:00 GMT")).toBeUndefined();
    expect(parseExpires("21 Oct 2015 07:60:00 GMT")).toBeUndefined();
    expect(parseExpires("21 Oct 2015 07:28:60 GMT")).toBeUndefined();
    expect(parseExpires("32 Oct 2015 07:28:00 GMT")).toBeUndefined();
    expect(parseExpires("0 Oct 2015 07:28:00 GMT")).toBeUndefined();
  });

  test("non-existent calendar dates are rejected (§5.1.1 step 6)", () => {
    expect(parseExpires("31 Feb 2025 07:28:00 GMT")).toBeUndefined();
    expect(parseExpires("31 Apr 2025 07:28:00 GMT")).toBeUndefined();
    expect(parseExpires("29 Feb 2023 07:28:00 GMT")).toBeUndefined();
    expect(parseExpires("29 Feb 2024 07:28:00 GMT")).toBe("2024-02-29T07:28:00.000Z");
  });

  test("round-trips its own serialized Expires", () => {
    const date = new Date(Date.UTC(2031, 5, 9, 4, 5, 6));
    const header = new Bun.Cookie("a", "b", { expires: date }).toString();
    expect(Bun.Cookie.parse(header).expires?.toISOString()).toBe(date.toISOString());
  });

  test("constructor / setter string path agrees with parse", () => {
    // The JS-API string path (new Bun.Cookie({ expires: str }) / cookie.expires = str)
    // applies the same cookie-date algorithm, then falls back to the general
    // HTTP-date parser for inputs §5.1.1 rejects.
    const viaCtor = (d: string) => new Bun.Cookie("a", "v", { expires: d }).expires?.toISOString();
    expect(viaCtor("21 Oct 65 07:28:00 GMT")).toBe("2065-10-21T07:28:00.000Z");
    expect(viaCtor("21 Oct 2015 07:28:00 CET")).toBe("2015-10-21T07:28:00.000Z");
    expect(viaCtor("21 Oct 2015 07:28:00 +0500")).toBe("2015-10-21T07:28:00.000Z");
    // §5.1.1 rejects HH:MM without seconds; the fallback keeps accepting it (GMT so TZ-stable).
    expect(viaCtor("Wed, 21 Oct 2015 07:28 GMT")).toBe("2015-10-21T07:28:00.000Z");
    expect(() => new Bun.Cookie("a", "v", { expires: "tomorrow" })).toThrow("Invalid cookie expiration date");

    const cookie = new Bun.Cookie("a", "v");
    cookie.expires = "21 Oct 65 07:28:00 GMT";
    expect(cookie.expires?.toISOString()).toBe("2065-10-21T07:28:00.000Z");
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
