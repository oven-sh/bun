import { describe, expect, test } from "bun:test";

describe("Bun.Cookie and Bun.CookieMap", () => {
  // Basic Cookie tests
  test("can create a basic Cookie", () => {
    const cookie = new Bun.Cookie("name", "value");
    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.path).toBe("/");
    expect(cookie.domain).toBeNull();
    expect(cookie.secure).toBe(false);
    expect(cookie.httpOnly).toBe(false);
    expect(cookie.partitioned).toBe(false);
    expect(cookie.sameSite).toBe("lax");
  });

  test("can create a Cookie with options", () => {
    const cookie = new Bun.Cookie("name", "value", {
      domain: "example.com",
      path: "/foo",
      secure: true,
      httpOnly: true,
      partitioned: true,
      sameSite: "lax",
      maxAge: 3600,
    });

    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.domain).toBe("example.com");
    expect(cookie.path).toBe("/foo");
    expect(cookie.secure).toBe(true);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.partitioned).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.maxAge).toBe(3600);
  });

  test("Cookie.toString() formats properly", () => {
    const cookie = new Bun.Cookie("name", "value", {
      domain: "example.com",
      path: "/foo",
      secure: true,
      httpOnly: true,
      partitioned: true,
      sameSite: "strict",
      maxAge: 3600,
    });

    const str = cookie.toString();
    expect(str).toInclude("name=value");
    expect(str).toInclude("Domain=example.com");
    expect(str).toInclude("Path=/foo");
    expect(str).toInclude("Max-Age=3600");
    expect(str).toInclude("Secure");
    expect(str).toInclude("HttpOnly");
    expect(str).toInclude("Partitioned");
    expect(str).toInclude("SameSite=Strict");
    expect(str).toMatchInlineSnapshot(
      `"name=value; Domain=example.com; Path=/foo; Max-Age=3600; Secure; HttpOnly; Partitioned; SameSite=Strict"`,
    );
  });

  test("can set Cookie expires as Date", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1); // tomorrow

    const cookie = new Bun.Cookie("name", "value", {
      expires: futureDate,
    });

    expect(cookie.isExpired()).toBe(false);
  });

  test("Cookie.isExpired() returns correct value", async () => {
    // Expired cookie (max-age in the past)
    const expiredCookie = new Bun.Cookie("name", "value", {
      expires: new Date(Date.now() - 1000),
    });
    expect(expiredCookie.isExpired()).toBe(true);

    // Non-expired cookie (future max-age)
    const validCookie = new Bun.Cookie("name", "value", {
      maxAge: 3600, // 1 hour
    });
    expect(validCookie.isExpired()).toBe(false);

    // Session cookie (no expiration)
    const sessionCookie = new Bun.Cookie("name", "value");
    expect(sessionCookie.isExpired()).toBe(false);
  });

  test("Cookie.isExpired() gives Max-Age precedence over Expires", () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 86_400_000);

    // Max-Age wins over Expires regardless of which one the header listed first.
    expect(new Bun.Cookie("name", "value", { maxAge: 3600, expires: past }).isExpired()).toBe(false);
    expect(new Bun.Cookie("name", "value", { maxAge: 0, expires: future }).isExpired()).toBe(true);
    expect(Bun.Cookie.parse("a=b; Max-Age=3600; Expires=Wed, 21 Oct 2015 07:28:00 GMT").isExpired()).toBe(false);
    expect(Bun.Cookie.parse("a=b; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Max-Age=3600").isExpired()).toBe(false);

    // A non-positive Max-Age is the "delete this cookie" signal.
    expect(new Bun.Cookie("name", "value", { maxAge: 0 }).isExpired()).toBe(true);
    expect(new Bun.Cookie("name", "value", { maxAge: -1 }).isExpired()).toBe(true);
  });

  test("Cookie.parse works with all attributes", () => {
    const cookieStr =
      "name=value; Domain=example.com; Expires=Thu, 13 Mar 2025 12:00:00 GMT; Path=/foo; Max-Age=3600; Secure; HttpOnly; Partitioned; SameSite=Strict";
    const cookie = Bun.Cookie.parse(cookieStr);

    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.domain).toBe("example.com");
    expect(cookie.path).toBe("/foo");
    expect(cookie.maxAge).toBe(3600);
    expect(cookie.secure).toBe(true);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.expires).toEqual(new Date("Thu, 13 Mar 2025 12:00:00 GMT"));
    expect(cookie.partitioned).toBe(true);
    expect(cookie.sameSite).toBe("strict");
  });

  test("Cookie.parse keeps Expires when Max-Age comes first", () => {
    const maxAgeFirst = Bun.Cookie.parse("a=b; Max-Age=60; Expires=Wed, 01 Jan 2031 00:00:00 GMT");
    const expiresFirst = Bun.Cookie.parse("a=b; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Max-Age=60");

    expect(maxAgeFirst.toJSON()).toEqual({
      name: "a",
      value: "b",
      path: "/",
      expires: new Date("Wed, 01 Jan 2031 00:00:00 GMT"),
      maxAge: 60,
      secure: false,
      sameSite: "lax",
      httpOnly: false,
      partitioned: false,
    });
    expect(maxAgeFirst.toJSON()).toEqual(expiresFirst.toJSON());
    expect(maxAgeFirst.toString()).toBe(expiresFirst.toString());
  });

  test("Cookie.parse takes the last value of a repeated attribute", () => {
    const cookie = Bun.Cookie.parse(
      "a=b; Max-Age=10; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Max-Age=60; Expires=Thu, 02 Jan 2031 00:00:00 GMT",
    );

    expect(cookie.maxAge).toBe(60);
    expect(cookie.expires).toEqual(new Date("Thu, 02 Jan 2031 00:00:00 GMT"));
  });

  test("Cookie.parse reads every attribute in any order", () => {
    const attributes = [
      "Max-Age=3600",
      "Expires=Thu, 13 Mar 2025 12:00:00 GMT",
      "Domain=example.com",
      "Path=/foo",
      "Secure",
      "HttpOnly",
      "Partitioned",
      "SameSite=Strict",
    ];
    const expected = Bun.Cookie.parse(`name=value; ${attributes.join("; ")}`).toJSON();
    expect(expected).toHaveProperty("expires", new Date("Thu, 13 Mar 2025 12:00:00 GMT"));

    // Rotating the attributes must never change the parsed cookie.
    for (let i = 1; i < attributes.length; i++) {
      const rotated = [...attributes.slice(i), ...attributes.slice(0, i)];
      expect(Bun.Cookie.parse(`name=value; ${rotated.join("; ")}`).toJSON()).toEqual(expected);
    }
  });

  test("Cookie.serialize creates cookie string", () => {
    const cookie1 = new Bun.Cookie("foo", "bar");
    const cookie2 = new Bun.Cookie("baz", "qux");

    expect(cookie1.serialize() + "\n" + cookie2.serialize()).toMatchInlineSnapshot(`
      "foo=bar; Path=/; SameSite=Lax
      baz=qux; Path=/; SameSite=Lax"
    `);
  });

  // Basic CookieMap tests
  test("can create an empty CookieMap", () => {
    const map = new Bun.CookieMap();
    expect(map.size).toBe(0);
    expect(map.toSetCookieHeaders()).toMatchInlineSnapshot(`[]`);
  });

  test("can create CookieMap from string", () => {
    const map = new Bun.CookieMap("name=value; foo=bar");
    expect(map.size).toBe(2);

    const cookie1 = map.get("name");
    expect(cookie1).toBeDefined();
    expect(cookie1).toBe("value");

    const cookie2 = map.get("foo");
    expect(cookie2).toBeDefined();
    expect(cookie2).toBe("bar");

    expect(map.toSetCookieHeaders()).toMatchInlineSnapshot(`[]`);
  });

  test("can create CookieMap from object", () => {
    const map = new Bun.CookieMap({
      name: "value",
      foo: "bar",
    });

    expect(map.size).toBe(2);
    expect(map.get("name")).toBe("value");
    expect(map.get("foo")).toBe("bar");
    expect(map.toSetCookieHeaders()).toMatchInlineSnapshot(`[]`);
  });

  test("can create CookieMap from Proxy-wrapped object", () => {
    const target = { a: "1", b: "2" };

    // Transparent proxy should behave exactly like the target.
    const transparent = new Bun.CookieMap(new Proxy(target, {}));
    expect([...transparent.entries()]).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);

    // The record branch must go through [[OwnPropertyKeys]], so the ownKeys
    // trap fires and a throwing trap propagates.
    let ownKeysCalls = 0;
    const observed = new Bun.CookieMap(
      new Proxy(target, {
        ownKeys(t) {
          ownKeysCalls++;
          return Reflect.ownKeys(t);
        },
      }),
    );
    expect(ownKeysCalls).toBe(1);
    expect([...observed.entries()]).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);

    expect(() => {
      new Bun.CookieMap(
        new Proxy(target, {
          ownKeys() {
            throw new Error("ownKeys trap");
          },
        }),
      );
    }).toThrow("ownKeys trap");
  });

  test("CookieMap from object skips non-enumerable own keys", () => {
    const obj = { a: "1" };
    Object.defineProperty(obj, "hidden", { value: "x", enumerable: false });
    expect([...new Bun.CookieMap(obj).entries()]).toEqual([["a", "1"]]);

    // A transparent Proxy over [] only exposes the non-enumerable "length".
    expect(new Bun.CookieMap(new Proxy([], {})).size).toBe(0);
  });

  test("can create CookieMap from array pairs", () => {
    const map = new Bun.CookieMap([
      ["name", "value"],
      ["foo", "bar"],
    ]);

    expect(map.size).toBe(2);
    expect(map.get("name")).toBe("value");
    expect(map.get("foo")).toBe("bar");
    expect(map.toSetCookieHeaders()).toMatchInlineSnapshot(`[]`);
  });

  test("CookieMap methods work", () => {
    const map = new Bun.CookieMap();

    // Set a cookie with name/value
    map.set("name", "value");
    expect(map.size).toBe(1);
    expect(map.has("name")).toBe(true);

    // Set with cookie object
    map.set(
      new Bun.Cookie("foo", "bar", {
        secure: true,
        httpOnly: true,
        partitioned: true,
      }),
    );
    expect(map.size).toBe(2);
    expect(map.has("foo")).toBe(true);
    expect(map.toSetCookieHeaders()).toMatchInlineSnapshot(`
      [
        "name=value; Path=/; SameSite=Lax",
        "foo=bar; Path=/; Secure; HttpOnly; Partitioned; SameSite=Lax",
      ]
    `);

    // Delete a cookie
    map.delete("name");
    expect(map.size).toBe(1);
    expect(map.has("name")).toBe(false);
    expect(map.get("name")).toBe(null);

    // Get changes
    expect(map.toSetCookieHeaders()).toMatchInlineSnapshot(`
      [
        "foo=bar; Path=/; Secure; HttpOnly; Partitioned; SameSite=Lax",
        "name=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax",
      ]
    `);
  });

  test("CookieMap supports iteration", () => {
    const map = new Bun.CookieMap("a=1; b=2; c=3");

    // Test keys()
    const keys = Array.from(map.keys());
    expect(keys).toEqual(["a", "b", "c"]);

    // Test entries()
    let count = 0;
    for (const [key, value] of map.entries()) {
      count++;
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("string");
      expect(["1", "2", "3"]).toContain(value);
    }
    expect(count).toBe(3);

    // Test forEach
    const collected: string[] = [];
    map.forEach((value, key) => {
      collected.push(`${key}=${value}`);
    });
    expect(collected.sort()).toEqual(["a=1", "b=2", "c=3"]);
  });

  test("CookieMap.toJSON() formats properly", () => {
    const map = new Bun.CookieMap("a=1; b=2");
    expect(map.toJSON()).toMatchInlineSnapshot(`
      {
        "a": "1",
        "b": "2",
      }
    `);
  });

  test("CookieMap.toJSON() handles numeric cookie names", () => {
    const map = new Bun.CookieMap("0=first; 1=second; 42=answer");
    expect(map.toJSON()).toEqual({
      "0": "first",
      "1": "second",
      "42": "answer",
    });
  });

  test("CookieMap.toJSON() handles cookie names matching Object.prototype properties", () => {
    const map = new Bun.CookieMap("toString=hello; constructor=world; valueOf=test");
    expect(map.toJSON()).toEqual({
      "toString": "hello",
      "constructor": "world",
      "valueOf": "test",
    });
  });

  test("CookieMap works with cookies with advanced attributes", () => {
    const map = new Bun.CookieMap();

    // Add a cookie with httpOnly and partitioned flags
    map.set("session", "abc123", {
      httpOnly: true,
      secure: true,
      partitioned: true,
      maxAge: 3600,
    });

    expect(map.get("session")).toBe("abc123");
    expect(map.toSetCookieHeaders()).toMatchInlineSnapshot(`
      [
        "session=abc123; Path=/; Max-Age=3600; Secure; HttpOnly; Partitioned; SameSite=Lax",
      ]
    `);
  });
});

describe("Cookie name field is immutable", () => {
  test("can create a Cookie", () => {
    const cookie = new Bun.Cookie("name", "value");
    expect(cookie.name).toBe("name");
    // @ts-expect-error
    cookie.name = "foo";
    expect(cookie.name).toBe("name");
  });
  test("mutate cookie in map", () => {
    const cookieMap = new Bun.CookieMap();
    const cookie = new Bun.Cookie("name", "value");
    cookieMap.set(cookie);
    expect(cookieMap.get("name")).toBe("value");
    cookie.value = "value2";
    expect(cookieMap.get("name")).toBe("value2");
    expect(cookieMap.toSetCookieHeaders()).toMatchInlineSnapshot(`
      [
        "name=value2; Path=/; SameSite=Lax",
      ]
    `);
  });
});

describe("iterator", () => {
  test("delete in a loop", () => {
    const map = new Bun.CookieMap();
    for (let i = 0; i < 1000; i++) {
      map.set(`name${i}`, `value${i}`);
    }
    for (const key of map.keys()) {
      map.delete(key);
    }
    // expect(map.size).toBe(0);
    expect(map.size).toBe(500); // FormData works this way, but not Set. maybe we should work like Set.
  });
  test("delete in a loop with predefined entries", () => {
    const entries: [string, string][] = [];
    for (let i = 0; i < 1000; i++) {
      entries.push([`name${i}`, `value${i}`]);
    }
    const map = new Bun.CookieMap(entries);
    for (const key of map.keys()) {
      map.delete(key);
    }
    expect(map.size).toBe(0);
  });
  test("delete in a loop with both", () => {
    const entries: [string, string][] = [];
    for (let i = 0; i < 500; i++) {
      entries.push([`pre${i}`, `pre${i}`]);
    }
    const map = new Bun.CookieMap(entries);
    for (let i = 0; i < 1000; i++) {
      map.set(`post${i}`, `post${i}`);
    }
    for (const key of map.keys()) {
      map.delete(key);
    }
    // expect(map.size).toBe(0);
    expect(map.size).toBe(500); // FormData works this way, but not Set. maybe we should work like Set.
  });
  test("basic iterator", () => {
    const cookies = new Bun.CookieMap({ a: "b", c: "d" });
    cookies.set("e", "f");
    cookies.set("g", "h");
    expect([...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("\n")).toMatchInlineSnapshot(`
    "e=f
    g=h
    a=b
    c=d"
  `);
  });
});

describe("cookie header values with non-ASCII characters", () => {
  test("preserves a non-ASCII cookie value when another value in the header is percent-encoded", () => {
    const map = new Bun.CookieMap("a=%20; b=café");
    expect(map.get("b")).toBe("café");
    expect(map.get("a")).toBe(" ");
  });

  test("decodes a percent-encoded cookie value that also contains non-ASCII characters", () => {
    const map = new Bun.CookieMap("b=café%20au%20lait");
    expect(map.get("b")).toBe("café au lait");
  });
});

describe("delete with prefixed cookie names", () => {
  test("deleting a cookie whose name starts with __Host- emits a Secure expiring cookie", () => {
    const map = new Bun.CookieMap("__Host-id=1");
    map.delete("__Host-id");
    expect(map.toSetCookieHeaders()).toEqual([
      "__Host-id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=Lax",
    ]);
  });

  test("deleting a cookie whose name starts with __Secure- emits a Secure expiring cookie", () => {
    const map = new Bun.CookieMap("__Secure-id=1");
    map.delete("__Secure-id");
    expect(map.toSetCookieHeaders()).toEqual([
      "__Secure-id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=Lax",
    ]);
  });

  test("deleting a cookie without a name prefix emits an expiring cookie without Secure", () => {
    const map = new Bun.CookieMap("__Host-id=1; id=1");
    map.delete("__Host-id");
    map.delete("id");
    expect(map.toSetCookieHeaders()).toEqual([
      "__Host-id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=Lax",
      "id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax",
    ]);
  });
});

describe("invalid delete usage", () => {
  test("invalid usage does not crash", () => {
    expect(() => {
      const v1 = Bun.CookieMap;
      // @ts-ignore
      const v2 = new v1(v1, v1, Bun, v1);
      // @ts-ignore
      v2.delete(v2);
    }).toThrow("Cookie name is required");
  });
});
