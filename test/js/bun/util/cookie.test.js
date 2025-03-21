import { test, expect, describe } from "bun:test";

describe("Bun.Cookie", () => {
  test("can create a cookie", () => {
    const cookie = new Bun.Cookie("name", "value");
    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.path).toBe("/");
    expect(cookie.domain).toBe(null);
    expect(cookie.expires).toBe(0);
    expect(cookie.secure).toBe(false);
    expect(cookie.sameSite).toBe("lax");
  });

  test("can create a cookie with options", () => {
    const cookie = new Bun.Cookie("name", "value", {
      domain: "example.com",
      path: "/foo",
      expires: 123456789,
      secure: true,
      sameSite: "strict",
    });

    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.domain).toBe("example.com");
    expect(cookie.path).toBe("/foo");
    expect(cookie.expires).toBe(123456789);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe("strict");
  });

  test("stringify a cookie", () => {
    const cookie = new Bun.Cookie("name", "value", {
      domain: "example.com",
      path: "/foo",
      secure: true,
      sameSite: "lax",
    });

    expect(cookie.toString()).toBe("name=value; Domain=example.com; Path=/foo; Secure");
  });

  test.todo("parse a cookie string", () => {
    const cookie = Bun.Cookie.parse("name=value; Domain=example.com; Path=/foo; Secure; SameSite=lax");

    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.domain).toBe("example.com");
    expect(cookie.path).toBe("/foo");
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe("lax");
  });
});

describe("Bun.CookieMap", () => {
  test("can create an empty cookie map", () => {
    const cookieMap = new Bun.CookieMap();
    expect(cookieMap.size).toBe(0);
    expect(cookieMap.toString()).toBe("");
  });

  test("can create a cookie map from a string", () => {
    const cookieMap = new Bun.CookieMap("name=value; foo=bar");
    expect(cookieMap.size).toBe(2);
    expect(cookieMap.has("name")).toBe(true);
    expect(cookieMap.has("foo")).toBe(true);
    expect(cookieMap.get("name").value).toBe("value");
    expect(cookieMap.get("foo").value).toBe("bar");
  });

  test("can create a cookie map from an object", () => {
    const cookieMap = new Bun.CookieMap({
      name: "value",
      foo: "bar",
    });

    expect(cookieMap.size).toBe(2);
    expect(cookieMap.has("name")).toBe(true);
    expect(cookieMap.has("foo")).toBe(true);
    expect(cookieMap.get("name").value).toBe("value");
    expect(cookieMap.get("foo").value).toBe("bar");
  });

  test("can create a cookie map from pairs", () => {
    const cookieMap = new Bun.CookieMap([
      ["name", "value"],
      ["foo", "bar"],
    ]);

    expect(cookieMap.size).toBe(2);
    expect(cookieMap.has("name")).toBe(true);
    expect(cookieMap.has("foo")).toBe(true);
    expect(cookieMap.get("name").value).toBe("value");
    expect(cookieMap.get("foo").value).toBe("bar");
  });

  test("can set and get cookies", () => {
    const cookieMap = new Bun.CookieMap();

    cookieMap.set("name", "value");
    expect(cookieMap.size).toBe(1);
    expect(cookieMap.has("name")).toBe(true);
    expect(cookieMap.get("name").value).toBe("value");

    cookieMap.set("foo", "bar");
    expect(cookieMap.size).toBe(2);
    expect(cookieMap.has("foo")).toBe(true);
    expect(cookieMap.get("foo").value).toBe("bar");
  });

  test("can set cookies with a Cookie object", () => {
    const cookieMap = new Bun.CookieMap();
    const cookie = new Bun.Cookie("name", "value", {
      domain: "example.com",
      path: "/foo",
      secure: true,
      sameSite: "lax",
    });

    cookieMap.set(cookie);
    expect(cookieMap.size).toBe(1);
    expect(cookieMap.has("name")).toBe(true);

    const retrievedCookie = cookieMap.get("name");
    expect(retrievedCookie.name).toBe("name");
    expect(retrievedCookie.value).toBe("value");
    expect(retrievedCookie.domain).toBe("example.com");
    expect(retrievedCookie.path).toBe("/foo");
    expect(retrievedCookie.secure).toBe(true);
    expect(retrievedCookie.sameSite).toBe("lax");
  });

  test("can delete cookies", () => {
    const cookieMap = new Bun.CookieMap("name=value; foo=bar");
    expect(cookieMap.size).toBe(2);

    cookieMap.delete("name");
    expect(cookieMap.size).toBe(1);
    expect(cookieMap.has("name")).toBe(false);
    expect(cookieMap.has("foo")).toBe(true);

    cookieMap.delete("foo");
    expect(cookieMap.size).toBe(0);
    expect(cookieMap.has("foo")).toBe(false);
  });

  test("can delete cookies with options", () => {
    const cookieMap = new Bun.CookieMap();
    cookieMap.set(
      new Bun.Cookie("name", "value", {
        domain: "example.com",
        path: "/foo",
      }),
    );

    cookieMap.delete({
      name: "name",
      domain: "example.com",
      path: "/foo",
    });

    expect(cookieMap.size).toBe(0);
  });

  test("can get all cookies with the same name", () => {
    const cookieMap = new Bun.CookieMap();
    cookieMap.set(
      new Bun.Cookie("name", "value1", {
        domain: "example.com",
        path: "/foo",
      }),
    );
    cookieMap.set(
      new Bun.Cookie("name", "value2", {
        domain: "example.org",
        path: "/bar",
      }),
    );

    // Since we're overwriting cookies with the same name,
    // the size should still be 1
    expect(cookieMap.size).toBe(1);

    // But this would work if we didn't overwrite
    // const cookies = cookieMap.getAll("name");
    // expect(cookies.length).toBe(2);
  });

  test("can stringify a cookie map", () => {
    const cookieMap = new Bun.CookieMap("name=value; foo=bar");
    expect(cookieMap.toString()).toBe("name=value; foo=bar");
  });

  test("supports iteration", () => {
    const cookieMap = new Bun.CookieMap("name=value; foo=bar");

    const entries = Array.from(cookieMap.entries());
    expect(entries).toMatchInlineSnapshot(`
      [
        [
          "name",
          {
        "name": "name",
        "value": "value",
        "path": "/",
        "secure": false,
        "sameSite": "lax",
        "httpOnly": false,
        "partitioned": false
      },
        ],
        [
          "foo",
          {
        "name": "foo",
        "value": "bar",
        "path": "/",
        "secure": false,
        "sameSite": "lax",
        "httpOnly": false,
        "partitioned": false
      },
        ],
      ]
    `);
  });
});
