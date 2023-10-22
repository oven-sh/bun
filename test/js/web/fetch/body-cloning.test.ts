import { AnyFunction, serve, ServeOptions, Server, sleep } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, it, beforeEach } from "bun:test";
let server: Server;
async function startServer(fetch, options = {}) {
  server = await serve({
    ...options,
    fetch,
    port: 0,
  });
}
const sleep = t => new Promise(r => setTimeout(r, t));

function requestServer(opts) {
  return fetch(`http://${server.hostname}:${server.port}/`, opts);
}
afterEach(() => {
  server?.stop?.(true);
});

describe("cloning", () => {
  it("can clone json", async () => {
    const data = {
      message: "Hello world",
    };
    await startServer(async request => {
      return new Response(JSON.stringify(data), {
        headers: {
          "Content-type": "application/json",
        },
      });
    });
    const res = await requestServer();
    const clone = res.clone();
    const [json, json2] = await Promise.all([res.json(), clone.json()]);
    expect(json).toEqual(data);
    expect(json2).toEqual(data);
  });
  it("can clone text", async () => {
    const data = "Well Hello friends";
    await startServer(async request => {
      return new Response(data, {
        headers: {
          "Content-type": "text/plain",
        },
      });
    });
    const res = await requestServer();
    const clone = res.clone();
    const [out, out2] = await Promise.all([res.text(), clone.text()]);
    expect(out).toEqual(data);
    expect(out2).toEqual(data);
  });

  it("can clone arrayBuffer", async () => {
    const data = Buffer.from("Well Hello friends", "utf-8");
    await startServer(async request => {
      return new Response(data, {
        headers: {
          "Content-type": "application/octet-stream",
        },
      });
    });
    const b = data.buffer.slice();
    const res = await requestServer();
    const clone = res.clone();
    const [out, out2] = await Promise.all([res.arrayBuffer(), clone.arrayBuffer()]);
    expect(out).toEqual(b);
    expect(out2).toEqual(b);
  });
  it("arrayBuffer string matches", async () => {
    const data = Buffer.from("Well Hello friends 🥹☺️", "utf-8");
    await startServer(async request => {
      return new Response(data, {
        headers: {
          "Content-type": "application/octet-stream",
        },
      });
    });
    const b = data.buffer.slice();
    const res = await requestServer();
    const clone = res.clone();
    const out = await Promise.all([res.arrayBuffer(), clone.arrayBuffer()]);
    for (const e of out) {
      expect(e).toEqual(b);
      expect(Buffer.from(e).toString()).toEqual(data.toString());
    }
  });
  it("can clone json from clone", async () => {
    const data = {
      message: "Hello world",
    };
    await startServer(async request => {
      return new Response(JSON.stringify(data), {
        headers: {
          "Content-type": "application/json",
        },
      });
    });
    const res = await requestServer();
    const parentClone = res.clone();
    const clone = parentClone.clone();
    const [json, json2, json3] = await Promise.all([res.json(), clone.json(), parentClone.json()]);
    expect(json).toEqual(data);
    expect(json2).toEqual(data);
    expect(json3).toEqual(data);
  });
  it("can clone json with delay", async () => {
    const data = {
      message: "Hello world",
    };
    await startServer(async request => {
      await sleep(1500);
      return new Response(JSON.stringify(data), {
        headers: {
          "Content-type": "application/json",
        },
      });
    });
    const res = await requestServer();
    const clone = res.clone();
    const [json, json2] = await Promise.all([res.json(), clone.json()]);
    expect(json).toEqual(data);
    expect(json2).toEqual(data);
  });
  it("cant clone a consumed body", async () => {
    const data = {
      message: "Hello world",
    };
    await startServer(async request => {
      return new Response(JSON.stringify(data), {
        headers: {
          "Content-type": "application/json",
        },
      });
    });
    const res = await requestServer();
    const body = await res.json();
    expect(() => {
      res.clone();
    }).toThrow();
  });
  it("cant clone a instanciated reader", async () => {
    const data = {
      message: "Hello world",
    };
    await startServer(async request => {
      return new Response(JSON.stringify(data), {
        headers: {
          "Content-type": "application/json",
        },
      });
    });
    const res = await requestServer();
    const stream = res.body.getReader();
    expect(() => {
      res.clone();
    }).toThrow();
  });
  it("reader only does not hold data", async () => {
    const data = "this is a very very very very long response".repeat(100000);
    const dataArray = new Uint8Array(Buffer.from(data));
    await startServer(async request => {
      return new Response(data, {
        headers: {
          "Content-type": "text/plain",
        },
      });
    });
    const merge = (a, b) => {
      const n = new Uint8Array(a.length + b.length);
      n.set(a, 0);
      n.set(b, a.length);
      return n;
    };
    const readerToArray = async (a, reader) => {
      let input = null;
      while (input === null || !input.done) {
        input = await reader.read();
        if (!a) {
          a = input.value;
        } else {
          if (input.value) a = merge(a, input.value);
        }
      }
      return a;
    };
    const res = await requestServer();
    const clone1 = res.clone();
    const clone2 = res.clone();
    const readers = [res, clone1, clone2].map(e => e.body.getReader());
    const initialData = await Promise.all(readers.map(e => e.read()));

    for (const id of initialData) {
      expect(id.done).toBe(false);
      expect(id.value).toBeDefined();
      expect(id.value.length).not.toEqual(dataArray.length);
    }
    const final = await readerToArray(initialData[0].value, readers[0]);
    expect((await readers[0].read()).done).toBe(true);
    expect(final).toBeDefined();
    expect(final).toEqual(dataArray);
  });
  it("can request github with multiple readers", async () => {
    const res = await fetch("https://github.com");
    const clone = res.clone();
    const textClone = res.clone();
    const arrayBufferClone = res.clone();
    const clone2 = clone.clone();
    const reader3 = clone2.body.getReader();
    const reader2 = clone.body.getReader();
    const reader1 = res.body.getReader();

    const merge = (a, b) => {
      const n = new Uint8Array(a.length + b.length);
      n.set(a, 0);
      n.set(b, a.length);
      return n;
    };

    const readerToArray = async reader => {
      let a = null;
      let input = null;
      while (input === null || !input.done) {
        input = await reader.read();
        if (!a) {
          a = input.value;
        } else {
          if (input.value) a = merge(a, input.value);
        }
      }
      return a;
    };

    const [b, c, array_buf, text] = await Promise.all([
      readerToArray(reader2),
      readerToArray(reader3),
      arrayBufferClone.arrayBuffer(),
      textClone.text(),
    ]);
    const ref = await readerToArray(reader1);
    const list = [ref, b, c];
    for (const entry of list) {
      expect(entry.length).toBe(ref.length);
      expect(entry).toEqual(ref);
    }
    expect(array_buf.length).toBe(res.length);
    expect(Buffer.from(array_buf).toString()).toEqual(text);
    expect(text.includes("<!DOCTYPE html>")).toBe(true);
    expect(text.includes("</html>")).toBe(true);
    expect(text.includes("github")).toBe(true);

  });
});
