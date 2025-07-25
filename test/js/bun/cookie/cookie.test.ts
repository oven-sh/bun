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
        "test=; Path=/; Expires=Fri, 1 Jan 1970 00:00:00 -0000; SameSite=Lax",
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
        "do_delete=; Path=/; Expires=Fri, 1 Jan 1970 00:00:00 -0000; SameSite=Lax",
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
      "a=; Path=/b; Expires=Fri, 1 Jan 1970 00:00:00 -0000; SameSite=Lax",
      "b=; Expires=Fri, 1 Jan 1970 00:00:00 -0000; SameSite=Lax",
      "c=; Path=/; Expires=Fri, 1 Jan 1970 00:00:00 -0000; SameSite=Lax",
      "d=; Path=/; Expires=Fri, 1 Jan 1970 00:00:00 -0000; SameSite=Lax",
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
