// fetch() finds the `ca` list of a `tls` option again by the strings it was read from, without reading them. This
// gives it options whose certificates changed in every way that JS can change them, and prints what each request
// made of the server's certificate: "ok", or the code it failed with.
import { tls as validTls, tempDir } from "harness";
import { join } from "node:path";
import tls from "node:tls";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

// The server's certificate is its own CA.
const trusted = validTls.cert;
// A CA that did not issue it.
const other = tls.rootCertificates[0] + "\n";

async function outcome(url: string, options: Bun.TLSOptions) {
  return fetch(url, { tls: options, keepalive: false }).then(
    response => response.text(),
    error => String(error.code),
  );
}

if (!isMainThread) {
  parentPort!.postMessage(await outcome(workerData.url, { ca: workerData.ca }));
  // Stays alive until the parent terminates it.
  await new Promise(() => {});
}

using server = Bun.serve({ port: 0, tls: validTls, fetch: () => new Response("ok") });
const url = `https://localhost:${server.port}/`;
const request = (options: Bun.TLSOptions) => outcome(url, options);
const results: Record<string, unknown> = {};

{
  const ca = [other];
  const options = { ca };
  const outcomes = [await request(options)];
  ca[0] = trusted;
  outcomes.push(await request(options));
  ca[0] = other;
  outcomes.push(await request(options));
  ca.push(trusted);
  outcomes.push(await request(options));
  ca.length = 1;
  outcomes.push(await request(options));
  options.ca = [trusted];
  outcomes.push(await request(options));
  results["the same array and object with other strings"] = outcomes;
}

{
  const outcomes = [];
  for (const text of [trusted, other, trusted]) {
    // A string of its own each time.
    outcomes.push(await request({ ca: [Buffer.from(text).toString()] }));
    outcomes.push(await request({ ca: Buffer.from(text).toString() }));
  }
  results["equal text in new strings"] = outcomes;
}

{
  const buffer = Buffer.alloc(Math.max(trusted.length, other.length) + 1);
  const outcomes = [];
  for (const text of [trusted, other, trusted]) {
    buffer.fill(0);
    buffer.write(text);
    outcomes.push(await request({ ca: [buffer] }));
  }
  results["the same Buffer with other bytes"] = outcomes;
}

{
  using dir = tempDir("fetch-tls-ca-again", { a: { "ca.pem": trusted }, b: { "ca.pem": other } });
  const file = join(String(dir), "a", "ca.pem");
  const outcomes = [await request({ ca: Bun.file(file) })];
  await Bun.write(file, other);
  outcomes.push(await request({ ca: Bun.file(file) }));
  await Bun.write(file, trusted);
  outcomes.push(await request({ ca: [Bun.file(file)] }));
  results["the same file with other contents"] = outcomes;

  const cwd = process.cwd();
  const relative = [];
  for (const name of ["a", "b", "a"]) {
    process.chdir(join(String(dir), name));
    relative.push(await request({ caFile: "ca.pem" }));
  }
  process.chdir(cwd);
  results["a relative caFile from another directory"] = relative;
}

{
  const options = { ca: [other] };
  const outcomes = [await request(options)];
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  outcomes.push(await request(options));
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  outcomes.push(await request(options));
  results["NODE_TLS_REJECT_UNAUTHORIZED set and unset"] = outcomes;
}

{
  // Speaks TLS 1.2 with one cipher suite.
  const picky = tls.createServer(
    { ...validTls, maxVersion: "TLSv1.2", ciphers: "ECDHE-RSA-AES128-GCM-SHA256" },
    socket => {
      socket.on("error", () => {});
      socket.on("data", () => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"));
    },
  );
  await new Promise<void>(resolve => picky.listen(0, "127.0.0.1", resolve));
  const pickyUrl = `https://127.0.0.1:${(picky.address() as import("node:net").AddressInfo).port}/`;
  const options = { ca: [trusted] };
  const defaults = tls.DEFAULT_CIPHERS;
  const outcomes = [await outcome(pickyUrl, options)];
  tls.DEFAULT_CIPHERS = "ECDHE-RSA-AES256-GCM-SHA384";
  outcomes.push((await outcome(pickyUrl, options)) === "ok" ? "ok" : "no common cipher");
  tls.DEFAULT_CIPHERS = defaults;
  outcomes.push(await outcome(pickyUrl, options));
  picky.close();
  results["tls.DEFAULT_CIPHERS assigned and restored"] = outcomes;
}

for (const count of [2, 5, 61]) {
  // More lists than fetch() remembers, and than the HTTP thread keeps contexts for. Every second one trusts the
  // server.
  const lists = Array.from({ length: count }, (_, i) => [`${i % 2 ? other : trusted}# ${i}\n`]);
  const rounds = [];
  for (let round = 0; round < 2; round++) {
    const outcomes = await Promise.all(lists.map(ca => request({ ca })));
    rounds.push(outcomes.filter((outcome, i) => outcome === (i % 2 ? "DEPTH_ZERO_SELF_SIGNED_CERT" : "ok")).length);
  }
  results[`${count} lists in turn, as expected`] = rounds;
}

{
  const ca = [other, trusted];
  const outcomes = [await request({ ca })];
  const worker = new Worker(import.meta.filename, { workerData: { url, ca } });
  outcomes.push(await new Promise(resolve => worker.once("message", resolve)));
  await worker.terminate();
  outcomes.push(await request({ ca }), await request({ ca: [other] }));
  results["a list that a terminated Worker used"] = outcomes;
}

console.log(JSON.stringify(results, null, 2));
