/* globals AbortController */

import { expect, test } from "bun:test";
import { createHash, randomFillSync } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { promisify } from "node:util";
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
  const server = createServer((req, res) => {}).listen(0);
  try {
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
    ).rejects.toThrow();
  } finally {
    server.closeAllConnections();
  }
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
  ).rejects.toThrow();
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

test.todo("multipart formdata base64", async () => {
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

test.todo("formData with BOM", async () => {
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
    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
      expect(body).toBe("asd");
      if (count++ === 0) {
        res.setHeader("location", "asd");
        res.statusCode = 302;
        res.end();
      } else {
        res.end(String(count));
      }
    });
  }).listen(0);
  await once(server, "listening");

  const res = await fetch(`http://localhost:${server.address().port}`, {
    method: "PUT",
    body: "asd",
  });
  expect(await res.text()).toBe("2");
});

test("redirect with stream", async () => {
  const location = "/asd";
  const body = "hello!";
  await using server = createServer(async (req, res) => {
    res.writeHead(302, { location });
    let count = 0;
    const l = setInterval(() => {
      res.write(body[count++]);
      if (count === body.length) {
        res.end();
        clearInterval(l);
      }
    }, 50);
  }).listen(0);

  await once(server, "listening");

  const res = await fetch(`http://localhost:${server.address().port}`, {
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(location);
  expect(await res.text()).toBe(body);
});

test("fail to extract locked body", () => {
  const stream = new ReadableStream({});
  const reader = stream.getReader();
  try {
    // eslint-disable-next-line
    new Response(stream);
  } catch (err) {
    expect((err as Error).name).toBe("TypeError");
  }
  reader.cancel();
});

test("fail to extract locked body", () => {
  const stream = new ReadableStream({});
  const reader = stream.getReader();
  try {
    // eslint-disable-next-line
    new Request("http://asd", {
      method: "PUT",
      body: stream,
      keepalive: true,
    });
  } catch (err) {
    expect((err as Error).message).toBe("keepalive");
  }
  reader.cancel();
});

test("post FormData with Blob", async () => {
  const body = new FormData();
  body.append("field1", new Blob(["asd1"]));

  await using server = createServer((req, res) => {
    req.pipe(res);
  }).listen(0);
  await once(server, "listening");

  const res = await fetch(`http://localhost:${server.address().port}`, {
    method: "PUT",
    body,
  });
  expect(/asd1/.test(await res.text())).toBeTruthy();
});

test("post FormData with File", async () => {
  const body = new FormData();
  body.append("field1", new File(["asd1"], "filename123"));

  await using server = createServer((req, res) => {
    req.pipe(res);
  }).listen(0);
  await once(server, "listening");

  const res = await fetch(`http://localhost:${server.address().port}`, {
    method: "PUT",
    body,
  });
  const result = await res.text();
  expect(/asd1/.test(result)).toBeTrue();
  expect(/filename123/.test(result)).toBeTrue();
});

test("invalid url", async () => {
  try {
    await fetch("http://invalid");
  } catch (e) {
    expect(e.message).toBe("Unable to connect. Is the computer able to access the url?");
  }
});

test("do not decode redirect body", async () => {
  const obj = { asd: true };
  await using server = createServer((req, res) => {
    if (req.url === "/resource") {
      res.statusCode = 301;
      res.setHeader("location", "/resource/");
      // Some dumb http servers set the content-encoding gzip
      // even if there is no response
      res.setHeader("content-encoding", "gzip");
      res.end();
      return;
    }
    res.setHeader("content-encoding", "gzip");
    res.end(gzipSync(JSON.stringify(obj)));
  }).listen(0);
  await once(server, "listening");
  const body = await fetch(`http://localhost:${server.address().port}/resource`);
  expect(JSON.stringify(obj)).toBe(await body.text());
});

test("decode non-redirect body with location header", async () => {
  const obj = { asd: true };
  await using server = createServer((req, res) => {
    res.statusCode = 201;
    res.setHeader("location", "/resource/");
    res.setHeader("content-encoding", "gzip");
    res.end(gzipSync(JSON.stringify(obj)));
  }).listen(0);
  await once(server, "listening");

  const body = await fetch(`http://localhost:${server.address().port}/resource`);
  expect(JSON.stringify(obj)).toBe(await body.text());
});

test("error on redirect", async () => {
  await using server = createServer((req, res) => {
    res.statusCode = 302;
    res.end();
  }).listen(0);
  await once(server, "listening");

  expect(
    fetch(`http://localhost:${server.address().port}`, {
      redirect: "error",
    }),
  ).rejects.toThrow(/UnexpectedRedirect/);
});

test("Receiving non-Latin1 headers", async () => {
  const ContentDisposition = [
    "inline; filename=rock&roll.png",
    "inline; filename=\"rock'n'roll.png\"",
    "inline; filename=\"image â\x80\x94 copy (1).png\"; filename*=UTF-8''image%20%E2%80%94%20copy%20(1).png",
    "inline; filename=\"_å\x9C\x96ç\x89\x87_ð\x9F\x96¼_image_.png\"; filename*=UTF-8''_%E5%9C%96%E7%89%87_%F0%9F%96%BC_image_.png",
    "inline; filename=\"100 % loading&perf.png\"; filename*=UTF-8''100%20%25%20loading%26perf.png",
  ];

  await using server = createServer((req, res) => {
    for (let i = 0; i < ContentDisposition.length; i++) {
      res.setHeader(`Content-Disposition-${i + 1}`, ContentDisposition[i]);
    }

    res.end();
  }).listen(0);
  await once(server, "listening");

  const url = `http://localhost:${server.address().port}`;
  const response = await fetch(url, { method: "HEAD" });
  const cdHeaders = [...response.headers].filter(([k]) => k.startsWith("content-disposition")).map(([, v]) => v);
  const lengths = cdHeaders.map(h => h.length);

  expect(cdHeaders).toEqual(ContentDisposition);
  expect(lengths).toEqual([30, 34, 94, 104, 90]);
});

// https://github.com/nodejs/undici/issues/1527
test("fetching with Request object - issue #1527", async () => {
  const server = createServer((req, res) => {
    res.end();
  }).listen(0);
  try {
    await once(server, "listening");

    const body = JSON.stringify({ foo: "bar" });
    const request = new Request(`http://localhost:${server.address().port}`, {
      method: "POST",
      body,
    });

    expect(await fetch(request)).resolves.pass();
  } finally {
    server.closeAllConnections();
  }
});
