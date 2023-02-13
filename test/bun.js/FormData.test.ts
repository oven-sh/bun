import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import fs, { chmodSync, unlinkSync } from "fs";
import { mkfifo } from "mkfifo";
import { gc, withoutAggressiveGC } from "./gc";

describe("FormData", () => {
  it("should be able to append a string", () => {
    const formData = new FormData();
    formData.append("foo", "bar");
    expect(formData.get("foo")).toBe("bar");
    expect(formData.getAll("foo")[0]).toBe("bar");
  });

  it("should be able to append a Blob", async () => {
    const formData = new FormData();
    formData.append("foo", new Blob(["bar"]));
    expect(await formData.get("foo").text()).toBe("bar");
    expect(formData.getAll("foo")[0] instanceof Blob).toBe(true);
  });

  it("should be able to set a Blob", async () => {
    const formData = new FormData();
    formData.set("foo", new Blob(["bar"]));
    expect(await formData.get("foo").text()).toBe("bar");
    expect(formData.getAll("foo")[0] instanceof Blob).toBe(true);
  });

  it("should be able to set a string", async () => {
    const formData = new FormData();
    formData.set("foo", "bar");
    expect(formData.get("foo")).toBe("bar");
    expect(formData.getAll("foo")[0]).toBe("bar");
  });

  const multipartFormDataFixturesRawBody = [
    {
      name: "simple",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo--\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: "bar",
      },
    },
    {
      name: "simple with trailing CRLF",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo--\r\n\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: "bar",
      },
    },
    {
      name: "simple with trailing CRLF and extra CRLF",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo--\r\n\r\n\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: "bar",
      },
    },
    {
      name: "advanced",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo\r\nContent-Disposition: form-data; name="baz"\r\n\r\nqux\r\n--foo--\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: "bar",
        baz: "qux",
      },
    },
    {
      name: "advanced with multiple values",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbaz\r\n--foo--\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: ["bar", "baz"],
      },
    },
    {
      name: "advanced with multiple values and trailing CRLF",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbaz\r\n--foo--\r\n\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: ["bar", "baz"],
      },
    },
    {
      name: "extremely advanced",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo\r\nContent-Disposition: form-data; name="baz"\r\n\r\nqux\r\n--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbaz\r\n--foo--\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: ["bar", "baz"],
        baz: "qux",
      },
    },
    {
      name: "with name and filename",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"; filename="bar"\r\n\r\nbaz\r\n--foo--\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: new Blob(["baz"]),
      },
    },
    {
      name: "with name and filename and trailing CRLF",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"; filename="bar"\r\n\r\nbaz\r\n--foo--\r\n\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: new Blob(["baz"]),
      },
    },
  ];

  for (const { name, body, headers, expected: expected_ } of multipartFormDataFixturesRawBody) {
    const Class = [Response, Request] as const;
    for (const C of Class) {
      it(`should parse multipart/form-data (${name}) with ${C.name}`, async () => {
        const response = C === Response ? new Response(body, { headers }) : new Request({ headers, body });
        const formData = await response.formData();
        expect(formData instanceof FormData).toBe(true);
        const entry = {};
        const expected = Object.assign({}, expected_);

        for (const key of formData.keys()) {
          const values = formData.getAll(key);
          if (values.length > 1) {
            entry[key] = values;
          } else {
            entry[key] = values[0];
            if (entry[key] instanceof Blob) {
              expect(expected[key] instanceof Blob).toBe(true);

              entry[key] = await entry[key].text();
              expected[key] = await expected[key].text();
            } else {
              expect(typeof entry[key]).toBe(typeof expected[key]);
              expect(expected[key] instanceof Blob).toBe(false);
            }
          }
        }

        expect(entry).toEqual(expected);
      });
    }
  }

  it("should throw on missing final boundary", async () => {
    const response = new Response('-foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n', {
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
    });
    try {
      await response.formData();
      throw "should have thrown";
    } catch (e) {
      expect(typeof e.message).toBe("string");
    }
  });

  it("should throw on bad boundary", async () => {
    const response = new Response('foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n', {
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
    });
    try {
      await response.formData();
      throw "should have thrown";
    } catch (e) {
      expect(typeof e.message).toBe("string");
    }
  });

  it("should throw on bad header", async () => {
    const response = new Response('foo\r\nContent-Disposition: form-data; name"foo"\r\n\r\nbar\r\n', {
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
    });
    try {
      await response.formData();
      throw "should have thrown";
    } catch (e) {
      expect(typeof e.message).toBe("string");
    }
  });
});
