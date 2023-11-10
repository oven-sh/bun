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

describe("request body cloning", () => {
  it("default json", async done => {
    const data = {
      message: "Hello world",
    };
    await startServer(async request => {
      try {
        const received = await request.json();
        expect(received).toEqual(data);
        done();
        return new Response(JSON.stringify({}), {
          headers: {
            "Content-type": "application/json",
          },
        });
      } catch (err) {
        done(err);
      }
    });
    await requestServer({
      method: "POST",
      body: JSON.stringify(data),
      headers: {
        "Content-type": "application/json",
      },
    });
  });
  it("default text", async done => {
    const data = "Well Hello friends";
    await startServer(async request => {
      try {
        const received = await request.text();
        expect(received).toEqual(data);
        done();
        return new Response(JSON.stringify({}), {
          headers: {
            "Content-type": "application/json",
          },
        });
      } catch (err) {
        done(err);
      }
    });
    await requestServer({
      method: "POST",
      body: data,
      headers: {
        "Content-type": "text/plain",
      },
    });
  });
  it("default Buffer", async done => {
    const data = Buffer.from("Well Hello friends");
    await startServer(async request => {
      try {
        const received = await request.arrayBuffer();
        expect(received).toEqual(data.buffer.slice());
        done();
        return new Response(JSON.stringify({}), {
          headers: {
            "Content-type": "application/json",
          },
        });
      } catch (err) {
        done(err);
      }
    });
    await requestServer({
      method: "POST",
      body: data,
      headers: {
        "Content-type": "application/octet-stream",
      },
    });
  });

  it("can clone all default types", async done => {
    const data = JSON.stringify({ message: "Hello world" });
    await startServer(async request => {
      try {
        const text_clone = request.clone();
        const arrayBuffer = text_clone.clone();
        const [array_buf, text, json] = await Promise.all([
          arrayBuffer.arrayBuffer(),
          text_clone.text(),
          request.json(),
        ]);
        expect(array_buf).toEqual(Buffer.from(data).buffer.slice());
        expect(text).toEqual(data);
        expect(json).toEqual(JSON.parse(data));
        done();
        return new Response(JSON.stringify({}), {
          headers: {
            "Content-type": "application/json",
          },
        });
      } catch (err) {
        done(err);
      }
    });
    await requestServer({
      method: "POST",
      body: data,
      headers: {
        "Content-type": "application/json",
      },
    });
  });

  it("can clone slow connection", async done => {
    const data = JSON.stringify({ message: "Hello world" });
    let socket;
    await startServer(async request => {
      try {
        const text_clone = request.clone();
        const arrayBuffer = text_clone.clone();
        const readerClone = arrayBuffer.clone();
        const [array_buf, text, json, reader_out] = await Promise.all([
          arrayBuffer.arrayBuffer(),
          text_clone.text(),
          request.json(),
          Bun.readableStreamToArrayBuffer(readerClone.body),
        ]);
        expect(array_buf).toEqual(Buffer.from(data).buffer.slice());
        expect(reader_out).toEqual(Buffer.from(data).buffer.slice());
        expect(text).toEqual(data);
        expect(json).toEqual(JSON.parse(data));

        return new Response(JSON.stringify({}), {
          headers: {
            "Content-type": "application/json",
          },
        });
      } catch (err) {
        done(err);
      }
    });
    socket = await Bun.connect({
      hostname: server.hostname,
      port: server.port,

      socket: {
        data(socket, data) {
          const s = data.toString().trim();
          expect(s.startsWith("HTTP/1.1 200 OK")).toBe(true);
          expect(s.substr(s.length - 4)).toEqual("\r\n{}");
          socket.end();
          done();
        },
        error(socket, error) {
          done(error);
        },
        connectError(socket, error) {
          done(error);
        },
      },
    });

    const writeAndVerify = data => {
      const buffer = Buffer.from(data, "utf-8");
      let written = socket.write(buffer);
      if (written !== buffer.length) {
        const flushed = socket.flush();
        if (typeof flushed === "number") written += flushed;
      }
      expect(written).toEqual(buffer.length);
    };
    writeAndVerify(
      [
        "POST / HTTP/1.1",
        "Host: localhost",
        "User-agent: test-client",
        "Connection: keep-alive",
        "Content-type: application/json",
        "Content-length: " + data.length,
        "\r\n",
      ].join("\r\n"),
    );
    await sleep(500);
    for (const char of data.split("")) {
      writeAndVerify(`${char}`);
      await sleep(150);
    }
  });

  it("cant clone consumed body", async done => {
    const data = {
      message: "Hello world",
    };
    await startServer(async request => {
      try {
        const received = await request.json();
        expect(() => {
          request.clone();
        }).toThrow();
        done();
        return new Response(JSON.stringify({}), {
          headers: {
            "Content-type": "application/json",
          },
        });
      } catch (err) {
        done(err);
      }
    });
    await requestServer({
      method: "POST",
      body: JSON.stringify(data),
      headers: {
        "Content-type": "application/json",
      },
    });
  });
  it("cant clone created reader", async done => {
    const data = {
      message: "Hello world",
    };
    await startServer(async request => {
      try {
        request.body.getReader();
        expect(() => {
          request.clone();
        }).toThrow();
        done();
        return new Response(JSON.stringify({}), {
          headers: {
            "Content-type": "application/json",
          },
        });
      } catch (err) {
        done(err);
      }
    });
    await requestServer({
      method: "POST",
      body: JSON.stringify(data),
      headers: {
        "Content-type": "application/json",
      },
    });
  });
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

  it("can use reader with clone", async done => {
    const data = {
      message: "Hello from bun using a reader",
    };
    await startServer(async request => {
      try {
        const clone = request.clone();

        const reader = request.body.getReader();
        const content = await readerToArray(reader);
        const parsed = JSON.parse(Buffer.from(content).toString());
        expect(parsed).toEqual(data);
        expect(await clone.json()).toEqual(data);
        done();
        return new Response(JSON.stringify({}), {
          headers: {
            "Content-type": "application/json",
          },
        });
      } catch (err) {
        done(err);
      }
    });
    await requestServer({
      method: "POST",
      body: JSON.stringify(data),
      headers: {
        "Content-type": "application/json",
      },
    });
  });
  it("can use multiple readers", async done => {
    const data = {
      message: "Hello from bun using a reader",
    };
    await startServer(async request => {
      try {
        const clone = request.clone();
        const clone2 = clone.clone();
        const reader = request.body.getReader();
        const reader2 = clone.body.getReader();
        const reader3 = clone2.body.getReader();
        const contents = await Promise.all([readerToArray(reader), readerToArray(reader2), readerToArray(reader3)]);
        for (const entry of contents) {
          expect(JSON.parse(Buffer.from(entry))).toEqual(data);
        }
        done();
        return new Response(JSON.stringify({}), {
          headers: {
            "Content-type": "application/json",
          },
        });
      } catch (err) {
        done(err);
      }
    });
    await requestServer({
      method: "POST",
      body: JSON.stringify(data),
      headers: {
        "Content-type": "application/json",
      },
    });
  });
  it("can handle big requests", async done => {
    const data = "this is a very very very very long request".repeat(100000);
    const b = Buffer.from(data);
    const dataArray = new Uint8Array(b);
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
    await startServer(async request => {
      try {
        const clone1 = request.clone();
        const clone2 = request.clone();
        const clone3 = request.clone();
        const readers = [request, clone1, clone2].map(e => e.body.getReader());
        const initialData = await Promise.all(readers.map(e => e.read()));

        for (const id of initialData) {
          expect(id.done).toBe(false);
          expect(id.value).toBeDefined();
          expect(id.value.length).not.toEqual(dataArray.length);
        }
        const final = await readerToArray(initialData[0].value, readers[0]);
        expect((await readers[0].read()).done).toBe(true);
        const arrayBuffer = await clone3.arrayBuffer();
        expect(final).toBeDefined();
        expect(final).toEqual(dataArray);
        expect(arrayBuffer).toEqual(b.buffer.slice());
        done();
        return new Response(JSON.stringify({}), {
          headers: {
            "Content-type": "application/json",
          },
        });
      } catch (err) {
        done(err);
      }
    });
    await requestServer({
      method: "POST",
      body: dataArray,
      headers: {
        "Content-type": "application/octet-stream",
      },
    });
  });

  it("handles client abort signal", async done => {
    const data = "TEST";
    await startServer(async req => {
      const clone = req.clone();
      const reader = clone.body;
      await sleep(1500);
      const out = await Bun.readableStreamToArrayBuffer(reader);
      expect(Buffer.from(out).toString()).toEqual(data);
      done();
      return new Response("HELLOO");
    });

    const controller = new AbortController();
    const signal = controller.signal;

    const res = fetch(`http://${server.hostname}:${server.port}`, { signal, body: data, method: "POST" }).catch(err => {
      expect(err.name).toEqual("AbortError");
    });
    await sleep(500);
    controller.abort();
  });
});
describe("response body cloning", () => {
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
  class WrappedStream {
    constructor() {
      this.chunks = [];
    }
    getStream() {
      if (!this.stream) {
        this.stream = new WritableStream({
          write: chunk => {
            this.chunks.push(chunk);
          },
          close: controller => {
            const totalLength = this.chunks.reduce((acc, arr) => acc + arr.length, 0);

            const result = Buffer.alloc(totalLength);

            let offset = 0;
            for (const uint8Array of this.chunks) {
              result.set(uint8Array, offset);
              offset += uint8Array.length;
            }
            if (this.promise) {
              this.promise(result);
              this.promise = null;
            }
          },
        });
      }
      return this.stream;
    }
    getResult() {
      return new Promise(resolve => {
        this.promise = resolve;
      });
    }
  }
  it("can use pipe", async () => {
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
    const stream = new WrappedStream();
    clone.body.pipeTo(stream.getStream());

    const [out, out2] = await Promise.all([res.arrayBuffer(), stream.getResult()]);
    expect(out).toEqual(b);
    expect(out2).toEqual(data);
  });
  it("can use pipeThrough", async () => {
    class WrappedStream {
      getStream() {
        if (!this.stream) {
          this.stream = new WritableStream({
            write: chunk => {
              if (this.cb) this.cb(chunk);
            },
            close: controller => {
              if (this.end) this.end();
            },
          });
        }
        return this.stream;
      }
      setCallback(cb) {
        this.cb = cb;
      }
      setOnEnd(end) {
        this.end = end;
      }
    }
    class Transformer {
      constructor() {
        this.stream = new WrappedStream();

        this.readable = new ReadableStream({
          start: controller => {
            controller.enqueue(Buffer.from("Pre-Text"));
            this.stream.setCallback(chunk => {
              controller.enqueue(chunk);
            });
            this.stream.setOnEnd(res => {
              controller.enqueue(Buffer.from("Post-Text"));
              controller.close();
            });
          },
        });
        this.writable = this.stream.getStream();
      }
    }

    const data = Buffer.from("this is a very long stream response".repeat(20000), "utf-8");
    await startServer(async request => {
      return new Response(data, {
        headers: {
          "Content-type": "application/octet-stream",
        },
      });
    });
    const res = await requestServer();
    const b = data.buffer.slice();
    const clone = res.clone();
    const secondClone = clone.clone();
    const r = await (await clone.body).pipeThrough(new Transformer());
    const r2 = await (await secondClone.body).pipeThrough(new Transformer());
    const out = Buffer.from(await Bun.readableStreamToArrayBuffer(r2)).toString();
    const out2 = Buffer.from(await Bun.readableStreamToArrayBuffer(r)).toString();
    const text = await res.text();
    expect(out2).toEqual("Pre-Text" + data.toString() + "Post-Text");
    expect(out).toEqual("Pre-Text" + data.toString() + "Post-Text");
    expect(text).toEqual(data.toString());
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
    const dataArray = Buffer.from(data);
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
    const body3 = clone2.body;
    const body2 = clone.body;
    const body1 = res.body;

    const [b, c, array_buf, text] = await Promise.all([
      Bun.readableStreamToArrayBuffer(body2),
      Bun.readableStreamToArrayBuffer(body3),
      arrayBufferClone.arrayBuffer(),
      textClone.text(),
    ]);
    const ref = await Bun.readableStreamToArrayBuffer(body1);
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
