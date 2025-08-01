import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

describe("request cookies", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      routes: {
        "/before-headers": req => {
          // Access cookies before accessing headers
          const cookies = req.cookies;
          expect(cookies).toBeDefined();
          expect(cookies.size).toBe(2);
          expect(cookies.get("name")).toBe("value");
          expect(cookies.get("foo")).toBe("bar");

          // Verify headers are still accessible afterward
          expect(req.headers.get("cookie")).toBe("name=value; foo=bar");

          return new Response("ok");
        },
        "/after-headers": req => {
          // Access headers first
          const cookieHeader = req.headers.get("cookie");
          expect(cookieHeader).toBe("name=value; foo=bar");

          // Then access cookies
          const cookies = req.cookies;
          expect(cookies).toBeDefined();
          expect(cookies.size).toBe(2);
          expect(cookies.get("name")).toBe("value");
          expect(cookies.get("foo")).toBe("bar");

          return new Response("ok");
        },
        "/no-cookies": req => {
          // Test with no cookies in request
          const cookies = req.cookies;
          expect(cookies).toBeDefined();
          expect(cookies.size).toBe(0);

          return new Response("ok");
        },
        "/cookies-readonly": req => {
          // Verify cookies property is readonly
          try {
            // @ts-expect-error - This should fail at runtime
            req.cookies = {};
            return new Response("not ok - should have thrown");
          } catch (e) {
            return new Response("ok - readonly");
          }
        },
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  it("parses cookies before headers are accessed", async () => {
    const res = await fetch(`${server.url}before-headers`, {
      headers: {
        "Cookie": "name=value; foo=bar",
      },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("parses cookies after headers are accessed", async () => {
    const res = await fetch(`${server.url}after-headers`, {
      headers: {
        "Cookie": "name=value; foo=bar",
      },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("handles requests with no cookies", async () => {
    const res = await fetch(`${server.url}no-cookies`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("has readonly cookies property", async () => {
    const res = await fetch(`${server.url}cookies-readonly`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok - readonly");
  });
});

describe("instanceof and type checks", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      routes: {
        "/instanceof-checks": req => {
          // Check that cookies is an instance of Bun.CookieMap
          expect(req.cookies instanceof Bun.CookieMap).toBe(true);

          const cookie = req.cookies.get("name");
          expect(cookie).toBeTypeOf("string");

          return new Response("ok");
        },
        "/constructor-identities": req => {
          // Verify that the constructors match
          expect(req.cookies.constructor).toBe(Bun.CookieMap);

          const cookie = req.cookies.get("name");
          expect(cookie).toBeTypeOf("string");

          return new Response("ok");
        },
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  it("cookies is instance of Bun.CookieMap and has right prototype", async () => {
    const res = await fetch(`${server.url}instanceof-checks`, {
      headers: {
        "Cookie": "name=value",
      },
    });
    expect(res.status).toBe(200);
  });

  it("constructors match expected types", async () => {
    const res = await fetch(`${server.url}constructor-identities`, {
      headers: {
        "Cookie": "name=value",
      },
    });
    expect(res.status).toBe(200);
  });
});

describe("complex cookie parsing", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      routes: {
        "/special-chars": req => {
          const cookie = req.cookies.get("complex");
          if (cookie == null) {
            return new Response("no cookie found", { status: 500 });
          }

          expect(cookie).toBe("value with spaces");
          return new Response("ok");
        },
        "/equals-in-value": req => {
          const cookie = req.cookies.get("equation");
          if (cookie == null) {
            return new Response("no cookie found", { status: 500 });
          }

          expect(cookie).toBe("x=y+z");
          return new Response("ok");
        },
        "/multiple-cookies": req => {
          // Cookie with same name multiple times should be parsed correctly
          const cookies = req.cookies;
          expect(cookies.size).toBeGreaterThanOrEqual(2);

          // Get first occurrence of duplicate cookie
          const duplicateCookie = cookies.get("duplicate");
          expect(duplicateCookie).toBeDefined();

          // In most implementations, the first value should be preserved
          expect(duplicateCookie).toBe("first");

          return new Response("ok");
        },
        "/cookie-map-methods": req => {
          const cookies = req.cookies;

          // Test has() method
          expect(cookies.has("name")).toBe(true);
          expect(cookies.has("nonexistent")).toBe(false);

          // Test size
          expect(cookies.size).toBe(2);

          return new Response("ok");
        },
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  it("handles cookie values with spaces", async () => {
    const res = await fetch(`${server.url}special-chars`, {
      headers: {
        "Cookie": "complex=value with spaces",
      },
    });
    expect(res.status).toBe(200);
  });

  it("handles cookie values with equals signs", async () => {
    const res = await fetch(`${server.url}equals-in-value`, {
      headers: {
        "Cookie": "equation=x=y+z",
      },
    });
    expect(res.status).toBe(200);
  });

  it("handles duplicate cookie names", async () => {
    const res = await fetch(`${server.url}multiple-cookies`, {
      headers: {
        "Cookie": "duplicate=first; duplicate=second; other=value",
      },
    });
    expect(res.status).toBe(200);
  });

  it("CookieMap methods work correctly", async () => {
    const res = await fetch(`${server.url}cookie-map-methods`, {
      headers: {
        "Cookie": "name=value; foo=bar",
      },
    });
    expect(res.status).toBe(200);
  });
});

describe("CookieMap iterator", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      routes: {
        "/iterator-entries": req => {
          const cookies = req.cookies;

          // Test entries() iterator
          const entries = Array.from(cookies.entries());
          expect(entries.length).toBe(3);

          // Entries should be [name, Cookie] pairs
          expect(entries[0][0]).toBeTypeOf("string");
          expect(entries[0][1]).toBeTypeOf("string");

          // Check that we can get cookies values
          const cookieNames = entries.map(([name, _]) => name);
          expect(cookieNames).toContain("a");
          expect(cookieNames).toContain("b");
          expect(cookieNames).toContain("c");

          const cookieValues = entries.map(([_, value]) => value);
          expect(cookieValues).toContain("1");
          expect(cookieValues).toContain("2");
          expect(cookieValues).toContain("3");

          return new Response("ok");
        },
        "/iterator-for-of": req => {
          const cookies = req.cookies;

          // Test for...of iteration (should iterate over entries)
          const collected: { name: string; value: string }[] = [];
          for (const entry of cookies) {
            // Check that we get [name, cookie] entries
            expect(entry.length).toBe(2);
            expect(entry[0]).toBeTypeOf("string");
            expect(entry[1]).toBeTypeOf("string");

            const [name, value] = entry;
            collected.push({ name, value });
          }

          expect(collected.length).toBe(3);
          expect(collected.some(c => c.name === "a" && c.value === "1")).toBe(true);
          expect(collected.some(c => c.name === "b" && c.value === "2")).toBe(true);
          expect(collected.some(c => c.name === "c" && c.value === "3")).toBe(true);

          return new Response("ok");
        },
        "/iterator-keys-values": req => {
          const cookies = req.cookies;

          // Test keys() iterator
          const keys = Array.from(cookies.keys());
          expect(keys.length).toBe(3);
          expect(keys).toContain("a");
          expect(keys).toContain("b");
          expect(keys).toContain("c");

          // Test values() iterator - returns Cookie objects
          const values = Array.from(cookies.values());
          expect(values.length).toBe(3);

          // Values should be Cookie objects
          for (const value of values) {
            expect(value).toBeTypeOf("string");
          }

          // Values should include the expected cookies
          const cookieValues = values;
          expect(cookieValues).toContain("1");
          expect(cookieValues).toContain("2");
          expect(cookieValues).toContain("3");

          return new Response("ok");
        },
        "/iterator-forEach": req => {
          const cookies = req.cookies;

          // Test forEach method
          const collected: { key: string; value: string }[] = [];
          cookies.forEach((value, key) => {
            expect(value).toBeTypeOf("string");
            expect(key).toBeTypeOf("string");
            collected.push({ key, value });
          });

          expect(collected.length).toBe(3);
          expect(collected.some(c => c.key === "a" && c.value === "1")).toBe(true);
          expect(collected.some(c => c.key === "b" && c.value === "2")).toBe(true);
          expect(collected.some(c => c.key === "c" && c.value === "3")).toBe(true);

          return new Response("ok");
        },
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  it("implements entries() iterator", async () => {
    const res = await fetch(`${server.url}iterator-entries`, {
      headers: {
        "Cookie": "a=1; b=2; c=3",
      },
    });
    expect(res.status).toBe(200);
  });

  it("implements for...of iteration", async () => {
    const res = await fetch(`${server.url}iterator-for-of`, {
      headers: {
        "Cookie": "a=1; b=2; c=3",
      },
    });
    expect(res.status).toBe(200);
  });

  it("implements keys() and values() iterators", async () => {
    const res = await fetch(`${server.url}iterator-keys-values`, {
      headers: {
        "Cookie": "a=1; b=2; c=3",
      },
    });
    expect(res.status).toBe(200);
  });

  it("implements forEach method", async () => {
    const res = await fetch(`${server.url}iterator-forEach`, {
      headers: {
        "Cookie": "a=1; b=2; c=3",
      },
    });
    expect(res.status).toBe(200);
  });
});

describe("Direct usage of Bun.Cookie and Bun.CookieMap", () => {
  it("can create a Cookie directly", () => {
    const cookie = new Bun.Cookie("name", "value");

    expect(cookie.constructor).toBe(Bun.Cookie);
    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.path).toBe("/");
    // Domain may be null in the implementation
    expect(cookie.domain == null || cookie.domain === "").toBe(true);
    expect(cookie.secure).toBe(false);
    expect(cookie.sameSite).toBe("lax");
  });

  it("can create a Cookie with options", () => {
    const cookie = new Bun.Cookie("name", "value", {
      path: "/path",
      domain: "example.com",
      secure: true,
      sameSite: "lax",
    });

    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.path).toBe("/path");
    expect(cookie.domain).toBe("example.com");
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe("lax");
  });

  it("can create a CookieMap directly", () => {
    const cookieMap = new Bun.CookieMap();

    expect(cookieMap.constructor).toBe(Bun.CookieMap);
    expect(cookieMap.size).toBe(0);
  });

  it("can create a CookieMap with a cookie string", () => {
    const cookieMap = new Bun.CookieMap("name=value; foo=bar");

    expect(cookieMap.size).toBe(2);

    const nameCookie = cookieMap.get("name");
    expect(nameCookie).toMatchInlineSnapshot(`"value"`);

    const fooCookie = cookieMap.get("foo");
    expect(fooCookie).toMatchInlineSnapshot(`"bar"`);

    expect(cookieMap.toSetCookieHeaders()).toMatchInlineSnapshot(`[]`);
  });

  it("can create a CookieMap with an object", () => {
    const cookieMap = new Bun.CookieMap({
      name: "value",
      foo: "bar",
    });

    expect(cookieMap.size).toBe(2);

    const nameCookie = cookieMap.get("name");
    expect(nameCookie).toMatchInlineSnapshot(`"value"`);

    const fooCookie = cookieMap.get("foo");
    expect(fooCookie).toMatchInlineSnapshot(`"bar"`);
  });

  it("can create a CookieMap with an array of pairs", () => {
    const cookieMap = new Bun.CookieMap([
      ["name", "value"],
      ["foo", "bar"],
    ]);

    expect(cookieMap.size).toBe(2);

    const nameCookie = cookieMap.get("name");
    expect(nameCookie).toMatchInlineSnapshot(`"value"`);

    const fooCookie = cookieMap.get("foo");
    expect(fooCookie).toMatchInlineSnapshot(`"bar"`);
  });

  it("can set and get cookies in a CookieMap", () => {
    const cookieMap = new Bun.CookieMap();

    // Set with name/value
    cookieMap.set("name", "value");

    // Set with options
    cookieMap.set({
      name: "foo",
      value: "bar",
      secure: true,
      path: "/path",
    });

    expect(cookieMap.size).toBe(2);

    const nameCookie = cookieMap.get("name");
    console.log(nameCookie);
    expect(nameCookie).toMatchInlineSnapshot(`"value"`);

    const fooCookie = cookieMap.get("foo");
    expect(fooCookie).toMatchInlineSnapshot(`"bar"`);
    expect(cookieMap.toSetCookieHeaders()).toMatchInlineSnapshot(`
      [
        "name=value; Path=/; SameSite=Lax",
        "foo=bar; Path=/path; Secure; SameSite=Lax",
      ]
    `);
  });

  it("can use Cookie.parse to parse cookie strings", () => {
    const cookie = Bun.Cookie.parse("name=value; Path=/; Secure; SameSite=Lax");

    expect(cookie.constructor).toBe(Bun.Cookie);
    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.path).toBe("/");
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite.toLowerCase()).toBe("lax");
  });

  it("can use Cookie.from to create cookies", () => {
    const cookie = Bun.Cookie.from("name", "value", {
      path: "/path",
      domain: "example.com",
      secure: true,
      sameSite: "none",
    });

    expect(cookie.constructor).toBe(Bun.Cookie);
    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.path).toBe("/path");
    expect(cookie.domain).toBe("example.com");
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite.toLowerCase()).toBe("none");
  });

  it("can convert cookies to string", () => {
    const cookie = new Bun.Cookie("name", "value", {
      path: "/path",
      domain: "example.com",
      secure: true,
      sameSite: "lax",
    });

    const cookieStr = cookie.toString();
    expect(cookieStr).toMatchInlineSnapshot(`"name=value; Domain=example.com; Path=/path; Secure; SameSite=Lax"`);
  });

  it("correctly handles toJSON methods", () => {
    // Create a Cookie and test toJSON
    const cookie = new Bun.Cookie("name", "value", {
      path: "/test",
      domain: "example.org",
      secure: true,
      sameSite: "lax",
      expires: new Date("2025-03-21T12:00:00Z"),
    });

    const cookieJSON = cookie.toJSON();
    expect(cookieJSON).toBeTypeOf("object");
    expect(cookieJSON.name).toBe("name");
    expect(cookieJSON.value).toBe("value");
    expect(cookieJSON.path).toBe("/test");
    expect(cookieJSON.domain).toBe("example.org");
    expect(cookieJSON.secure).toBe(true);
    expect(cookieJSON).toMatchInlineSnapshot(`
      {
        "domain": "example.org",
        "expires": 2025-03-21T12:00:00.000Z,
        "httpOnly": false,
        "name": "name",
        "partitioned": false,
        "path": "/test",
        "sameSite": "lax",
        "secure": true,
        "value": "value",
      }
    `);

    // Create a CookieMap and test toJSON
    const cookieMap = new Bun.CookieMap("a=1; b=2; c=3");

    const mapJSON = cookieMap.toJSON();
    expect(mapJSON).toBeInstanceOf(Object);
    expect([...Object.keys(mapJSON)].length).toBe(3);

    for (const entry of Object.entries(mapJSON)) {
      expect(entry.length).toBe(2);
      expect(entry[0]).toBeTypeOf("string");
      expect(entry[1]).toBeTypeOf("string");
    }

    // Verify JSON.stringify works as expected
    const jsonString = JSON.stringify(cookie);
    expect(jsonString).toBeTypeOf("string");
    const parsed = JSON.parse(jsonString);
    expect(parsed.name).toBe("name");
    expect(parsed.value).toBe("value");
  });
});
