import { describe, expect, it, test } from "bun:test";

describe("Bun.Cookie", () => {
  test("can create a cookie", () => {
    const cookie = new Bun.Cookie("name", "value");
    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.path).toBe("/");
    expect(cookie.domain).toBe(null);
    expect(cookie.expires).toBe(undefined);
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
    expect(cookie.expires).toEqual(new Date(123456789000));
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

    expect(cookie.toString()).toBe("name=value; Domain=example.com; Path=/foo; Secure; SameSite=Lax");
  });

  test("parse a cookie string", () => {
    const cookie = Bun.Cookie.parse("name=value; Domain=example.com; Path=/foo; Secure; SameSite=Lax");

    expect(cookie.name).toBe("name");
    expect(cookie.value).toBe("value");
    expect(cookie.domain).toBe("example.com");
    expect(cookie.path).toBe("/foo");
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe("lax");
  });

  test("toJSON", () => {
    const cookie = new Bun.Cookie("name", "value", {
      domain: "example.com",
      path: "/foo",
    });
    expect(cookie.toJSON()).toEqual({
      name: "name",
      value: "value",
      domain: "example.com",
      path: "/foo",
      secure: false,
      sameSite: "lax",
      httpOnly: false,
      partitioned: false,
    });
  });
});

describe("Bun.CookieMap", () => {
  test("can create an empty cookie map", () => {
    const cookieMap = new Bun.CookieMap();
    expect(cookieMap.size).toBe(0);
  });

  test("can create a cookie map from a string", () => {
    const cookieMap = new Bun.CookieMap("name=value; foo=bar");
    expect(cookieMap.size).toBe(2);
    expect(cookieMap.has("name")).toBe(true);
    expect(cookieMap.has("foo")).toBe(true);
    expect(cookieMap.get("name")).toBe("value");
    expect(cookieMap.get("foo")).toBe("bar");
  });

  test("can create a cookie map from an object", () => {
    const cookieMap = new Bun.CookieMap({
      name: "value",
      foo: "bar",
    });

    expect(cookieMap.size).toBe(2);
    expect(cookieMap.has("name")).toBe(true);
    expect(cookieMap.has("foo")).toBe(true);
    expect(cookieMap.get("name")).toBe("value");
    expect(cookieMap.get("foo")).toBe("bar");
  });

  test("can create a cookie map from pairs", () => {
    const cookieMap = new Bun.CookieMap([
      ["name", "value"],
      ["foo", "bar"],
    ]);

    expect(cookieMap.size).toBe(2);
    expect(cookieMap.has("name")).toBe(true);
    expect(cookieMap.has("foo")).toBe(true);
    expect(cookieMap.get("name")).toBe("value");
    expect(cookieMap.get("foo")).toBe("bar");
  });

  test("can set and get cookies", () => {
    const cookieMap = new Bun.CookieMap();

    cookieMap.set("name", "value");
    expect(cookieMap.size).toBe(1);
    expect(cookieMap.has("name")).toBe(true);
    expect(cookieMap.get("name")).toBe("value");

    cookieMap.set("foo", "bar");
    expect(cookieMap.size).toBe(2);
    expect(cookieMap.has("foo")).toBe(true);
    expect(cookieMap.get("foo")).toBe("bar");
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

    expect(cookieMap.toSetCookieHeaders()).toMatchInlineSnapshot(`
      [
        "name=value; Domain=example.com; Path=/foo; Secure; SameSite=Lax",
      ]
    `);

    expect(cookieMap.get("name")).toBe("value");
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

    expect(cookieMap.toSetCookieHeaders()).toMatchInlineSnapshot(`
      [
        "name=; Domain=example.com; Path=/foo; Expires=Fri, 1 Jan 1970 00:00:00 -0000; SameSite=Lax",
      ]
    `);

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

  test("supports iteration", () => {
    const cookieMap = new Bun.CookieMap("name=value; foo=bar");

    const entries = Array.from(cookieMap.entries());
    expect(entries).toMatchInlineSnapshot(`
      [
        [
          "name",
          "value",
        ],
        [
          "foo",
          "bar",
        ],
      ]
    `);
  });

  test("toJSON", () => {
    const cookieMap = new Bun.CookieMap("name=value; foo=bar");
    expect(JSON.stringify(cookieMap, null, 2)).toMatchInlineSnapshot(`
      "{
        "name": "value",
        "foo": "bar"
      }"
    `);
  });
});

test("cookie invalid surrogate pair", () => {
  const cookie = new Bun.Cookie("name", "hello\uD800goodbye", {});
  expect(cookie.value).toBe("hello\uFFFDgoodbye");
  expect(cookie.toString()).toMatchInlineSnapshot(`"name=hello%EF%BF%BDgoodbye; Path=/; SameSite=Lax"`);

  const cookie2 = new Bun.Cookie("name", "abcdefg", {});
  cookie2.value = "hello\uD800goodbye";
  expect(cookie2.value).toBe("hello\uFFFDgoodbye");
  expect(cookie2.toString()).toMatchInlineSnapshot(`"name=hello%EF%BF%BDgoodbye; Path=/; SameSite=Lax"`);
});

test("validation errors", () => {
  const mycookie = new Bun.Cookie("a", "b");
  expect(() => (mycookie.domain = "ndcla \nkjnc iap!PL)P890u89iop")).toThrow(
    /Invalid cookie domain: contains invalid characters/,
  );
  expect(mycookie.domain).toBe(null);
  expect(() => (mycookie.path = "ndcla \nkjnc iap!PL)P890u89iop")).toThrow(
    /Invalid cookie path: contains invalid characters/,
  );
  expect(mycookie.path).toBe("/");
  // set name does nothing with no error
  mycookie.name = "ndcla \nkjnc iap!PL)P890u89iop";
  expect(mycookie.name).toBe("a");
});

const cookie = {
  parse: str => {
    return Object.fromEntries(new Bun.CookieMap(str).entries());
  },
  serialize: (name, value, options) => {
    options = { path: "", ...options };
    const cookie = new Bun.Cookie(name, value, options);
    return cookie.toString();
  },
};

// (The MIT License)

// Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com>
// Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>

// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// 'Software'), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:

// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
// CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

describe("cookie.parse(str)", function () {
  it("should parse cookie string to object", function () {
    expect(cookie.parse("foo=bar")).toEqual({ foo: "bar" });
    expect(cookie.parse("foo=123")).toEqual({ foo: "123" });
  });

  it("should ignore OWS", function () {
    expect(cookie.parse("FOO    = bar;   baz  =   raz")).toEqual({
      FOO: "bar",
      baz: "raz",
    });
  });

  it("should parse cookie with empty value", function () {
    expect(cookie.parse("foo=; bar=")).toEqual({ foo: "", bar: "" });
  });

  it("should parse cookie with minimum length", function () {
    expect(cookie.parse("f=")).toEqual({ f: "" });
    expect(cookie.parse("f=;b=")).toEqual({ f: "", b: "" });
  });

  it("should URL-decode values", function () {
    expect(cookie.parse('foo="bar=123456789&name=Magic+Mouse"')).toEqual({
      foo: '"bar=123456789&name=Magic+Mouse"',
    });

    expect(cookie.parse("email=%20%22%2c%3b%2f")).toEqual({ email: ' ",;/' });
  });

  it.failing("should trim whitespace around key and value", function () {
    expect(cookie.parse('  foo  =  "bar"  ')).toEqual({ foo: '"bar"' });
    expect(cookie.parse("  foo  =  bar  ;  fizz  =  buzz  ")).toEqual({
      foo: "bar",
      fizz: "buzz",
    });
    expect(cookie.parse(' foo = " a b c " ')).toEqual({ foo: '" a b c "' });
    expect(cookie.parse(" = bar ")).toEqual({ "": "bar" });
    expect(cookie.parse(" foo = ")).toEqual({ foo: "" });
    expect(cookie.parse("   =   ")).toEqual({ "": "" });
    expect(cookie.parse("\tfoo\t=\tbar\t")).toEqual({ foo: "bar" });
  });

  it.failing("should return original value on escape error", function () {
    expect(cookie.parse("foo=%1;bar=bar")).toEqual({ foo: "%1", bar: "bar" });
  });

  it("should ignore cookies without value", function () {
    expect(cookie.parse("foo=bar;fizz  ;  buzz")).toEqual({ foo: "bar" });
    expect(cookie.parse("  fizz; foo=  bar")).toEqual({ foo: "bar" });
  });

  it("should ignore duplicate cookies", function () {
    expect(cookie.parse("foo=%1;bar=bar;foo=boo")).toEqual({
      foo: "boo",
      bar: "bar",
    });
    expect(cookie.parse("foo=false;bar=bar;foo=true")).toEqual({
      foo: "true",
      bar: "bar",
    });
    expect(cookie.parse("foo=;bar=bar;foo=boo")).toEqual({
      foo: "boo",
      bar: "bar",
    });
  });

  it("should parse native properties", function () {
    expect(cookie.parse("toString=foo;valueOf=bar")).toEqual({
      toString: "foo",
      valueOf: "bar",
    });
  });
});

describe.skip("cookie.parse(str, options)", function () {
  describe('with "decode" option', function () {
    it("should specify alternative value decoder", function () {
      expect(
        cookie.parse('foo="YmFy"', {
          decode: function (v) {
            return Buffer.from(v, "base64").toString();
          },
        }),
      ).toEqual({ foo: "bar" });
    });
  });
});

describe("cookie.serialize(name, value)", function () {
  it("should serialize name and value", function () {
    expect(cookie.serialize("foo", "bar")).toEqual("foo=bar; SameSite=Lax");
  });

  it("should URL-encode value", function () {
    expect(cookie.serialize("foo", "bar +baz;")).toEqual("foo=bar%20%2Bbaz%3B; SameSite=Lax");
  });

  it("should serialize empty value", function () {
    expect(cookie.serialize("foo", "")).toEqual("foo=; SameSite=Lax");
  });

  it.each([
    ["foo"],
    ["foo,bar"],
    ["foo!bar"],
    ["foo#bar"],
    ["foo$bar"],
    ["foo'bar"],
    ["foo*bar"],
    ["foo+bar"],
    ["foo-bar"],
    ["foo.bar"],
    ["foo^bar"],
    ["foo_bar"],
    ["foo`bar"],
    ["foo|bar"],
    ["foo~bar"],
    ["foo7bar"],
    ["foo/bar"],
    ["foo@bar"],
    ["foo[bar"],
    ["foo]bar"],
    ["foo:bar"],
    ["foo{bar"],
    ["foo}bar"],
    ['foo"bar'],
    ["foo<bar"],
    ["foo>bar"],
    ["foo?bar"],
    ["foo\\bar"],
  ])("should serialize name: %s", name => {
    expect(cookie.serialize(name, "baz")).toEqual(`${name}=baz; SameSite=Lax`);
  });

  it.each([["foo\n"], ["foo\u280a"], ["foo=bar"], ["foo;bar"], ["foo bar"], ["foo\tbar"], [""]])(
    "should throw for invalid name: %s",
    name => {
      expect(() => cookie.serialize(name, "bar")).toThrow(
        /name is required|Invalid cookie name: contains invalid characters/,
      );
    },
  );
});

describe("cookie.serialize(name, value, options)", function () {
  describe('with "domain" option', function () {
    it.each([
      ["example.com"],
      ["sub.example.com"],
      [".example.com"],
      ["localhost"],
      [".localhost"],
      ["my-site.org"],
      ["localhost"],
    ])("should serialize domain: %s", domain => {
      expect(cookie.serialize("foo", "bar", { domain })).toEqual(`foo=bar; Domain=${domain}; SameSite=Lax`);
    });

    it.each([
      ["example.com\n"],
      ["sub.example.com\u0000"],
      ["my site.org"],
      // ["domain..com"], // TODO
      ["example.com; Path=/"],
      ["example.com /* inject a comment */"],
    ])("should throw for invalid domain: %s", domain => {
      expect(() => cookie.serialize("foo", "bar", { domain })).toThrow(
        /Invalid cookie domain: contains invalid characters/,
      );
    });
  });

  describe.skip('with "encode" option', function () {
    it("should specify alternative value encoder", function () {
      expect(
        cookie.serialize("foo", "bar", {
          encode: function (v) {
            return Buffer.from(v, "utf8").toString("base64");
          },
        }),
      ).toEqual("foo=YmFy");
    });

    it.each(["foo=bar", 'foo"bar', "foo,bar", "foo\\bar", "foo$bar"])("should serialize value: %s", value => {
      expect(cookie.serialize("foo", value, { encode: x => x })).toEqual(`foo=${value}`);
    });

    it.each([["+\n"], ["foo bar"], ["foo\tbar"], ["foo;bar"], ["foo\u280a"]])(
      "should throw for invalid value: %s",
      value => {
        expect(() => cookie.serialize("foo", value, { encode: x => x })).toThrow(/argument val is invalid/);
      },
    );
  });

  describe('with "expires" option', function () {
    it("should throw on invalid date", function () {
      expect(
        cookie.serialize.bind(cookie, "foo", "bar", { expires: new Date(NaN) }),
      ).toThrowErrorMatchingInlineSnapshot(`"expires must be a valid Date (or Number)"`);
    });

    it("should set expires to given date", function () {
      expect(
        cookie.serialize("foo", "bar", {
          expires: new Date(Date.UTC(2000, 11, 24, 10, 30, 59, 900)),
        }),
      ).toEqual("foo=bar; Expires=Mon, 24 Dec 2000 10:30:59 -0000; SameSite=Lax");
    });
  });

  describe('with "httpOnly" option', function () {
    it("should include httpOnly flag when true", function () {
      expect(cookie.serialize("foo", "bar", { httpOnly: true })).toEqual("foo=bar; HttpOnly; SameSite=Lax");
    });

    it("should not include httpOnly flag when false", function () {
      expect(cookie.serialize("foo", "bar", { httpOnly: false })).toEqual("foo=bar; SameSite=Lax");
    });
  });

  describe('with "maxAge" option', function () {
    it.failing("should throw when not a number", function () {
      expect(function () {
        cookie.serialize("foo", "bar", { maxAge: "buzz" });
      }).toThrow(/option maxAge is invalid/);
    });

    it.failing("should throw when Infinity", function () {
      expect(function () {
        cookie.serialize("foo", "bar", { maxAge: Infinity });
      }).toThrow(/option maxAge is invalid/);
    });

    it.failing("should throw when max-age is not an integer", function () {
      expect(function () {
        cookie.serialize("foo", "bar", { maxAge: 3.14 });
      }).toThrow(/option maxAge is invalid/);
    });

    it("should set max-age to value", function () {
      expect(cookie.serialize("foo", "bar", { maxAge: 1000 })).toEqual("foo=bar; Max-Age=1000; SameSite=Lax");
      expect(cookie.serialize("foo", "bar", { maxAge: 0 })).toEqual("foo=bar; Max-Age=0; SameSite=Lax");
    });

    it("should not set when undefined", function () {
      expect(cookie.serialize("foo", "bar", { maxAge: undefined })).toEqual("foo=bar; SameSite=Lax");
    });
  });

  describe('with "partitioned" option', function () {
    it("should include partitioned flag when true", function () {
      expect(cookie.serialize("foo", "bar", { partitioned: true })).toEqual("foo=bar; Partitioned; SameSite=Lax");
    });

    it("should not include partitioned flag when false", function () {
      expect(cookie.serialize("foo", "bar", { partitioned: false })).toEqual("foo=bar; SameSite=Lax");
    });

    it("should not include partitioned flag when not defined", function () {
      expect(cookie.serialize("foo", "bar", {})).toEqual("foo=bar; SameSite=Lax");
    });
  });

  describe('with "path" option', function () {
    it("should serialize path", function () {
      var validPaths = [
        // "/",
        "/login",
        "/foo.bar/baz",
        "/foo-bar",
        "/foo=bar?baz",
        '/foo"bar"',
        "/../foo/bar",
        "../foo/",
        "./",
      ];

      validPaths.forEach(function (path) {
        expect(cookie.serialize("foo", "bar", { path: path })).toEqual("foo=bar; Path=" + path + "; SameSite=Lax");
      });
    });

    it.failing("should throw for invalid value", function () {
      var invalidPaths = [
        "/\n",
        "/foo\u0000",
        "/path/with\rnewline",
        "/; Path=/sensitive-data",
        '/login"><script>alert(1)</script>',
      ];

      invalidPaths.forEach(function (path) {
        expect(cookie.serialize.bind(cookie, "foo", "bar", { path: path })).toThrow(/option path is invalid/);
      });
    });
  });

  // not a standard feature
  describe.skip('with "priority" option', function () {
    it("should throw on invalid priority", function () {
      expect(function () {
        cookie.serialize("foo", "bar", { priority: "foo" });
      }).toThrow(/option priority is invalid/);
    });

    it("should throw on non-string", function () {
      expect(function () {
        cookie.serialize("foo", "bar", { priority: 42 });
      }).toThrow(/option priority is invalid/);
    });

    it("should set priority low", function () {
      expect(cookie.serialize("foo", "bar", { priority: "low" })).toEqual("foo=bar; Priority=Low");
    });

    it("should set priority medium", function () {
      expect(cookie.serialize("foo", "bar", { priority: "medium" })).toEqual("foo=bar; Priority=Medium");
    });

    it("should set priority high", function () {
      expect(cookie.serialize("foo", "bar", { priority: "high" })).toEqual("foo=bar; Priority=High");
    });

    it("should set priority case insensitive", function () {
      /** @ts-expect-error */
      expect(cookie.serialize("foo", "bar", { priority: "High" })).toEqual("foo=bar; Priority=High");
    });
  });

  describe('with "sameSite" option', function () {
    it("should throw on invalid sameSite", function () {
      expect(() => {
        cookie.serialize("foo", "bar", { sameSite: "foo" });
      }).toThrowErrorMatchingInlineSnapshot(`"Invalid sameSite value. Must be 'strict', 'lax', or 'none'"`);
    });

    it("should set sameSite strict", function () {
      expect(cookie.serialize("foo", "bar", { sameSite: "strict" })).toEqual("foo=bar; SameSite=Strict");
    });

    it("should set sameSite lax", function () {
      expect(cookie.serialize("foo", "bar", { sameSite: "lax" })).toEqual("foo=bar; SameSite=Lax");
    });

    it("should set sameSite none", function () {
      expect(cookie.serialize("foo", "bar", { sameSite: "none" })).toEqual("foo=bar; SameSite=None");
    });

    it.failing("should set sameSite strict when true", function () {
      expect(cookie.serialize("foo", "bar", { sameSite: true })).toEqual("foo=bar; SameSite=Strict");
    });

    it.failing("should not set sameSite when false", function () {
      expect(cookie.serialize("foo", "bar", { sameSite: false })).toEqual("foo=bar");
    });

    it.failing("should set sameSite case insensitive", function () {
      expect(cookie.serialize("foo", "bar", { sameSite: "Lax" })).toEqual("foo=bar; SameSite=Lax");
    });
  });

  describe('with "secure" option', function () {
    it("should include secure flag when true", function () {
      expect(cookie.serialize("foo", "bar", { secure: true })).toEqual("foo=bar; Secure; SameSite=Lax");
    });

    it("should not include secure flag when false", function () {
      expect(cookie.serialize("foo", "bar", { secure: false })).toEqual("foo=bar; SameSite=Lax");
    });
  });
});
