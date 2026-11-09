import { jscDescribe } from "bun:jsc";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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
          const body = (await req.json()) as [string, string | null, { domain?: string; path?: string } | undefined][];
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

// The value of a cookie made from a cookie string is the text of that string.
// toString() must not percent-encode that text a second time.
describe("the value of a cookie made from a cookie string", () => {
  // Each value is an RFC 6265 cookie-value in which every "%" starts an escape.
  const keptPairs = [
    "a=b%20c",
    "sid=s%3Aabc",
    "connect.sid=s%3Aabc.def%2Fghi",
    "j=%7B%22a%22%3A1%7D",
    "u=%e8%af%bb",
    "x=%fF",
    "tok=YWJj+/==",
    "k=a=b==",
    "p=!#$&'()*+-./:<>?@[]^_`{|}~",
    'q="abc"',
    'q="b%20c"',
    'e=""',
    "n=",
  ];
  // [pair, the pair that toString() writes]. These values have a "%" that does not start an escape.
  const strayPercentPairs: [string, string][] = [
    ["a=100%", "a=100%25"],
    ["a=50%-off", "a=50%25-off"],
    ["a=%zz", "a=%25zz"],
    ["a=a%2", "a=a%252"],
    ["a=%", "a=%25"],
    ["a=x%%20y", "a=x%25%2520y"],
    ["a=a%2Gb", "a=a%252Gb"],
    ["a=%G2", "a=%25G2"],
    ["a=%u00e9", "a=%25u00e9"],
    ['a="a%"', "a=%22a%25%22"],
  ];
  // [pair, the pair that toString() writes]. These values keep the bytes that Bun 1.4.3 writes.
  const encodedPairs: [string, string][] = [
    // a character that is not a cookie-octet
    ["a=b c", "a=b%20c"],
    ["a=b\tc", "a=b%09c"],
    ["a=x,y", "a=x%2Cy"],
    ["a=b\\c", "a=b%5Cc"],
    ["a=b\x01c", "a=b%01c"],
    ["a=b\x7Fc", "a=b%7Fc"],
    ["a=caf\u00e9", "a=caf%C3%A9"],
    // a double quote that is not one of a pair around cookie-octets
    ['a="b c"', "a=%22b%20c%22"],
    ['a="abc', "a=%22abc"],
    ['a=abc"', "a=abc%22"],
    ['a=b"c', "a=b%22c"],
    ['a="', "a=%22"],
    ...strayPercentPairs,
    // one such character sends the whole value to the encoder
    ["a=b%20c d", "a=b%2520c%20d"],
    ["a=caf\u00e9%20x", "a=caf%C3%A9%2520x"],
  ];
  const valueOf = (pair: string) => pair.slice(pair.indexOf("=") + 1);
  // The same text in a string that JavaScriptCore holds in 16 bits. The value of the cookie is then 16-bit too.
  const as16Bit = (text: string) => {
    const wide = Buffer.from(text, "utf16le").toString("utf16le");
    expect(jscDescribe(wide)).toContain("8Bit:(0)");
    return wide;
  };

  describe.each([
    ["Bun.Cookie.parse(string)", (cookieString: string) => Bun.Cookie.parse(cookieString)],
    ["new Bun.Cookie(string)", (cookieString: string) => new Bun.Cookie(cookieString)],
    [
      "new (class extends Bun.Cookie)(string)",
      (cookieString: string) => new (class extends Bun.Cookie {})(cookieString),
    ],
  ])("%s", (_, make) => {
    test.each([
      ["an 8-bit string", (text: string) => text],
      ["a 16-bit string", as16Bit],
    ])("writes a cookie-value from %s back as it is", (_, encoding) => {
      const actual = keptPairs.map(pair => {
        const cookie = make(encoding(pair + "; Path=/p; HttpOnly"));
        return [cookie.value, cookie.toJSON().value, cookie.toString(), cookie.serialize(), `${cookie}`];
      });
      expect(actual).toEqual(
        keptPairs.map(pair => {
          const written = pair + "; Path=/p; HttpOnly; SameSite=Lax";
          return [valueOf(pair), valueOf(pair), written, written, written];
        }),
      );
    });

    test.each([
      ["an 8-bit string", (text: string) => text],
      ["a 16-bit string", as16Bit],
    ])("percent-encodes every other value from %s", (_, encoding) => {
      const actual = encodedPairs.map(([pair]) => {
        const cookie = make(encoding(pair));
        return [cookie.value, cookie.toString()];
      });
      expect(actual).toEqual(
        encodedPairs.map(([pair, written]) => [valueOf(pair), written + "; Path=/; SameSite=Lax"]),
      );
    });
  });

  test("toString() does not change when its output is parsed again", () => {
    const pairs = [...keptPairs, ...encodedPairs.map(([pair]) => pair)];
    const first = pairs.map(pair => Bun.Cookie.parse(pair).toString());
    const third = first.map(header => Bun.Cookie.parse(Bun.Cookie.parse(header).toString()).toString());
    expect(third).toEqual(first);
  });

  test("a change to an attribute does not change how the value is written", () => {
    const cookie = Bun.Cookie.parse("a=b%20c");
    cookie.domain = "example.com";
    cookie.path = "/x";
    cookie.maxAge = 60;
    cookie.secure = true;
    cookie.httpOnly = true;
    cookie.partitioned = true;
    cookie.sameSite = "strict";
    expect(cookie.toString()).toBe(
      "a=b%20c; Domain=example.com; Path=/x; Max-Age=60; Secure; HttpOnly; Partitioned; SameSite=Strict",
    );
  });

  test("a value that is assigned is text, so toString() percent-encodes it", () => {
    const cookie = Bun.Cookie.parse("a=b%20c");
    cookie.value = "x y";
    expect(cookie.toString()).toBe("a=x%20y; Path=/; SameSite=Lax");
    cookie.value = "b%20c";
    expect(cookie.toString()).toBe("a=b%2520c; Path=/; SameSite=Lax");

    const assignedToItself = Bun.Cookie.parse("a=b%20c");
    assignedToItself.value = assignedToItself.value;
    expect(assignedToItself.toString()).toBe("a=b%2520c; Path=/; SameSite=Lax");
  });

  test("a copy made from a cookie string is written like its source", () => {
    const cookie = Bun.Cookie.parse("a=b%20c; Path=/p; HttpOnly");
    expect([
      Bun.Cookie.parse(cookie.toString()).toString(),
      new Bun.Cookie(`${cookie.name}=${cookie.value}`).toString(),
    ]).toEqual(["a=b%20c; Path=/p; HttpOnly; SameSite=Lax", "a=b%20c; Path=/; SameSite=Lax"]);
  });

  test("a copy made from the name and the value is text, so toString() percent-encodes it", () => {
    const cookie = Bun.Cookie.parse("a=b%20c");
    const copies = [
      new Bun.Cookie("a", "b%20c"),
      new Bun.Cookie(cookie.name, cookie.value),
      Bun.Cookie.from(cookie.name, cookie.value),
      new Bun.Cookie(cookie.toJSON()),
      // The constructor reads a Cookie the way it reads any object with a name and a value.
      new Bun.Cookie(cookie),
    ];
    expect(copies.map(copy => copy.toString())).toEqual([
      "a=b%2520c; Path=/; SameSite=Lax",
      "a=b%2520c; Path=/; SameSite=Lax",
      "a=b%2520c; Path=/; SameSite=Lax",
      "a=b%2520c; Path=/; SameSite=Lax",
      "a=b%2520c; Path=/; SameSite=Lax",
    ]);
  });

  // Bun.CookieMap reads a "%" that does not start an escape as U+FFFD. So toString() percent-encodes
  // a parsed value that has one, and Bun.CookieMap reads the text back.
  test("Bun.CookieMap reads back a written value with a '%' that does not start an escape", () => {
    const readBack = strayPercentPairs.map(([pair]) => {
      const written = Bun.Cookie.parse(pair).toString().split(";")[0];
      return new Bun.CookieMap(written).get("a");
    });
    expect(readBack).toEqual(strayPercentPairs.map(([pair]) => valueOf(pair)));
  });

  // When this test passes, Bun.CookieMap keeps such a "%", and toString() can write these values as parsed.
  // Then remove the "%" check from isEncodedCookieValue in Cookie.cpp and move strayPercentPairs into keptPairs.
  test.failing("Bun.CookieMap reads a '%' that does not start an escape without U+FFFD", () => {
    const read = strayPercentPairs.map(([pair]) => new Bun.CookieMap(pair).get("a")!);
    expect(read.filter(value => value.includes("\uFFFD"))).toEqual([]);
  });
});

test("throws when a cookie is too long to serialize, and Bun.serve responds without it", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        // Each quote becomes %22.
        const cookie = new Bun.Cookie("a", '"'.repeat(32 * 1024));
        const map = new Bun.CookieMap();
        map.set(cookie);
        for (const serialize of [() => cookie.toString(), () => map.toSetCookieHeaders()]) {
          try {
            console.log("length", serialize().length);
          } catch (e) {
            console.log(e.name, e.message);
          }
        }
        using server = Bun.serve({
          port: 0,
          development: false,
          routes: {
            "/": req => {
              req.cookies.set(cookie);
              return new Response("hello");
            },
          },
        });
        const res = await fetch(server.url);
        console.log(res.status, res.headers.get("set-cookie"), await res.text());
      `,
    ],
    env: { ...bunEnv, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: String(64 * 1024) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("RangeError Out of memory\nRangeError Out of memory\n200 null hello\n");
  expect(stderr).toContain("RangeError: Out of memory");
  expect(exitCode).toBe(0);
});
