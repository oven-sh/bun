import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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
        "name=; Path=/; Expires=Fri, 1 Jan 1970 00:00:00 -0000; SameSite=Lax",
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

describe("CookieMap percent-decoding with non-ASCII values", () => {
  test("percent-decoding one value does not affect a sibling non-ASCII value", () => {
    // Each value is decoded independently: the presence of a '%' in one
    // cookie's value must not change how another cookie's value is parsed.
    const map = new Bun.CookieMap("a=é; z=%41");
    expect([...map]).toEqual([
      ["a", "é"],
      ["z", "A"],
    ]);
  });

  test("reversing the order does not change results", () => {
    const map = new Bun.CookieMap("z=%41; a=é");
    expect([...map]).toEqual([
      ["z", "A"],
      ["a", "é"],
    ]);
  });

  test("non-ASCII value with no percent escapes is preserved exactly", () => {
    const map = new Bun.CookieMap("name=读写汉字学中文; plain=hello");
    expect(map.get("name")).toBe("读写汉字学中文");
    expect(map.get("plain")).toBe("hello");
  });

  test("non-ASCII value alongside a percent-encoded sibling is preserved exactly", () => {
    const map = new Bun.CookieMap("name=读写汉字学中文; token=abc%3Ddef");
    expect([...map]).toEqual([
      ["name", "读写汉字学中文"],
      ["token", "abc=def"],
    ]);
  });

  test("a single value containing both non-ASCII characters and percent escapes decodes correctly", () => {
    const map = new Bun.CookieMap("greeting=café%20au%20lait");
    expect(map.get("greeting")).toBe("café au lait");
  });

  test("astral-plane characters are preserved when another cookie has percent escapes", () => {
    const map = new Bun.CookieMap("emoji=🍪; other=%20");
    expect([...map]).toEqual([
      ["emoji", "🍪"],
      ["other", " "],
    ]);
  });

  test("a single value containing both astral-plane characters and percent escapes decodes correctly", () => {
    const map = new Bun.CookieMap("mix=🍪%20cookie");
    expect(map.get("mix")).toBe("🍪 cookie");
  });

  test("percent-encoded UTF-8 still decodes via the fast path when the value is ASCII", () => {
    const map = new Bun.CookieMap("k=%C3%A9");
    expect(map.get("k")).toBe("é");
  });

  test("parsing a Cookie header with non-ASCII and percent escapes does not crash", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const m = new Bun.CookieMap("a=é; z=%41");` +
          `process.stdout.write(JSON.stringify([m.get("a"), m.get("z")]));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe('["é","A"]');
    expect(exitCode).toBe(0);
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
