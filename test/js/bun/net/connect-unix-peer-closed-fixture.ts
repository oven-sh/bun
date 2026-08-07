// A server that accepts, writes, and fully closes before the client's first
// event-loop turn must still deliver its data: the connect SUCCEEDED.
//
// The SEMI_SOCKET dispatch used to treat the eof/error poll hint as a failed
// connect even when SO_ERROR == 0 (fabricating ECONNRESET), discarding the
// reply. libuv keys the connect verdict on SO_ERROR alone; zero means open.
//
// AF_UNIX makes the race deterministic: connect(2) completes synchronously
// into the backlog, and sleepSync holds our loop so the server's write+exit
// (full close -> EPOLLHUP with no socket error) lands before our dispatch.
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { tmpdir } from "node:os";

const unix = join(tmpdir(), `bun-peer-closed-${process.pid}.sock`);

await using server = Bun.spawn({
  cmd: [
    bunExe(),
    "-e",
    `
      Bun.listen({
        unix: ${JSON.stringify(unix)},
        socket: {
          open(s) {
            s.write("hello");
            s.end();
            setTimeout(() => process.exit(0), 30);
          },
          data() {}, end() {}, error() {}, close() {},
        },
      });
      console.log("ready");
    `,
  ],
  env: bunEnv,
  stdout: "pipe",
});

// Wait for the listener to exist.
const reader = server.stdout.getReader();
const { value } = await reader.read();
if (!new TextDecoder().decode(value).includes("ready")) {
  console.error("server failed to start");
  process.exit(1);
}

let received = "";
let gotOpen = false;
const done = Promise.withResolvers<void>();

const connecting = Bun.connect({
  unix,
  socket: {
    open() {
      gotOpen = true;
    },
    data(_s, chunk) {
      received += chunk.toString();
    },
    end() {},
    error() {},
    close() {
      done.resolve();
    },
    connectError(_s, err) {
      console.error(`FAIL: connectError ${(err as any)?.code ?? err} for a successful connect`);
      process.exit(1);
    },
  },
});

// The unix connect itself completed synchronously inside Bun.connect. Hold the
// loop so the server's accept+write+exit lands before our first dispatch; the
// old code then saw EPOLLHUP with SO_ERROR == 0 and fabricated ECONNRESET.
Bun.sleepSync(500);

await connecting.catch(() => {}); // rejection is reported via connectError above
await done.promise;

if (!gotOpen || received !== "hello") {
  console.error(`FAIL: open=${gotOpen} received=${JSON.stringify(received)}`);
  process.exit(1);
}
console.log("ok: open + data delivered");
process.exit(0);
