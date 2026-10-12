// Fixture for s3-stream-error-gc.test.ts. An S3 stream whose download failed before anything read
// it holds the failure. It used to read as a complete, empty object instead.
//
// Run it with no S3 credentials and no proxy in the environment, in a scratch directory.
//
// argv[2]:
//   "stored"    the download fails inside stream() (no credentials), so no timing is involved.
//               Prints what every consumer and sink of such a stream got.
//   "download"  the download fails on the wire: a body cut short, a key that does not exist, a
//               key that is denied. Prints what a read that starts after the failure got.
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import net from "node:net";
import path from "node:path";

type Body = ReadableStream<Uint8Array>;

function outcome<T>(promise: Promise<T>, resolved: (value: T) => string): Promise<string> {
  return promise.then(resolved, (error: { code?: string; name?: string }) => `rejected ${error.code ?? error.name}`);
}

async function count(stream: Body) {
  let bytes = 0;
  for await (const chunk of stream) bytes += chunk.length;
  return bytes;
}

async function stored() {
  const failed = (): Body => new Bun.S3Client({}).file("source").stream();
  const results: Record<string, unknown> = {};

  const readers: Record<string, (stream: Body) => Promise<number>> = {
    "for await": count,
    "getReader().read()": async stream => {
      const { done, value } = await stream.getReader().read();
      return done ? 0 : value.length;
    },
    "pipeTo()": async stream => {
      let bytes = 0;
      await stream.pipeTo(
        new WritableStream({
          write(chunk) {
            bytes += chunk.length;
          },
        }),
      );
      return bytes;
    },
    "tee()": stream => count(stream.tee()[0]),
    "new Response(stream).bytes()": async stream => (await new Response(stream).bytes()).length,
    "new Response(stream).blob()": async stream => (await new Response(stream).blob()).size,
    "Bun.write(path, new Response(stream))": stream => Bun.write(path.resolve("out.bin"), new Response(stream)),
  };
  for (const [name, read] of Object.entries(readers)) {
    results[name] = await outcome(read(failed()), bytes => `resolved ${bytes} bytes`);
  }

  // A copy into S3. The write used to resolve and store an empty object under the key.
  const puts: string[] = [];
  const bucket = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      puts.push(`${request.method} ${new URL(request.url).pathname} ${(await request.bytes()).length} bytes`);
      return new Response("", { headers: { ETag: '"etag"' } });
    },
  });
  const client = new Bun.S3Client({
    endpoint: `http://127.0.0.1:${bucket.port}`,
    accessKeyId: "id",
    secretAccessKey: "secret",
    bucket: "bucket",
  });
  results["client.write(key, new Response(stream))"] = await outcome(
    client.write("copy", new Response(failed())),
    bytes => `resolved ${bytes} bytes`,
  );
  results["Bun.write(s3file, new Response(stream))"] = await outcome(
    Bun.write(client.file("copy"), new Response(failed())),
    bytes => `resolved ${bytes} bytes`,
  );
  // Waits for requests in flight, so a PUT that went out is counted.
  await bucket.stop();
  results["requests the bucket got"] = puts;

  // An upload. The request used to go out as a complete POST with `Content-Length: 0`.
  let completeRequests = 0;
  const receiver = net.createServer(socket => {
    let received = "";
    socket.on("error", () => {});
    socket.on("data", chunk => {
      received += chunk.toString("latin1");
      const headEnd = received.indexOf("\r\n\r\n");
      if (headEnd < 0) return;
      const length = /^content-length: *(\d+)/im.exec(received.slice(0, headEnd))?.[1];
      const body = received.slice(headEnd + 4);
      if (length !== undefined ? body.length >= Number(length) : body.endsWith("0\r\n\r\n")) {
        completeRequests++;
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      }
    });
  });
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  results["fetch(url, { method: 'POST', body: stream })"] = await outcome(
    fetch(`http://127.0.0.1:${(receiver.address() as AddressInfo).port}/`, { method: "POST", body: failed() }),
    response => `resolved ${response.status}`,
  );
  // Waits for the connection to end, so a request that completed is counted.
  receiver.close();
  await once(receiver, "close");
  results["complete requests the receiver got"] = completeRequests;

  // A response body. It used to go out as a complete `200` with no body.
  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    error: (error: Error & { code?: string }) => new Response(`error() got ${error.code}`, { status: 500 }),
    fetch: () => new Response(failed()),
  });
  const served = await fetch(`http://127.0.0.1:${server.port}/`);
  results["Bun.serve: return new Response(stream)"] = `${served.status} ${await served.text()}`;

  return results;
}

async function download() {
  const error = (status: string, code: string) => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${code}</Message></Error>`;
    return `HTTP/1.1 ${status}\r\nContent-Type: application/xml\r\nContent-Length: ${xml.length}\r\nConnection: close\r\n\r\n${xml}`;
  };
  // The bucket closes the connection behind every answer.
  const answers: Record<string, string> = {
    // Announces 100 bytes and sends 50.
    cut: `HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n${Buffer.alloc(50, "x").toString()}`,
    missing: error("404 Not Found", "NoSuchKey"),
    denied: error("403 Forbidden", "AccessDenied"),
    ping: "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\npong",
  };
  const closed: Record<string, PromiseWithResolvers<void>> = {};
  for (const key of Object.keys(answers)) closed[key] = Promise.withResolvers<void>();

  const bucket = net.createServer(socket => {
    socket.on("error", () => {});
    socket.once("data", request => {
      const key = /^GET \/bucket\/(\w+)/.exec(request.toString("latin1"))![1];
      socket.on("close", () => closed[key].resolve());
      socket.end(answers[key]);
    });
  });
  bucket.listen(0, "127.0.0.1");
  await once(bucket, "listening");
  const endpoint = `http://127.0.0.1:${(bucket.address() as AddressInfo).port}`;
  const client = new Bun.S3Client({ endpoint, accessKeyId: "id", secretAccessKey: "secret", bucket: "bucket" });

  const results: Record<string, string> = {};
  for (const key of ["cut", "missing", "denied"]) {
    const stream: Body = client.file(key).stream();
    // The client closes its end only after it has seen the whole answer, so once the connection
    // is closed the failure is on its way to this thread. A round trip through the same HTTP
    // thread arrives behind it.
    await closed[key].promise;
    await (await fetch(`${endpoint}/bucket/ping`)).text();
    results[key] = await outcome(count(stream), bytes => `resolved ${bytes} bytes`);
  }
  bucket.close();
  return results;
}

console.log(JSON.stringify(await (process.argv[2] === "stored" ? stored() : download()), null, 2));
