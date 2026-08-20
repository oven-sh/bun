// A socket closed from its own data handler must survive a nested event loop
// run from that same handler.
//
// us_socket_close() only unlinks the socket and queues it on the loop's closed
// list. loop.c frees that list in us_internal_loop_post(), and the dispatch
// frame that called the data handler still reads the socket after the handler
// returns (us_internal_socket_follow_adopted, us_socket_is_closed, and for TLS
// the ssl_retry_parked_write tail of us_internal_ssl_on_data). The free has to
// wait for the outermost loop turn. epoll/kqueue defer it with tick_depth; the
// libuv backend (Windows) ran loop_post from every nested uv_run, so the
// nested loop below freed the socket under the outer dispatch frame.
//
// The nested loop comes from Bun.build(): it waits synchronously for a
// plugin's async setup() and ticks the event loop while it waits. Each hop of
// the setup promise needs a loop turn of its own, so the close is fully
// processed (poll closed, and without the fix the memory freed) before the
// data handler returns.
//
// Everything after the data handler is driven from setImmediate: the nested
// loop also runs this file's pending continuations, so a plain await on the
// close event would resume inside the nested loop, before the handler returns.
//
// Run as: fixture tcp | fixture tls. The tls mode takes the certificate from
// FIXTURE_TLS_CERT / FIXTURE_TLS_KEY (importing it from harness costs more
// startup time in a debug build than the rest of this file).
import { join } from "node:path";

const mode = process.argv[2];
if (mode !== "tcp" && mode !== "tls") {
  console.error(`usage: ${process.argv[1]} tcp|tls`);
  process.exit(2);
}
const { FIXTURE_TLS_CERT: cert = "", FIXTURE_TLS_KEY: key = "" } = process.env;
if (mode === "tls" && !(cert && key)) {
  console.error("tls mode needs FIXTURE_TLS_CERT and FIXTURE_TLS_KEY");
  process.exit(2);
}

const NESTED_TURNS = 20;
const entry = join(import.meta.dir, "socket-close-in-nested-loop-virtual-entry.ts");
const builds: Promise<unknown>[] = [];

// Returns once setup() has settled, i.e. after `turns` nested loop turns.
function runNestedEventLoop(turns: number): number {
  let hops = 0;
  builds.push(
    Bun.build({
      entrypoints: [entry],
      files: { [entry]: "export {};" },
      plugins: [
        {
          name: "nested-event-loop",
          setup() {
            return new Promise<void>(resolve => {
              const hop = () => {
                if (++hops >= turns) resolve();
                else setTimeout(hop, 1);
              };
              setTimeout(hop, 1);
            });
          },
        },
      ],
    }),
  );
  return hops;
}

const watchdog = setTimeout(() => {
  console.error(`timed out waiting for the ${mode} client's data handler`);
  process.exit(1);
}, 30_000);

const server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  tls: mode === "tls" ? { cert, key } : undefined,
  socket: {
    open(socket) {
      socket.write("hello from server");
    },
    data() {},
    error() {},
    close() {},
  },
});

const handlerReturned = Promise.withResolvers<number>();
let dataCalls = 0;

await Bun.connect({
  hostname: "127.0.0.1",
  port: server.port,
  tls: mode === "tls" ? { ca: cert, serverName: "localhost" } : undefined,
  socket: {
    open(socket) {
      // Under TLS this is written before the handshake finishes, so the SSL
      // layer parks it and retries it from the tail of us_internal_ssl_on_data:
      // the read of the socket that the nested loop used to free.
      socket.write("hello from client");
    },
    data(socket) {
      if (dataCalls++ > 0) return;
      socket.terminate();
      const turns = runNestedEventLoop(NESTED_TURNS);
      setImmediate(() => handlerReturned.resolve(turns));
    },
    close() {},
    error(_socket, error) {
      handlerReturned.reject(error);
    },
    connectError(_socket, error) {
      handlerReturned.reject(error);
    },
  },
});

const turns = await handlerReturned.promise;
await Promise.allSettled(builds);
server.stop(true);
clearTimeout(watchdog);

if (turns < NESTED_TURNS) {
  console.error(`expected ${NESTED_TURNS} nested loop turns inside the data handler, got ${turns}`);
  process.exit(1);
}
console.log("ok");
