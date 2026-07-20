/* globals AbortController */

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { createHash, randomFillSync } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import net from "node:net";
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

test("unresolvable hostname rejects with the resolver error", async () => {
  // A DNS label longer than 63 bytes is illegal (RFC 1035 section 2.3.4), so
  // getaddrinfo rejects it locally without touching the network. The cases,
  // each of which must name the hostname getaddrinfo actually failed on:
  //   1-3. Direct fetches: the second hits the in-process DNS cache, which
  //        used to take a different path and report a different wrong error.
  //   4.   An explicit unresolvable proxy: the error must name the proxy,
  //        not the origin, since the proxy is what gets resolved.
  //   5.   A redirect to an unresolvable host: the error must name the
  //        redirect target, not the original (resolvable) origin.
  // Runs in a subprocess with the proxy env cleared so the direct fetches
  // actually resolve their hostnames.
  const host = Buffer.alloc(64, "a").toString() + ".com";
  const proxyHost = Buffer.alloc(64, "b").toString() + ".com";
  const redirectHost = Buffer.alloc(64, "c").toString() + ".com";
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const out = [];
       const report = p => p.then(
         () => "resolved",
         ({ name, code, syscall, hostname, message }) => ({ name, code, syscall, hostname, message }),
       );
       for (let i = 0; i < 3; i++) {
         out.push(await report(fetch("http://" + ${JSON.stringify(host)} + "/")));
       }
       out.push(await report(fetch("http://origin.invalid/", { proxy: "http://" + ${JSON.stringify(proxyHost)} + ":3128" })));
       using server = Bun.serve({
         port: 0,
         fetch: () => Response.redirect("http://" + ${JSON.stringify(redirectHost)} + "/", 302),
       });
       out.push(await report(fetch(server.url)));
       console.log(JSON.stringify(out));`,
    ],
    env: {
      ...bunEnv,
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
      NO_PROXY: undefined,
      no_proxy: undefined,
    },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const notFound = (hostname: string) => ({
    name: "Error",
    code: "ENOTFOUND",
    syscall: "getaddrinfo",
    hostname,
    message: `getaddrinfo ENOTFOUND ${hostname}`,
  });
  // `out` is the raw stdout if it is not JSON (the subprocess crashed), so the
  // failure diff shows what the child actually printed alongside stderr.
  let out: unknown = stdout;
  try {
    out = JSON.parse(stdout);
  } catch {}
  expect({ out, stderr, exitCode }).toEqual({
    out: [notFound(host), notFound(host), notFound(host), notFound(proxyHost), notFound(redirectHost)],
    stderr: "",
    exitCode: 0,
  });
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

// RFC 9112 section 7.1: a zero-size chunk ("0\r\n\r\n") is the chunked-body
// terminator. A ReadableStream request body that yields an empty chunk (an
// empty read, a flush, encode("")) must not be framed as one: that ends the
// message there, silently truncating the upload and parking the rest of the
// user's bytes at request-line position on the reused keep-alive connection.
// Node emits no frame for an empty chunk; the expected wire below matches it.
test.each([
  [["AAAA", "", "BBBB"], "4\r\nAAAA\r\n4\r\nBBBB\r\n0\r\n\r\n"],
  [["", "AAAA"], "4\r\nAAAA\r\n0\r\n\r\n"],
])("an empty request body chunk %j is not framed as the chunked terminator", async (chunks, expectedWireBody) => {
  // The last non-empty chunk marks the end of the upload: respond only once
  // it and the real terminator have both arrived, so the full wire is captured.
  const lastData = chunks.filter(Boolean).at(-1)!;
  let recorded = Buffer.alloc(0);
  await using server = net
    .createServer(sock => {
      sock.on("error", () => {});
      sock.on("data", d => {
        recorded = Buffer.concat([recorded, d]);
        const raw = recorded.toString("latin1");
        if (raw.endsWith("0\r\n\r\n") && raw.includes(lastData)) {
          sock.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        }
      });
    })
    .listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;

  const encoder = new TextEncoder();
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    duplex: "half",
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  });
  expect(await res.text()).toBe("ok");

  const raw = recorded.toString("latin1");
  const headers = raw.slice(0, raw.indexOf("\r\n\r\n"));
  const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
  expect({ transferEncoding: /^transfer-encoding: (.*)$/im.exec(headers)?.[1], body }).toEqual({
    transferEncoding: "chunked",
    body: expectedWireBody,
  });
});

// The same empty-chunk hazard on the other framing path: with an explicit
// Content-Length the body is sent raw, so an empty enqueue buffers nothing,
// but it still reported backpressure -- pausing the request body stream to
// wait for a drain event that can never arrive. The upload hung forever.
test("an empty request body chunk does not stall a stream body sent with an explicit Content-Length", async () => {
  let recorded = Buffer.alloc(0);
  await using server = net
    .createServer(sock => {
      sock.on("error", () => {});
      sock.on("data", d => {
        recorded = Buffer.concat([recorded, d]);
        if (recorded.toString("latin1").endsWith("AAAABBBB")) {
          sock.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        }
      });
    })
    .listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;

  const encoder = new TextEncoder();
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    duplex: "half",
    headers: { "content-length": "8" },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of ["AAAA", "", "BBBB"]) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  });
  expect(await res.text()).toBe("ok");
  const raw = recorded.toString("latin1");
  expect(raw.slice(raw.indexOf("\r\n\r\n") + 4)).toBe("AAAABBBB");
});

// RFC 9112 section 5.2: an obs-fold continuation line in a response must be
// joined into the preceding field value with SP, or the message rejected.
// Accepting it while silently discarding the continuation is neither: it
// corrupts the value ("Set-Cookie: sid=1;" CRLF " Secure; HttpOnly" used to
// surface as "sid=1;") and, for a folded Transfer-Encoding / Content-Length,
// changes the framing this client applies to the body. Node's fetch rejects
// such responses; so does Bun now.
test("a response with an obs-fold header continuation is rejected, not silently truncated", async () => {
  await using server = net
    .createServer(sock => {
      sock.on("error", () => {});
      sock.on("data", () => {
        sock.end("HTTP/1.1 200 OK\r\nSet-Cookie: sid=1;\r\n Secure; HttpOnly\r\nContent-Length: 2\r\n\r\nok");
      });
    })
    .listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;

  const outcome = await fetch(`http://127.0.0.1:${port}/`).then(
    // On a regression this records the truncated Set-Cookie the bug produced.
    r => ({ rejected: false as const, setCookie: r.headers.get("set-cookie") }),
    e => ({ rejected: true as const, code: e.code }),
  );
  expect(outcome).toEqual({ rejected: true, code: "Malformed_HTTP_Response" });
});
