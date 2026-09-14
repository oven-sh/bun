// An async-rejecting fetch() routes through handle_reject -> run_error_handler.
// When error() returns a streaming Response whose producer is still pending,
// handle_reject would fall through to render_missing() and end() the uWS
// response underneath the live sink. A client abort then frees the socket and
// a later controller.close()/enqueue() reads the freed HttpResponseData
// (ASAN: heap-use-after-free in uws_res_has_responded).

import net from "node:net";
import { once } from "node:events";

let resolveStarted!: () => void;
let resumeProducer!: Promise<void>;
let resolveOutcome!: (late: string) => void;
let currentSignal!: AbortSignal;

const server = Bun.serve({
  port: 0,
  development: false,
  fetch: async req => {
    currentSignal = req.signal;
    throw new Error("boom");
  },
  error() {
    return new Response(
      new ReadableStream({
        async pull(c) {
          c.enqueue("EB");
          resolveStarted();
          // Park until the driver releases us. On the abort path the driver
          // waits for req.signal to fire (server observed the RST) before
          // releasing, so the sink is already detached by the time we resume;
          // one more event-loop turn lets the detach microtask settle.
          await resumeProducer;
          await Bun.sleep(0);
          try {
            c.enqueue("MORE");
            c.close();
            resolveOutcome("ok");
          } catch (e) {
            resolveOutcome(String((e as Error)?.message ?? e));
          }
        },
      }),
      { status: 597 },
    );
  },
});

function armRequest() {
  const started = new Promise<void>(r => (resolveStarted = r));
  let releaseProducer!: () => void;
  resumeProducer = new Promise(r => (releaseProducer = r));
  const outcome = new Promise<string>(r => (resolveOutcome = r));
  return { started, releaseProducer, outcome };
}

// Happy path: no abort, the stream must deliver both chunks.
{
  const { started, releaseProducer, outcome } = armRequest();
  const bodyP = fetch(server.url).then(r => r.text());
  await started;
  releaseProducer();
  const [body, late] = await Promise.all([bodyP, outcome]);
  if (body !== "EBMORE" || late !== "ok") {
    console.error(`happy-path body truncated: body=${JSON.stringify(body)} late=${late}`);
    process.exit(1);
  }
}

// Abort path: read the first bytes so the server has flushed the first chunk,
// then RST the socket. The server must survive and the late close must observe
// a detached controller.
const closedMsg = "Controller is already closed";
const lateCloseResults: string[] = [];
for (let i = 0; i < 3; i++) {
  const { started, releaseProducer, outcome } = armRequest();
  const s = net.connect(server.port, "127.0.0.1", () => {
    s.write("GET /x HTTP/1.1\r\nHost: x\r\n\r\n");
  });
  s.on("error", () => {});
  await once(s, "data");
  s.resetAndDestroy();
  await started;
  // Releasing before the server has processed the RST would let the late
  // enqueue land on a still-live sink (fixture flake: first iteration reports
  // "ok"). req.signal's abort event is the server-side observation point.
  if (!currentSignal.aborted) await once(currentSignal, "abort");
  releaseProducer();
  lateCloseResults.push(await outcome);
}

server.stop(true);

if (lateCloseResults.length !== 3 || !lateCloseResults.every(r => r.includes(closedMsg))) {
  console.error(`expected 3x "${closedMsg}", got: ${JSON.stringify(lateCloseResults)}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, lateCloseResults }));
