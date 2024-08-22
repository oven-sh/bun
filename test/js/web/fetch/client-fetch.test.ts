/* globals AbortController */

import { test, expect, describe } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { randomFillSync, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

test("function signature", () => {
  expect(fetch.name).toBe("fetch");
  expect(fetch.length).toBe(1);
});

test("args validation", async () => {
  expect(fetch()).rejects.toThrow(TypeError);
  expect(fetch("ftp://unsupported")).rejects.toThrow(TypeError);
});

test("request json", async () => {
  const obj = { asd: true };
  await using server = createServer((req, res) => {
    res.end(JSON.stringify(obj));
  }).listen(0);
  await once(server, "listening");

  const body = await fetch(`http://localhost:${server.address().port}`);
  expect(obj).toEqual(await body.json());
});

test("request text", async () => {
  const obj = { asd: true };
  await using server = createServer((req, res) => {
    res.end(JSON.stringify(obj));
  }).listen(0);
  await once(server, "listening");

  const body = await fetch(`http://localhost:${server.address().port}`);
  expect(JSON.stringify(obj)).toEqual(await body.text());
});

test("request arrayBuffer", async () => {
  const obj = { asd: true };
  await using server = createServer((req, res) => {
    res.end(JSON.stringify(obj));
  }).listen(0);
  await once(server, "listening");

  const body = await fetch(`http://localhost:${server.address().port}`);
  expect(Buffer.from(JSON.stringify(obj))).toEqual(Buffer.from(await body.arrayBuffer()));
});

test("should set type of blob object to the value of the `Content-Type` header from response", async () => {
  const obj = { asd: true };
  await using server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
  }).listen(0);
  await once(server, "listening");

  const response = await fetch(`http://localhost:${server.address().port}`);
  expect("application/json;charset=utf-8").toBe((await response.blob()).type);
});

test("pre aborted with readable request body", async () => {
  await using server = createServer((req, res) => {}).listen(0);
  await once(server, "listening");

  const ac = new AbortController();
  ac.abort();
  expect(
    fetch(`http://localhost:${server.address().port}`, {
      signal: ac.signal,
      method: "POST",
      body: new ReadableStream({
        async cancel(reason) {
          expect(reason.name).toBe("AbortError");
        },
      }),
      duplex: "half",
    }),
  ).rejects.toThrow("The operation was aborted");
});

test("pre aborted with closed readable request body", async () => {
  await using server = createServer((req, res) => {}).listen(0);
  await once(server, "listening");
  const ac = new AbortController();
  ac.abort();
  const body = new ReadableStream({
    async start(c) {
      expect(true).toBe(true);
      c.close();
    },
    async cancel(reason) {
      expect.unreachable();
    },
  });

  expect(
    fetch(`http://localhost:${server.address().port}`, {
      signal: ac.signal,
      method: "POST",
      body,
      duplex: "half",
    }),
  ).rejects.toThrow("The operation was aborted");
});

test("unsupported formData 1", async () => {
  await using server = createServer((req, res) => {
    res.setHeader("content-type", "asdasdsad");
    res.end();
  }).listen(0);
  await once(server, "listening");
  expect(fetch(`http://localhost:${server.address().port}`).then(res => res.formData())).rejects.toThrow(TypeError);
});

test("multipart formdata not base64", async () => {
  // Construct example form data, with text and blob fields
  const formData = new FormData();
  formData.append("field1", "value1");
  const blob = new Blob(["example\ntext file"], { type: "text/plain" });
  formData.append("field2", blob, "file.txt");

  const tempRes = new Response(formData);
  const boundary = tempRes.headers.get("content-type").split("boundary=")[1];
  const formRaw = await tempRes.text();

  await using server = createServer((req, res) => {
    res.setHeader("content-type", "multipart/form-data; boundary=" + boundary);
    res.write(formRaw);
    res.end();
  });
  const listen = promisify(server.listen.bind(server));
  await listen(0);
  const res = await fetch(`http://localhost:${server.address().port}`);
  const form = await res.formData();
  expect(form.get("field1")).toBe("value1");

  const text = await form.get("field2").text();
  expect(text).toBe("example\ntext file");
});

test("multipart formdata base64", async () => {
  // Example form data with base64 encoding
  const data = randomFillSync(Buffer.alloc(256));
  const formRaw =
    "------formdata-bun-0.5786922755719377\r\n" +
    'Content-Disposition: form-data; name="file"; filename="test.txt"\r\n' +
    "Content-Type: application/octet-stream\r\n" +
    "Content-Transfer-Encoding: base64\r\n" +
    "\r\n" +
    data.toString("base64") +
    "\r\n" +
    "------formdata-bun-0.5786922755719377--";

  await using server = createServer(async (req, res) => {
    res.setHeader("content-type", "multipart/form-data; boundary=----formdata-bun-0.5786922755719377");

    for (let offset = 0; offset < formRaw.length; ) {
      res.write(formRaw.slice(offset, (offset += 2)));
      await new Promise(resolve => setTimeout(resolve));
    }
    res.end();
  }).listen(0);
  await once(server, "listening");

  const digest = await fetch(`http://localhost:${server.address().port}`)
    .then(res => res.formData())
    .then(form => form.get("file").arrayBuffer())
    .then(buffer => createHash("sha256").update(Buffer.from(buffer)).digest("base64"));
  expect(createHash("sha256").update(data).digest("base64")).toBe(digest);
});

test("multipart fromdata non-ascii filed names", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    headers: {
      "Content-Type": "multipart/form-data; boundary=----formdata-undici-0.6204674738279623",
    },
    body:
      "------formdata-undici-0.6204674738279623\r\n" +
      'Content-Disposition: form-data; name="fiŝo"\r\n' +
      "\r\n" +
      "value1\r\n" +
      "------formdata-undici-0.6204674738279623--",
  });

  const form = await request.formData();
  expect(form.get("fiŝo")).toBe("value1");
});

test("busboy emit error", async () => {
  const formData = new FormData();
  formData.append("field1", "value1");

  const tempRes = new Response(formData);
  const formRaw = await tempRes.text();

  await using server = createServer((req, res) => {
    res.setHeader("content-type", "multipart/form-data; boundary=wrongboundary");
    res.write(formRaw);
    res.end();
  });

  const listen = promisify(server.listen.bind(server));
  await listen(0);

  const res = await fetch(`http://localhost:${server.address().port}`);
  expect(res.formData()).rejects.toThrow("FormData parse error missing final boundary");
});

// https://github.com/nodejs/undici/issues/2244
test("parsing formData preserve full path on files", async () => {
  const formData = new FormData();
  formData.append("field1", new File(["foo"], "a/b/c/foo.txt"));

  const tempRes = new Response(formData);
  const form = await tempRes.formData();

  expect(form.get("field1").name).toBe("a/b/c/foo.txt");
});

test("urlencoded formData", async () => {
  await using server = createServer((req, res) => {
    res.setHeader("content-type", "application/x-www-form-urlencoded");
    res.end("field1=value1&field2=value2");
  }).listen(0);
  await once(server, "listening");

  const formData = await fetch(`http://localhost:${server.address().port}`).then(res => res.formData());
  expect(formData.get("field1")).toBe("value1");
  expect(formData.get("field2")).toBe("value2");
});

test("text with BOM", async () => {
  await using server = createServer((req, res) => {
    res.setHeader("content-type", "application/x-www-form-urlencoded");
    res.end("\uFEFFtest=\uFEFF");
  }).listen(0);
  await once(server, "listening");

  const text = await fetch(`http://localhost:${server.address().port}`).then(res => res.text());
  expect(text).toBe("test=\uFEFF");
});

test("formData with BOM", async () => {
  await using server = createServer((req, res) => {
    res.setHeader("content-type", "application/x-www-form-urlencoded");
    res.end("\uFEFFtest=\uFEFF");
  }).listen(0);
  await once(server, "listening");

  const formData = await fetch(`http://localhost:${server.address().port}`).then(res => res.formData());
  expect(formData.get("\uFEFFtest")).toBe("\uFEFF");
});

test("locked blob body", async () => {
  await using server = createServer((req, res) => {
    res.end();
  }).listen(0);
  await once(server, "listening");

  const res = await fetch(`http://localhost:${server.address().port}`);
  const reader = res.body.getReader();
  expect(res.blob()).rejects.toThrow("ReadableStream is locked");
  reader.cancel();
});

test("disturbed blob body", async () => {
  await using server = createServer((req, res) => {
    res.end();
  }).listen(0);
  await once(server, "listening");

  const res = await fetch(`http://localhost:${server.address().port}`);
  await res.blob();
  expect(res.blob()).rejects.toThrow("Body already used");
});

test("redirect with body", async () => {
  let count = 0;
  await using server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }
    expect(body).toBe("asd");
    if (count++ === 0) {
      res.setHeader("location", "asd");
      res.statusCode = 302;
      res.end();
    } else {
      res.end(String(count));
    }
  }).listen(0);
  await once(server, "listening");

  const res = await fetch(`http://localhost:${server.address().port}`, {
    method: "PUT",
    body: "asd",
  });
  expect(await res.text()).toBe("2");
});

// test("redirect with stream", (t, done) => {
//   const { strictEqual } = tspl(t, { plan: 3 });

//   const location = "/asd";
//   const body = "hello!";
//   const server = createServer(async (req, res) => {
//     res.writeHead(302, { location });
//     let count = 0;
//     const l = setInterval(() => {
//       res.write(body[count++]);
//       if (count === body.length) {
//         res.end();
//         clearInterval(l);
//       }
//     }, 50);
//   });
//   t.after(closeServerAsPromise(server));

//   server.listen(0, async () => {
//     const res = await fetch(`http://localhost:${server.address().port}`, {
//       redirect: "manual",
//     });
//     strictEqual(res.status, 302);
//     strictEqual(res.headers.get("location"), location);
//     strictEqual(await res.text(), body);
//     done();
//   });
// });

// test("fail to extract locked body", t => {
//   const { strictEqual } = tspl(t, { plan: 1 });

//   const stream = new ReadableStream({});
//   const reader = stream.getReader();
//   try {
//     // eslint-disable-next-line
//     new Response(stream);
//   } catch (err) {
//     strictEqual(err.name, "TypeError");
//   }
//   reader.cancel();
// });

// test("fail to extract locked body", t => {
//   const { strictEqual } = tspl(t, { plan: 1 });

//   const stream = new ReadableStream({});
//   const reader = stream.getReader();
//   try {
//     // eslint-disable-next-line
//     new Request("http://asd", {
//       method: "PUT",
//       body: stream,
//       keepalive: true,
//     });
//   } catch (err) {
//     strictEqual(err.message, "keepalive");
//   }
//   reader.cancel();
// });

// test("post FormData with Blob", (t, done) => {
//   const { ok } = tspl(t, { plan: 1 });

//   const body = new FormData();
//   body.append("field1", new Blob(["asd1"]));

//   const server = createServer((req, res) => {
//     req.pipe(res);
//   });
//   t.after(closeServerAsPromise(server));

//   server.listen(0, async () => {
//     const res = await fetch(`http://localhost:${server.address().port}`, {
//       method: "PUT",
//       body,
//     });
//     ok(/asd1/.test(await res.text()));
//     done();
//   });
// });

// test("post FormData with File", (t, done) => {
//   const { ok } = tspl(t, { plan: 2 });

//   const body = new FormData();
//   body.append("field1", new File(["asd1"], "filename123"));

//   const server = createServer((req, res) => {
//     req.pipe(res);
//   });
//   t.after(closeServerAsPromise(server));

//   server.listen(0, async () => {
//     const res = await fetch(`http://localhost:${server.address().port}`, {
//       method: "PUT",
//       body,
//     });
//     const result = await res.text();
//     ok(/asd1/.test(result));
//     ok(/filename123/.test(result));
//     done();
//   });
// });

// test("invalid url", async t => {
//   const { match } = tspl(t, { plan: 1 });

//   try {
//     await fetch("http://invalid");
//   } catch (e) {
//     match(e.cause.message, /invalid/);
//   }
// });

// test("custom agent", (t, done) => {
//   const { ok, deepStrictEqual } = tspl(t, { plan: 2 });

//   const obj = { asd: true };
//   const server = createServer((req, res) => {
//     res.end(JSON.stringify(obj));
//   });
//   t.after(closeServerAsPromise(server));

//   server.listen(0, async () => {
//     const dispatcher = new Client("http://localhost:" + server.address().port, {
//       keepAliveTimeout: 1,
//       keepAliveMaxTimeout: 1,
//     });
//     const oldDispatch = dispatcher.dispatch;
//     dispatcher.dispatch = function (options, handler) {
//       ok(true);
//       return oldDispatch.call(this, options, handler);
//     };
//     const body = await fetch(`http://localhost:${server.address().port}`, {
//       dispatcher,
//     });
//     deepStrictEqual(obj, await body.json());
//     done();
//   });
// });

// test("custom agent node fetch", (t, done) => {
//   const { ok, deepStrictEqual } = tspl(t, { plan: 2 });

//   const obj = { asd: true };
//   const server = createServer((req, res) => {
//     res.end(JSON.stringify(obj));
//   });
//   t.after(closeServerAsPromise(server));

//   server.listen(0, async () => {
//     const dispatcher = new Client("http://localhost:" + server.address().port, {
//       keepAliveTimeout: 1,
//       keepAliveMaxTimeout: 1,
//     });
//     const oldDispatch = dispatcher.dispatch;
//     dispatcher.dispatch = function (options, handler) {
//       ok(true);
//       return oldDispatch.call(this, options, handler);
//     };
//     const body = await nodeFetch.fetch(`http://localhost:${server.address().port}`, {
//       dispatcher,
//     });
//     deepStrictEqual(obj, await body.json());
//     done();
//   });
// });

// test("error on redirect", (t, done) => {
//   const server = createServer((req, res) => {
//     res.statusCode = 302;
//     res.end();
//   });
//   t.after(closeServerAsPromise(server));

//   server.listen(0, async () => {
//     const errorCause = await fetch(`http://localhost:${server.address().port}`, {
//       redirect: "error",
//     }).catch(e => e.cause);

//     assert.strictEqual(errorCause.message, "unexpected redirect");
//     done();
//   });
// });

// // https://github.com/nodejs/undici/issues/1527
// test("fetching with Request object - issue #1527", async t => {
//   const server = createServer((req, res) => {
//     assert.ok(true);
//     res.end();
//   }).listen(0);

//   t.after(closeServerAsPromise(server));
//   await once(server, "listening");

//   const body = JSON.stringify({ foo: "bar" });
//   const request = new Request(`http://localhost:${server.address().port}`, {
//     method: "POST",
//     body,
//   });

//   await assert.doesNotReject(fetch(request));
// });

// test("do not decode redirect body", (t, done) => {
//   const { ok, strictEqual } = tspl(t, { plan: 3 });

//   const obj = { asd: true };
//   const server = createServer((req, res) => {
//     if (req.url === "/resource") {
//       ok(true);
//       res.statusCode = 301;
//       res.setHeader("location", "/resource/");
//       // Some dumb http servers set the content-encoding gzip
//       // even if there is no response
//       res.setHeader("content-encoding", "gzip");
//       res.end();
//       return;
//     }
//     ok(true);
//     res.setHeader("content-encoding", "gzip");
//     res.end(gzipSync(JSON.stringify(obj)));
//   });
//   t.after(closeServerAsPromise(server));

//   server.listen(0, async () => {
//     const body = await fetch(`http://localhost:${server.address().port}/resource`);
//     strictEqual(JSON.stringify(obj), await body.text());
//     done();
//   });
// });

// test("decode non-redirect body with location header", (t, done) => {
//   const { ok, strictEqual } = tspl(t, { plan: 2 });

//   const obj = { asd: true };
//   const server = createServer((req, res) => {
//     ok(true);
//     res.statusCode = 201;
//     res.setHeader("location", "/resource/");
//     res.setHeader("content-encoding", "gzip");
//     res.end(gzipSync(JSON.stringify(obj)));
//   });
//   t.after(closeServerAsPromise(server));

//   server.listen(0, async () => {
//     const body = await fetch(`http://localhost:${server.address().port}/resource`);
//     strictEqual(JSON.stringify(obj), await body.text());
//     done();
//   });
// });

// test("Receiving non-Latin1 headers", async t => {
//   const ContentDisposition = [
//     "inline; filename=rock&roll.png",
//     "inline; filename=\"rock'n'roll.png\"",
//     "inline; filename=\"image â\x80\x94 copy (1).png\"; filename*=UTF-8''image%20%E2%80%94%20copy%20(1).png",
//     "inline; filename=\"_å\x9C\x96ç\x89\x87_ð\x9F\x96¼_image_.png\"; filename*=UTF-8''_%E5%9C%96%E7%89%87_%F0%9F%96%BC_image_.png",
//     "inline; filename=\"100 % loading&perf.png\"; filename*=UTF-8''100%20%25%20loading%26perf.png",
//   ];

//   const server = createServer((req, res) => {
//     for (let i = 0; i < ContentDisposition.length; i++) {
//       res.setHeader(`Content-Disposition-${i + 1}`, ContentDisposition[i]);
//     }

//     res.end();
//   }).listen(0);

//   t.after(closeServerAsPromise(server));
//   await once(server, "listening");

//   const url = `http://localhost:${server.address().port}`;
//   const response = await fetch(url, { method: "HEAD" });
//   const cdHeaders = [...response.headers].filter(([k]) => k.startsWith("content-disposition")).map(([, v]) => v);
//   const lengths = cdHeaders.map(h => h.length);

//   assert.deepStrictEqual(cdHeaders, ContentDisposition);
//   assert.deepStrictEqual(lengths, [30, 34, 94, 104, 90]);
// });
