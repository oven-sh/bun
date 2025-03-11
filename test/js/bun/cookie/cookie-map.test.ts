import { test, expect, describe } from "bun:test";

describe("Bun.Cookie and Bun.CookieMap", () => {
  // Basic Cookie tests
  test("can create a basic Cookie", () => {
    const cookie = new Bun.Cookie("name", "value");
    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.path).toBe("/");
    expect(cookie.domain).toBe(null);
    expect(cookie.secure).toBe(false);
    expect(cookie.sameSite).toBe("strict");
  });

  test("can create a Cookie with options", () => {
    const cookie = new Bun.Cookie("name", "value", {
      domain: "example.com",
      path: "/foo",
      secure: true,
      sameSite: "lax"
    });

    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.domain).toBe("example.com");
    expect(cookie.path).toBe("/foo");
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe("lax");
  });

  test("Cookie.toString() formats properly", () => {
    const cookie = new Bun.Cookie("name", "value", {
      domain: "example.com",
      path: "/foo",
      secure: true,
      sameSite: "lax"
    });

    const str = cookie.toString();
    expect(str).toInclude("name=value");
    expect(str).toInclude("Domain=example.com");
    expect(str).toInclude("Path=/foo");
    expect(str).toInclude("Secure");
    expect(str).toInclude("SameSite=Lax");
  });

  // Basic CookieMap tests
  test("can create an empty CookieMap", () => {
    const map = new Bun.CookieMap();
    expect(map.size).toBe(0);
    expect(map.toString()).toBe("");
  });

  test("can create CookieMap from string", () => {
    const map = new Bun.CookieMap("name=value; foo=bar");
    expect(map.size).toBe(2);
    
    const cookie1 = map.get("name");
    expect(cookie1).toBeDefined();
    expect(cookie1?.name).toBe("name");
    expect(cookie1?.value).toBe("value");
    
    const cookie2 = map.get("foo");
    expect(cookie2).toBeDefined();
    expect(cookie2?.name).toBe("foo");
    expect(cookie2?.value).toBe("bar");
  });

  test("can create CookieMap from object", () => {
    const map = new Bun.CookieMap({
      name: "value",
      foo: "bar"
    });
    
    expect(map.size).toBe(2);
    expect(map.get("name")?.value).toBe("value");
    expect(map.get("foo")?.value).toBe("bar");
  });

  test("can create CookieMap from array pairs", () => {
    const map = new Bun.CookieMap([
      ["name", "value"],
      ["foo", "bar"]
    ]);
    
    expect(map.size).toBe(2);
    expect(map.get("name")?.value).toBe("value");
    expect(map.get("foo")?.value).toBe("bar");
  });

  test("CookieMap methods work", () => {
    const map = new Bun.CookieMap();
    
    // Set a cookie with name/value
    map.set("name", "value");
    expect(map.size).toBe(1);
    expect(map.has("name")).toBe(true);
    
    // Set with cookie object
    map.set(new Bun.Cookie("foo", "bar", { secure: true }));
    expect(map.size).toBe(2);
    expect(map.has("foo")).toBe(true);
    expect(map.get("foo")?.secure).toBe(true);
    
    // Delete a cookie
    map.delete("name");
    expect(map.size).toBe(1);
    expect(map.has("name")).toBe(false);
    
    // Get all (only one remains)
    const all = map.getAll("foo");
    expect(all.length).toBe(1);
    expect(all[0].value).toBe("bar");
  });

  test("CookieMap supports iteration", () => {
    const map = new Bun.CookieMap("a=1; b=2; c=3");
    
    // Test keys()
    const keys = Array.from(map.keys());
    expect(keys).toEqual(["a", "b", "c"]);
    
    // Test entries()
    let count = 0;
    for (const [key, cookie] of map.entries()) {
      count++;
      expect(typeof key).toBe("string");
      expect(typeof cookie).toBe("object");
      expect(cookie instanceof Bun.Cookie).toBe(true);
      expect(["1", "2", "3"]).toContain(cookie.value);
    }
    expect(count).toBe(3);
    
    // Test forEach
    const collected: string[] = [];
    map.forEach((cookie, key) => {
      collected.push(`${key}=${cookie.value}`);
    });
    expect(collected.sort()).toEqual(["a=1", "b=2", "c=3"]);
  });

  test("CookieMap.toString() formats properly", () => {
    const map = new Bun.CookieMap("a=1; b=2");
    const str = map.toString();
    expect(str).toInclude("a=1");
    expect(str).toInclude("b=2");
  });
});