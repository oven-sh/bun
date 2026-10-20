// For bun-serve-date.test.ts. Holds one idle socket, and nothing else that could turn the event
// loop: no timer and no other handle. The test is the peer of that socket. It marks the start
// and the end of an idle time with one event each on the socket, and this process prints how
// many times its loop turned from the one to the other.
//
//   bun bun-serve-date-idle-fixture.ts <kind> [port]
//
// tcp, tls: a client socket to the listener that the test runs on [port]. The events are the
//   bytes "s" and "e" from the listener.
// serve: a Bun.serve connection. The port is printed first, and the test is the client. The
//   events are the requests /start and /end on one connection.
import { getEventLoopStats } from "bun:internal-for-testing";

const [kind, port] = [process.argv[2], Number(process.argv[3])];

let before = 0;
function start() {
  before = getEventLoopStats().iteration;
}
function end() {
  console.log(JSON.stringify({ iterations: getEventLoopStats().iteration - before }));
}

if (kind === "serve") {
  const server = Bun.serve({
    port: 0,
    // The connection has to outlive the idle time.
    idleTimeout: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/start") start();
      if (pathname === "/end") end();
      return new Response("ok");
    },
  });
  console.log(server.port);
} else {
  await Bun.connect({
    hostname: "127.0.0.1",
    port,
    tls: kind === "tls" ? { rejectUnauthorized: false } : undefined,
    socket: {
      data(_, chunk) {
        const event = chunk.toString();
        if (event === "s") start();
        if (event === "e") {
          end();
          process.exit(0);
        }
      },
      close() {
        console.error("the listener closed the connection");
        process.exit(1);
      },
      error(_, error) {
        console.error(error);
        process.exit(1);
      },
    },
  });
}
