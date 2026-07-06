import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

/**
 * Speaks HTTP/1.1 over a raw socket so nothing between the server and the
 * assertion can synthesize a header. Sends `Connection: close` so the server
 * ends the response by closing, which resolves the promise.
 */
async function rawRequest(
  port: number,
  method: string,
  path: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ statusLine: string; headers: [string, string][] }> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const extra = Object.entries(extraHeaders)
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join("");
  const request = `${method} ${path} HTTP/1.1\r\nHost: localhost\r\n${extra}Connection: close\r\n\r\n`;

  let buffer = "";
  await Bun.connect({
    hostname: "127.0.0.1",
    port,
    socket: {
      open(socket) {
        socket.write(request);
      },
      data(_socket, chunk) {
        buffer += chunk.toString("latin1");
      },
      close() {
        resolve(buffer);
      },
      error(_socket, error) {
        reject(error);
      },
      connectError(_socket, error) {
        reject(error);
      },
    },
  });

  const [statusLine, ...lines] = (await promise).split("\r\n\r\n")[0].split("\r\n");
  const headers = lines.map(line => {
    const colon = line.indexOf(":");
    return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()] as [string, string];
  });
  return { statusLine, headers };
}

const dateValues = (headers: [string, string][]) => headers.filter(([name]) => name === "date").map(([, v]) => v);

test("Date header is not updated every request", async () => {
  const twoSecondsAgo = new Date(Date.now() - 2 * 1000);
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK");
    },
  });

  // Make multiple requests in quick succession
  const responses = await Promise.all([
    fetch(server.url),
    fetch(server.url),
    fetch(server.url),
    fetch(server.url),
    fetch(server.url),
  ]);

  // All responses should have the same Date header since they were made within the same second
  const dates = responses.map(r => r.headers.get("Date"));
  const uniqueDates = new Set(dates);

  // Should only have 1 unique date value since all requests were made rapidly
  expect(uniqueDates.size).toBe(1);
  expect(dates[0]).toBeTruthy();

  for (const delay of [250, 250, 250, 250, 250]) {
    await Bun.sleep(delay);
    const laterResponses = await Promise.all([
      fetch(server.url),
      fetch(server.url),
      fetch(server.url),
      fetch(server.url),
      fetch(server.url),
    ]);
    const laterDates = laterResponses.map(r => r.headers.get("Date"));
    const laterUniqueDates = new Set(laterDates);
    expect(laterUniqueDates.size).toBe(1);
    uniqueDates.add([...laterUniqueDates][0]);
  }

  // There should only really be two, but I don't trust timers to be SUPER accurate.
  expect(uniqueDates.size).toBeLessThan(4);

  for (const date of [...uniqueDates]) {
    const d = new Date(date!);
    const stamp = d.getTime();
    expect(Number.isFinite(stamp)).toBe(true);
    expect(stamp).toBeGreaterThan(0);
    expect(stamp).toBeGreaterThan(twoSecondsAgo.getTime());
    expect(stamp).toBeLessThan(Date.now() + 100);
  }
});

// RFC 9110 6.6.1: an origin server with a clock MUST send Date on every
// 2xx/3xx/4xx response. The bodiless paths (HEAD, 304, redirects, bare 404s)
// used to skip it because they never reached the code that stamps it.
test("Date header is sent on responses with no body", async () => {
  using dir = tempDir("serve-date", { "file.txt": "FILEBODY" });

  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    development: false,
    routes: {
      "/static": new Response("STATICBODY", { headers: { etag: '"tag-1"' } }),
      "/file": new Response(Bun.file(join(String(dir), "file.txt"))),
      "/handler": () => new Response("HANDLERBODY"),
      "/empty": () => new Response(null),
      "/redirect": () => Response.redirect("/static", 302),
      "/stream": () => new Response(new ReadableStream({ start: c => c.close() })),
    },
    fetch(request) {
      if (new URL(request.url).pathname === "/missing") return new Response("nope", { status: 404 });
      return new Response("fallback");
    },
  });

  const cases: Array<[string, string, string, Record<string, string>?]> = [
    ["GET", "/static", "HTTP/1.1 200 OK"],
    ["HEAD", "/static", "HTTP/1.1 200 OK"],
    ["GET", "/static", "HTTP/1.1 304 Not Modified", { "If-None-Match": '"tag-1"' }],
    ["HEAD", "/file", "HTTP/1.1 200 OK"],
    ["GET", "/handler", "HTTP/1.1 200 OK"],
    ["HEAD", "/handler", "HTTP/1.1 200 OK"],
    ["HEAD", "/empty", "HTTP/1.1 200 OK"],
    ["HEAD", "/redirect", "HTTP/1.1 302 Found"],
    ["HEAD", "/stream", "HTTP/1.1 200 OK"],
    ["HEAD", "/missing", "HTTP/1.1 404 Not Found"],
    ["HEAD", "/fallback", "HTTP/1.1 200 OK"],
  ];

  const results = [];
  for (const [method, path, , extraHeaders] of cases) {
    const { statusLine, headers } = await rawRequest(server.port, method, path, extraHeaders);
    results.push({ request: `${method} ${path}`, statusLine, dates: dateValues(headers) });
  }

  expect(results.map(({ request, statusLine, dates }) => ({ request, statusLine, dateCount: dates.length }))).toEqual(
    cases.map(([method, path, statusLine]) => ({ request: `${method} ${path}`, statusLine, dateCount: 1 })),
  );

  // The stamped value is a real HTTP-date, not an empty or garbage header.
  for (const { dates } of results) {
    expect(Date.parse(dates[0])).toBeGreaterThan(Date.now() - 60_000);
  }
});

// RFC 9110 9.3.2: the server sends the same header fields for HEAD as it would
// for GET. In particular the implicit Content-Type derived from the body, which
// HEAD used to report as application/octet-stream for everything. `/stream` is
// excluded: a streamed GET can buffer into a Content-Length HEAD cannot know.
test("HEAD sends the same headers as GET", async () => {
  using dir = tempDir("serve-date-head", { "pic.png": "\x89PNG\r\n\x1a\n" });
  const picture = join(String(dir), "pic.png");

  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    development: false,
    routes: {
      "/static": new Response("STATICBODY", { headers: { etag: '"tag-1"' } }),
      "/file-route": new Response(Bun.file(picture)),
      // The content type of these three is carried by the body, not by the
      // Response's headers, so only the body-derived lookup can find it.
      "/handler-text": () => new Response("HANDLERBODY"),
      "/handler-file": () => new Response(Bun.file(picture)),
      "/handler-blob": () => new Response(new Blob(["hi"], { type: "text/x-custom" })),
      "/json": () => Response.json({ hello: "world" }),
      "/empty": () => new Response(null),
      "/redirect": () => Response.redirect("/static", 302),
    },
    fetch(request) {
      if (new URL(request.url).pathname === "/missing") return new Response("nope", { status: 404 });
      return new Response("fallback");
    },
  });

  // Date is dropped from the comparison: its value ticks once a second, so GET
  // and HEAD can legitimately disagree. Its presence is asserted above.
  const withoutDate = (headers: [string, string][]) =>
    Object.fromEntries(headers.filter(([name]) => name !== "date").sort());

  const paths = [
    "/static",
    "/file-route",
    "/handler-text",
    "/handler-file",
    "/handler-blob",
    "/json",
    "/empty",
    "/redirect",
    "/missing",
    "/fallback",
  ];

  for (const path of paths) {
    const get = await rawRequest(server.port, "GET", path);
    const head = await rawRequest(server.port, "HEAD", path);

    expect({ path, status: head.statusLine, headers: withoutDate(head.headers) }).toEqual({
      path,
      status: get.statusLine,
      headers: withoutDate(get.headers),
    });
  }

  // Pin the derived types, so a future change that makes GET and HEAD agree on
  // the wrong value still fails.
  const contentTypeOf = async (path: string) =>
    Object.fromEntries((await rawRequest(server.port, "HEAD", path)).headers)["content-type"];
  expect({
    text: await contentTypeOf("/handler-text"),
    file: await contentTypeOf("/handler-file"),
    blob: await contentTypeOf("/handler-blob"),
  }).toEqual({
    text: "text/plain;charset=utf-8",
    file: "image/png",
    blob: "text/x-custom",
  });
});

// A Date the handler set wins; the server must not append a second one.
test("a user-supplied Date header is not duplicated", async () => {
  using dir = tempDir("serve-date-user", { "file.txt": "FILEBODY" });
  const date = "Mon, 01 Jan 2024 00:00:00 GMT";

  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    development: false,
    routes: {
      "/static": new Response("STATICBODY", { headers: { date } }),
      "/file": new Response(Bun.file(join(String(dir), "file.txt")), { headers: { date } }),
      "/handler": () => new Response("HANDLERBODY", { headers: { date } }),
    },
    fetch: () => new Response("fallback", { headers: { date } }),
  });

  const requests = ["/static", "/file", "/handler", "/fallback"].flatMap(path =>
    ["GET", "HEAD"].map(method => ({ method, path })),
  );

  const results = [];
  for (const { method, path } of requests) {
    const { headers } = await rawRequest(server.port, method, path);
    results.push({ request: `${method} ${path}`, dates: dateValues(headers) });
  }

  expect(results).toEqual(requests.map(({ method, path }) => ({ request: `${method} ${path}`, dates: [date] })));
});
