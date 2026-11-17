// The connection of a CONNECT request closes while the handler reads the body. The handler then answers.
import { tls } from "harness";

const [transport, how, answer, target] = process.argv.slice(2);
const heard: string[] = [];
const reading = Promise.withResolvers<void>();
const closed = Promise.withResolvers<void>();
let status = "";

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  tls: transport === "TLS" ? tls : undefined,
  async fetch(req) {
    if (req.method !== "CONNECT") return new Response("ok");
    req.signal.addEventListener("abort", () => heard.push("abort"));
    const text = req.text();
    reading.resolve();
    heard.push(
      await text.then(
        () => "end",
        error => error.name,
      ),
    );
    // At least 1 MiB: Linux sends it with sendfile.
    if (answer === "file") return new Response(Bun.file(process.execPath));
    if (answer === "direct stream") {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            await 1;
            controller.write("a");
            controller.end();
            await new Promise(resolve => setImmediate(resolve));
          },
        }),
      );
    }
    return new Response(
      (async function* () {
        yield "a";
        if (answer === "failing stream") throw new Error("failing stream");
        await new Promise(() => {});
      })(),
    );
  },
});

const client = await Bun.connect({
  hostname: "127.0.0.1",
  port: server.port!,
  tls: transport === "TLS" ? { ca: tls.cert } : undefined,
  socket: {
    open(socket) {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: a:1\r\nContent-Length: 1\r\n\r\n`);
    },
    data(_, data) {
      status += data.toString("latin1", 0, "HTTP/1.1 200".length - status.length);
    },
    error(_, error) {
      reading.reject(error);
    },
    close() {
      reading.reject(new Error("closed before the handler ran"));
      closed.resolve();
    },
  },
});
await reading.promise;
if (how === "FIN") client.shutdown();
else client.terminate();
await closed.promise;

const deadline = Date.now() + 2000;
while (server.pendingRequests > 0 && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
const pendingRequests = server.pendingRequests;
// Takes more turns of the event loop after the close.
const later = await fetch(server.url, { tls: { ca: tls.cert } }).then(res => res.text());

console.log(JSON.stringify({ heard, status, pendingRequests, later }));
server.stop(true);
