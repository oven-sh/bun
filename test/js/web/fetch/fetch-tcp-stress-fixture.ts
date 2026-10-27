// Fixture for fetch-tcp-stress.test.ts.
//
// Sends fetch() requests, one batch at a time, to a TCP server in this process.
// The server answers each request with 10 bytes that fetch() does not parse,
// and then closes the socket the way argv says. Prints one JSON line with what
// it counted.
//
// argv: <afterWrite> <afterFetch> <batches> <batchSize> <deadline>
//   afterWrite: the Socket method the server calls once its answer is written
//   afterFetch: the Socket method it calls once the fetch has settled, or "none"
//   deadline: a run still going this many ms after the process started prints
//     the counts it has and exits
import { getMaxFD } from "harness";

type CloseMethod = "end" | "shutdown" | "terminate";
type SocketData = { request: string; read?: boolean; written?: boolean };

const [afterWrite, afterFetch] = process.argv.slice(2) as [CloseMethod, CloseMethod | "none"];
const [batches, batchSize, deadline] = process.argv.slice(4).map(Number);

// fetch() waits for 16 bytes before it parses a response head.
const answer = "200 OK\r\nCo";
const marker = "--BYTEMARKER: ";
const requests = Array.from({ length: batchSize }, (_, i) => ({
  method: "POST",
  body: marker + (10 + i) + " ",
  keepalive: false,
}));

const report = {
  // How each fetch() settled: the `code` of its rejection, or "fulfilled".
  fetches: {} as Record<string, number>,
  // Requests the server received whole, each with the body fetch() was given.
  served: 0,
  closed: 0,
  // `error` callbacks of the server's sockets, and requests it did not expect.
  serverErrors: [] as string[],
  maxFD: { afterFirstBatch: -1, atEnd: -1 },
};

// For a state the run cannot continue from, and for the deadline.
function bail(): never {
  console.log(JSON.stringify(report));
  process.exit(1);
}
const watchdog = setTimeout(bail, deadline - performance.now()).unref();

let sockets: Bun.Socket<SocketData>[] = [];
let toClose = 0;
let pendingClose = Promise.withResolvers<void>();

function writeAnswer(socket: Bun.Socket<SocketData>) {
  if (socket.write(answer) === answer.length) {
    socket.data.written = true;
    socket[afterWrite]();
  }
}

const server = Bun.listen<SocketData>({
  port: 0,
  socket: {
    open(socket) {
      socket.data = { request: "" };
    },
    data(socket, data) {
      const state = socket.data;
      state.request += new TextDecoder().decode(data);
      // TCP can deliver one request in several pieces: wait for all of its body.
      const head = state.request.indexOf("\r\n\r\n");
      if (head === -1) return;
      const body = state.request.slice(head + 4);
      if (body.length < Number(/\r\nContent-Length: (\d+)\r\n/i.exec(state.request)?.[1])) return;

      const i = parseInt(body.slice(marker.length)) - 10;
      if (state.read || sockets[i] !== undefined || body !== requests[i]?.body) {
        report.serverErrors.push(`unexpected request: ${JSON.stringify(state.request)}`);
        bail();
      }
      report.served++;
      state.read = true;
      sockets[i] = socket;
      writeAnswer(socket);
    },
    drain(socket) {
      if (!socket.data.read || socket.data.written) {
        return;
      }

      writeAnswer(socket);
    },
    error(socket, err) {
      report.serverErrors.push(String(err));
      bail();
    },
    timeout() {},
    close(socket) {
      report.closed++;
      toClose--;
      if (toClose === 0) {
        pendingClose.resolve();
      }
    },
  },
  hostname: "127.0.0.1",
});

for (let done = 0; done < batches; done++) {
  pendingClose = Promise.withResolvers();
  toClose = batchSize;
  const settled = await Promise.allSettled(
    requests.map((request, i) =>
      fetch(`http://127.0.0.1:${server.port}`, request).finally(() => {
        if (afterFetch !== "none") sockets[i]?.[afterFetch]();
      }),
    ),
  );
  for (const result of settled) {
    const how = result.status === "fulfilled" ? "fulfilled" : String(result.reason?.code ?? result.reason);
    report.fetches[how] = (report.fetches[how] ?? 0) + 1;
  }
  // No `close` comes for a fetch that settled before the server had its request.
  if (report.served !== (done + 1) * batchSize) bail();

  await pendingClose.promise;
  sockets = [];

  if (done === 0) {
    report.maxFD.afterFirstBatch = getMaxFD();
  }
}
server.stop(true);
report.maxFD.atEnd = getMaxFD();
clearTimeout(watchdog);
console.log(JSON.stringify(report));
