import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import fs, { chmodSync, unlinkSync } from "fs";
import { mkfifo } from "mkfifo";
import { gc, withoutAggressiveGC } from "./gc";

const exampleFixture = fs.readFileSync(
  import.meta.path.substring(0, import.meta.path.lastIndexOf("/")) + "/fetch.js.txt",
  "utf8",
);

describe("Headers", () => {
  it(".toJSON", () => {
    var headers = new Headers({
      "content-length": "123",
      "content-type": "text/plain",
      "x-another-custom-header": "Hello World",
      "x-custom-header": "Hello World",
    });
    expect(JSON.stringify(headers.toJSON(), null, 2)).toBe(
      JSON.stringify(Object.fromEntries(headers.entries()), null, 2),
    );
  });

  it(".getSetCookie() with object", () => {
    var headers = new Headers({
      "content-length": "123",
      "content-type": "text/plain",
      "x-another-custom-header": "Hello World",
      "x-custom-header": "Hello World",
      "Set-Cookie": "foo=bar; Path=/; HttpOnly",
    });
    expect(headers.count).toBe(5);
    expect(headers.getAll("set-cookie")).toEqual(["foo=bar; Path=/; HttpOnly"]);
  });

  it(".getSetCookie() with array", () => {
    var headers = new Headers([
      ["content-length", "123"],
      ["content-type", "text/plain"],
      ["x-another-custom-header", "Hello World"],
      ["x-custom-header", "Hello World"],
      ["Set-Cookie", "foo=bar; Path=/; HttpOnly"],
      ["Set-Cookie", "foo2=bar2; Path=/; HttpOnly"],
    ]);
    expect(headers.count).toBe(6);
    expect(headers.getAll("set-cookie")).toEqual(["foo=bar; Path=/; HttpOnly", "foo2=bar2; Path=/; HttpOnly"]);
  });

  it("Set-Cookies init", () => {
    const headers = new Headers([
      ["Set-Cookie", "foo=bar"],
      ["Set-Cookie", "bar=baz"],
      ["X-bun", "abc"],
      ["X-bun", "def"],
    ]);
    const actual = [...headers];
    expect(actual).toEqual([
      ["set-cookie", "foo=bar"],
      ["set-cookie", "bar=baz"],
      ["x-bun", "abc, def"],
    ]);
    expect([...headers.values()]).toEqual(["foo=bar", "bar=baz", "abc, def"]);
  });

  it("Headers append multiple", () => {
    const headers = new Headers([
      ["Set-Cookie", "foo=bar"],
      ["X-bun", "foo"],
    ]);
    headers.append("Set-Cookie", "bar=baz");
    headers.append("x-bun", "bar");
    const actual = [...headers];

    // we do not preserve the order
    // which is kind of bad
    expect(actual).toEqual([
      ["set-cookie", "foo=bar"],
      ["set-cookie", "bar=baz"],
      ["x-bun", "foo, bar"],
    ]);
  });

  it("append duplicate set cookie key", () => {
    const headers = new Headers([["Set-Cookie", "foo=bar"]]);
    headers.append("set-Cookie", "foo=baz");
    headers.append("Set-cookie", "baz=bar");
    const actual = [...headers];
    expect(actual).toEqual([
      ["set-cookie", "foo=baz"],
      ["set-cookie", "baz=bar"],
    ]);
  });

  it("set duplicate cookie key", () => {
    const headers = new Headers([["Set-Cookie", "foo=bar"]]);
    headers.set("set-Cookie", "foo=baz");
    headers.set("set-cookie", "bar=qat");
    const actual = [...headers];
    expect(actual).toEqual([
      ["set-cookie", "foo=baz"],
      ["set-cookie", "bar=qat"],
    ]);
  });
});

describe("fetch", () => {
  const urls = [
    "https://example.com",
    "http://example.com",
    new URL("https://example.com"),
    new Request({ url: "https://example.com" }),
    { toString: () => "https://example.com" },
  ];
  for (let url of urls) {
    gc();
    let name = url;
    if (name instanceof URL) {
      name = "URL: " + name;
    } else if (name instanceof Request) {
      name = "Request: " + name.url;
    } else if (name.hasOwnProperty("toString")) {
      name = "Object: " + name.toString();
    }
    it(name, async () => {
      gc();
      const response = await fetch(url, { verbose: true });
      gc();
      const text = await response.text();
      gc();
      expect(exampleFixture).toBe(text);
    });
  }

  it(`"redirect: "manual"`, async () => {
    const server = Bun.serve({
      port: 4082,
      fetch(req) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "https://example.com",
          },
        });
      },
    });
    const response = await fetch(`http://${server.hostname}:${server.port}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com");
    expect(response.redirected).toBe(true);
    server.stop();
  });

  it(`"redirect: "follow"`, async () => {
    const server = Bun.serve({
      port: 4083,
      fetch(req) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "https://example.com",
          },
        });
      },
    });
    const response = await fetch(`http://${server.hostname}:${server.port}`, {
      redirect: "follow",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBe(null);
    expect(response.redirected).toBe(true);
    server.stop();
  });
});

it("simultaneous HTTPS fetch", async () => {
  const urls = ["https://example.com", "https://www.example.com"];
  for (let batch = 0; batch < 4; batch++) {
    const promises = new Array(20);
    for (let i = 0; i < 20; i++) {
      promises[i] = fetch(urls[i % 2]);
    }
    const result = await Promise.all(promises);
    expect(result.length).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(result[i].status).toBe(200);
      expect(await result[i].text()).toBe(exampleFixture);
    }
  }
});

it("website with tlsextname", async () => {
  // irony
  await fetch("https://bun.sh", { method: "HEAD" });
});

function testBlobInterface(blobbyConstructor, hasBlobFn) {
  for (let withGC of [false, true]) {
    for (let jsonObject of [
      { hello: true },
      {
        hello: "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳",
      },
    ]) {
      it(`${jsonObject.hello === true ? "latin1" : "utf16"} json${withGC ? " (with gc) " : ""}`, async () => {
        if (withGC) gc();
        var response = blobbyConstructor(JSON.stringify(jsonObject));
        if (withGC) gc();
        expect(JSON.stringify(await response.json())).toBe(JSON.stringify(jsonObject));
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} arrayBuffer -> json${
        withGC ? " (with gc) " : ""
      }`, async () => {
        if (withGC) gc();
        var response = blobbyConstructor(new TextEncoder().encode(JSON.stringify(jsonObject)));
        if (withGC) gc();
        expect(JSON.stringify(await response.json())).toBe(JSON.stringify(jsonObject));
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} arrayBuffer -> invalid json${
        withGC ? " (with gc) " : ""
      }`, async () => {
        if (withGC) gc();
        var response = blobbyConstructor(
          new TextEncoder().encode(JSON.stringify(jsonObject) + " NOW WE ARE INVALID JSON"),
        );
        if (withGC) gc();
        var failed = false;
        try {
          await response.json();
        } catch (e) {
          failed = true;
        }
        expect(failed).toBe(true);
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} text${withGC ? " (with gc) " : ""}`, async () => {
        if (withGC) gc();
        var response = blobbyConstructor(JSON.stringify(jsonObject));
        if (withGC) gc();
        expect(await response.text()).toBe(JSON.stringify(jsonObject));
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} arrayBuffer -> text${
        withGC ? " (with gc) " : ""
      }`, async () => {
        if (withGC) gc();
        var response = blobbyConstructor(new TextEncoder().encode(JSON.stringify(jsonObject)));
        if (withGC) gc();
        expect(await response.text()).toBe(JSON.stringify(jsonObject));
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} arrayBuffer${withGC ? " (with gc) " : ""}`, async () => {
        if (withGC) gc();

        var response = blobbyConstructor(JSON.stringify(jsonObject));
        if (withGC) gc();

        const bytes = new TextEncoder().encode(JSON.stringify(jsonObject));
        if (withGC) gc();

        const compare = new Uint8Array(await response.arrayBuffer());
        if (withGC) gc();

        withoutAggressiveGC(() => {
          for (let i = 0; i < compare.length; i++) {
            if (withGC) gc();

            expect(compare[i]).toBe(bytes[i]);
            if (withGC) gc();
          }
        });
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} arrayBuffer -> arrayBuffer${
        withGC ? " (with gc) " : ""
      }`, async () => {
        if (withGC) gc();

        var response = blobbyConstructor(new TextEncoder().encode(JSON.stringify(jsonObject)));
        if (withGC) gc();

        const bytes = new TextEncoder().encode(JSON.stringify(jsonObject));
        if (withGC) gc();

        const compare = new Uint8Array(await response.arrayBuffer());
        if (withGC) gc();

        withoutAggressiveGC(() => {
          for (let i = 0; i < compare.length; i++) {
            if (withGC) gc();

            expect(compare[i]).toBe(bytes[i]);
            if (withGC) gc();
          }
        });
        if (withGC) gc();
      });

      hasBlobFn &&
        it(`${jsonObject.hello === true ? "latin1" : "utf16"} blob${withGC ? " (with gc) " : ""}`, async () => {
          if (withGC) gc();
          const text = JSON.stringify(jsonObject);
          var response = blobbyConstructor(text);
          if (withGC) gc();
          const size = new TextEncoder().encode(text).byteLength;
          if (withGC) gc();
          const blobed = await response.blob();
          if (withGC) gc();
          expect(blobed instanceof Blob).toBe(true);
          if (withGC) gc();
          expect(blobed.size).toBe(size);
          if (withGC) gc();
          blobed.type = "";
          if (withGC) gc();
          expect(blobed.type).toBe("");
          if (withGC) gc();
          blobed.type = "application/json";
          if (withGC) gc();
          expect(blobed.type).toBe("application/json");
          if (withGC) gc();
          const out = await blobed.text();
          expect(out).toBe(text);
          if (withGC) gc();
          await new Promise(resolve => setTimeout(resolve, 1));
          if (withGC) gc();
          expect(out).toBe(text);
          const first = await blobed.arrayBuffer();
          const initial = first[0];
          first[0] = 254;
          const second = await blobed.arrayBuffer();
          expect(second[0]).toBe(initial);
          expect(first[0]).toBe(254);
        });
    }
  }
}

describe("Bun.file", () => {
  const tempdir = require("os").tmpdir();
  var callCount = 0;
  testBlobInterface(data => {
    const blob = new Blob([data]);
    const buffer = Bun.peek(blob.arrayBuffer());
    const path = tempdir + "-" + callCount++ + ".bytes";
    require("fs").writeFileSync(path, buffer);
    const file = Bun.file(path);
    expect(blob.size).toBe(file.size);
    return file;
  });

  it("size is Infinity on a fifo", () => {
    try {
      unlinkSync("/tmp/test-fifo");
    } catch (e) {}
    mkfifo("/tmp/test-fifo");

    const { size } = Bun.file("/tmp/test-fifo");
    expect(size).toBe(Infinity);
  });

  function forEachMethod(fn) {
    const method = ["arrayBuffer", "text", "json"];
    for (const m of method) {
      test(m, fn(m));
    }
  }

  describe("bad permissions throws", () => {
    beforeAll(async () => {
      try {
        unlinkSync("/tmp/my-new-file");
      } catch {}
      await Bun.write("/tmp/my-new-file", "hey");
      chmodSync("/tmp/my-new-file", 0o000);
    });
    afterAll(() => {
      try {
        unlinkSync("/tmp/my-new-file");
      } catch {}
    });

    forEachMethod(m => () => {
      const file = Bun.file("/tmp/my-new-file");
      expect(async () => await file[m]()).toThrow("Permission denied");
    });
  });

  describe("non-existent file throws", () => {
    beforeAll(() => {
      try {
        unlinkSync("/tmp/does-not-exist");
      } catch {}
    });

    forEachMethod(m => async () => {
      const file = Bun.file("/tmp/does-not-exist");
      expect(async () => await file[m]()).toThrow("No such file or directory");
    });
  });
});

describe("Blob", () => {
  testBlobInterface(data => new Blob([data]));

  var blobConstructorValues = [
    ["123", "456"],
    ["123", 456],
    ["123", "456", "789"],
    ["123", 456, 789],
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    [Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 9])],
    [Uint8Array.from([1, 2, 3, 4]), "5678", 9],
    [new Blob([Uint8Array.from([1, 2, 3, 4])]), "5678", 9],
    [
      new Blob([
        new TextEncoder().encode(
          "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳",
        ),
      ]),
    ],
    [
      new TextEncoder().encode(
        "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳",
      ),
    ],
  ];

  var expected = [
    "123456",
    "123456",
    "123456789",
    "123456789",
    "123456789",
    "\x01\x02\x03\x04\x05\x06\x07\t",
    "\x01\x02\x03\x0456789",
    "\x01\x02\x03\x0456789",
    "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳",
    "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳",
  ];

  it(`blobConstructorValues`, async () => {
    for (let i = 0; i < blobConstructorValues.length; i++) {
      var response = new Blob(blobConstructorValues[i]);
      const res = await response.text();
      if (res !== expected[i]) {
        throw new Error(
          `Failed: ${expected[i].split("").map(a => a.charCodeAt(0))}, received: ${res
            .split("")
            .map(a => a.charCodeAt(0))}`,
        );
      }

      expect(res).toBe(expected[i]);
    }
  });

  for (let withGC of [false, true]) {
    it(`Blob.slice() ${withGC ? " with gc" : ""}`, async () => {
      var parts = ["hello", " ", "world"];
      if (withGC) gc();
      var str = parts.join("");
      if (withGC) gc();
      var combined = new Blob(parts);
      if (withGC) gc();
      for (let part of parts) {
        if (withGC) gc();
        expect(await combined.slice(str.indexOf(part), str.indexOf(part) + part.length).text()).toBe(part);
        if (withGC) gc();
      }
      if (withGC) gc();
      for (let part of parts) {
        if (withGC) gc();
        expect(await combined.slice(str.indexOf(part), str.indexOf(part) + part.length).text()).toBe(part);
        if (withGC) gc();
      }
    });
  }
});

{
  const sample = new TextEncoder().encode("Hello World!");
  const typedArrays = [
    Uint8Array,
    Uint8ClampedArray,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
  ];
  const Constructors = [Blob, Response, Request];

  for (let withGC of [false, true]) {
    for (let TypedArray of typedArrays) {
      for (let Constructor of Constructors) {
        it(`${Constructor.name} arrayBuffer() with ${TypedArray.name}${withGC ? " with gc" : ""}`, async () => {
          const data = new TypedArray(sample);
          if (withGC) gc();
          const input = Constructor === Blob ? [data] : Constructor === Request ? { body: data } : data;
          if (withGC) gc();
          const blob = new Constructor(input);
          if (withGC) gc();
          const out = await blob.arrayBuffer();
          if (withGC) gc();
          expect(out instanceof ArrayBuffer).toBe(true);
          if (withGC) gc();
          expect(out.byteLength).toBe(data.byteLength);
          if (withGC) gc();
        });
      }
    }
  }
}

describe("Response", () => {
  describe("Response.json", () => {
    it("works", async () => {
      const inputs = ["hellooo", [[123], 456, 789], { hello: "world" }, { ok: "😉 😌 😍 🥰 😘 " }];
      for (let input of inputs) {
        const output = JSON.stringify(input);
        expect(await Response.json(input).text()).toBe(output);
      }
      // JSON.stringify() returns undefined
      expect(await Response.json().text()).toBe("");
      // JSON.stringify("") returns '""'
      expect(await Response.json("").text()).toBe('""');
    });
    it("sets the content-type header", () => {
      let response = Response.json("hello");
      expect(response.type).toBe("basic");
      expect(response.headers.get("content-type")).toBe("application/json;charset=utf-8");
      expect(response.status).toBe(200);
    });
    it("supports number status code", () => {
      let response = Response.json("hello", 407);
      expect(response.type).toBe("basic");
      expect(response.headers.get("content-type")).toBe("application/json;charset=utf-8");
      expect(response.status).toBe(407);
    });

    it("supports headers", () => {
      var response = Response.json("hello", {
        headers: {
          "content-type": "potato",
          "x-hello": "world",
        },
        status: 408,
      });

      expect(response.headers.get("x-hello")).toBe("world");
      expect(response.status).toBe(408);
    });
  });
  describe("Response.redirect", () => {
    it("works", () => {
      const inputs = [
        "http://example.com",
        "http://example.com/",
        "http://example.com/hello",
        "http://example.com/hello/",
        "http://example.com/hello/world",
        "http://example.com/hello/world/",
      ];
      for (let input of inputs) {
        expect(Response.redirect(input).headers.get("Location")).toBe(input);
      }
    });

    it("supports headers", () => {
      var response = Response.redirect("https://example.com", {
        headers: {
          "content-type": "potato",
          "x-hello": "world",
          Location: "https://wrong.com",
        },
        status: 408,
      });
      expect(response.headers.get("x-hello")).toBe("world");
      expect(response.headers.get("Location")).toBe("https://example.com");
      expect(response.status).toBe(302);
      expect(response.type).toBe("basic");
      expect(response.ok).toBe(false);
    });
  });
  describe("Response.error", () => {
    it("works", () => {
      expect(Response.error().type).toBe("error");
      expect(Response.error().ok).toBe(false);
      expect(Response.error().status).toBe(0);
    });
  });
  it("clone", async () => {
    gc();
    var body = new Response("<div>hello</div>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
    gc();
    var clone = body.clone();
    gc();
    body.headers.set("content-type", "text/plain");
    gc();
    expect(clone.headers.get("content-type")).toBe("text/html; charset=utf-8");
    gc();
    expect(body.headers.get("content-type")).toBe("text/plain");
    gc();
    expect(await clone.text()).toBe("<div>hello</div>");
    gc();
  });
  it("invalid json", async () => {
    gc();
    var body = new Response("<div>hello</div>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
    try {
      await body.json();
      expect(false).toBe(true);
    } catch (exception) {
      expect(exception instanceof SyntaxError);
    }
  });

  testBlobInterface(data => new Response(data), true);
});

describe("Request", () => {
  it("clone", async () => {
    gc();
    var body = new Request("https://hello.com", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      body: "<div>hello</div>",
    });
    gc();
    expect(body.headers.get("content-type")).toBe("text/html; charset=utf-8");
    gc();
    var clone = body.clone();
    gc();
    body.headers.set("content-type", "text/plain");
    gc();
    expect(clone.headers.get("content-type")).toBe("text/html; charset=utf-8");
    gc();
    expect(body.headers.get("content-type")).toBe("text/plain");
    gc();
    expect(await clone.text()).toBe("<div>hello</div>");
    gc();
  });

  testBlobInterface(data => new Request("https://hello.com", { body: data }), true);
});

describe("Headers", () => {
  it("writes", async () => {
    var headers = new Headers({
      "content-type": "text/html; charset=utf-8",
    });
    gc();
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
    gc();
    headers.delete("content-type");
    gc();
    expect(headers.get("content-type")).toBe(null);
    gc();
    headers.append("content-type", "text/plain");
    gc();
    expect(headers.get("content-type")).toBe("text/plain");
    gc();
    headers.append("content-type", "text/plain");
    gc();
    expect(headers.get("content-type")).toBe("text/plain, text/plain");
    gc();
    headers.set("content-type", "text/html; charset=utf-8");
    gc();
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");

    headers.delete("content-type");
    gc();
    expect(headers.get("content-type")).toBe(null);
    gc();
  });
});
