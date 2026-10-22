// Lands a termination request on the native writeHead of node:http responses as
// often as it can. Spawned by node-http-uaf.test.ts with
// BUN_JSC_validateExceptionChecks=1.
//
// node:vm's `timeout` is a JSC termination deadline: a timer thread requests the
// VM's termination exactly like worker.terminate() does, and the request is
// taken at the next exception check. Native code that returns to a caller with
// no exception scope of its own, right after such a check, is where the
// validator catches a request taken in the wrong place (it aborts the
// process). Each request below is one attempt: the handler makes the call that
// writes the head under a deadline, notes whether the deadline landed before
// or after the call returned, and moves the call so that the deadline keeps
// landing around the moment the native writeHead returns. Attempts alternate
// between res.end() (handle.writeHeadAndEnd) and res.flushHeaders()
// (handle.writeHead), the two entry points of the native writeHead.
import http from "node:http";
import net from "node:net";
import vm from "node:vm";

const ATTEMPTS = Number(process.env.ATTEMPTS ?? 3000);
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 30_000);

// The run spins until `armedAt + target` (the deadline is armed shortly after
// `armedAt` is taken, so however long entering the context takes, the call
// starts a fixed time before the deadline) and then makes the call. `t`
// records how far it got: [] the deadline fired before the script started,
// [1] while spinning, [1, 2] inside the call, [1, 2, 3] the call returned
// first (the deadline is cancelled when the run completes).
const ctx = vm.createContext({
  now: () => performance.now(),
  res: null as http.ServerResponse | null,
  armedAt: 0,
  target: 0,
  t: [] as number[],
});
const run = (call: string) =>
  new vm.Script(`t.push(1); { const u = armedAt + target; while (now() < u); } t.push(2); res.${call}(); t.push(3);`);
const paths = [
  { name: "end", script: run("end") },
  { name: "flushHeaders", script: run("flushHeaders") },
].map(path => ({ ...path, target: 0, step: 0.1, lastDirection: 0, early: 0, inCall: 0, late: 0, cutAfterHead: 0 }));

let timeout = 2;
let firedBeforeScript = 0;
let attempts = 0;
const started = performance.now();

const server = http.createServer((req, res) => {
  const path = paths[attempts++ % paths.length];
  // Every response is a bare header block, so the client can tell where one
  // response ends whichever of the two calls wrote it.
  res.setHeader("content-length", "0");
  ctx.res = res;
  ctx.target = path.target;
  ctx.t.length = 0;
  ctx.armedAt = performance.now();
  try {
    path.script.runInContext(ctx, { timeout });
  } catch (e) {
    // The deadline cut the run short. Anything else is a real failure of the
    // call under test: let it take the process down.
    if ((e as NodeJS.ErrnoException)?.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw e;
  }
  ctx.res = null;

  if (ctx.t.length === 0) {
    // Entering the context alone outlived the deadline: a slow machine. Give
    // the runs more time.
    if (++firedBeforeScript % 20 === 0 && timeout < 20) {
      timeout++;
      for (const p of paths) p.target++;
    }
  } else {
    // end() sets `finished` right after its native call returns, so it tells
    // "after the call" more precisely than the script's own last marker.
    const late = ctx.t.length === 3 || res.finished;
    if (late) path.late++;
    else if (ctx.t.length === 2) path.inCall++;
    else path.early++;
    // The call returned before the deadline: start it later next time, and
    // the other way round. Once the target has crossed the deadline for the
    // first time, hunt around it in small steps.
    const direction = late ? 1 : -1;
    if (path.lastDirection !== 0 && direction !== path.lastDirection) path.step = 0.02;
    path.lastDirection = direction;
    path.target = Math.max(0, path.target + direction * path.step);
  }

  // Whatever state the run left the response in, complete it outside the
  // deadline. The one state in which that fails is a cut that landed after the
  // native writeHead had put the head on the wire but before JS recorded it:
  // end() then reports the head as already sent. Drop that connection, the
  // client reconnects. Any other error is a real failure.
  if (!res.finished) {
    try {
      res.end();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "ERR_HTTP_HEADERS_SENT" && code !== "ERR_STREAM_ALREADY_FINISHED") throw e;
      path.cutAfterHead++;
      req.socket.destroy();
    }
  }
});

server.listen(0, "127.0.0.1", () => {
  const port = (server.address() as net.AddressInfo).port;
  const request = "GET / HTTP/1.1\r\nHost: a\r\n\r\n";

  function done() {
    const summary = {
      attempts,
      timeout,
      paths: paths.map(({ name, early, inCall, late, cutAfterHead }) => ({ name, early, inCall, late, cutAfterHead })),
    };
    console.log(JSON.stringify(summary));
    process.exit(0);
  }

  function connect() {
    if (attempts >= ATTEMPTS || performance.now() - started > BUDGET_MS) return done();
    const socket = net.connect(port, "127.0.0.1");
    let buffered = "";
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      socket.write(request);
      // A response that never comes (the server dropped this connection, or a
      // cut run left it half written) must not stall the loop.
      watchdog = setTimeout(() => socket.destroy(), 2_000);
    };
    socket.setEncoding("latin1");
    socket.on("connect", send);
    socket.on("data", chunk => {
      buffered += chunk;
      // One request is in flight at a time, so a status line followed by the
      // end of a header block is the whole response to it; anything else that
      // trickles in is discarded along with it.
      if (!buffered.includes("HTTP/1.") || !buffered.includes("\r\n\r\n")) return;
      buffered = "";
      clearTimeout(watchdog);
      if (attempts >= ATTEMPTS || performance.now() - started > BUDGET_MS) return done();
      send();
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(watchdog);
      connect();
    });
  }
  connect();
});
