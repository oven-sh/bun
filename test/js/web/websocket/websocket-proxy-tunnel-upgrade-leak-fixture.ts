// Repro for HTTPUpgradeClient leak on wss:// through an HTTP CONNECT proxy
// (tunnel mode). The tunnel-mode success branch in processResponse() took
// `outgoing_websocket` without releasing the ref that paired with C++'s
// `m_upgradeClient`. C++ nulls `m_upgradeClient` inside didConnectWithTunnel()
// and therefore never calls cancel() to drop it, so when the socket finally
// closed, handleClose's single deref left the struct at refcount 1 forever.
//
// The wss:// endpoint and CONNECT proxy run in the parent test process so this
// subprocess stays as small as possible (debug+ASAN subprocess startup is the
// dominant cost). After each `onopen` we signal the parent over IPC; the parent
// tears down the proxy's client socket, which drives the upgrade client's
// handleEnd/handleClose path — the same sequencing the original in-process
// fixture used.
//
// Runs under BUN_DEBUG_alloc=1 so the test can count
//   new(…NewHTTPUpgradeClient(…))   vs   destroy(…NewHTTPUpgradeClient(…))
// emitted by `bun.new`/`bun.destroy` on debug builds.

const wssPort = Number(process.env.WSS_PORT);
const proxyPort = Number(process.env.PROXY_PORT);

async function roundTrip() {
  const ws = new WebSocket(`wss://127.0.0.1:${wssPort}/`, {
    // @ts-ignore Bun-specific options
    tls: { rejectUnauthorized: false },
    proxy: `http://127.0.0.1:${proxyPort}`,
  });
  const opened = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  let didOpen = false;
  ws.onopen = () => {
    didOpen = true;
    opened.resolve();
  };
  ws.onclose = ev => {
    if (!didOpen) opened.reject(new Error(`closed before open: ${ev.code} ${ev.reason}`));
    closed.resolve();
  };
  // Errors are expected once the parent hard-closes the proxy socket; onclose
  // still fires.
  ws.onerror = () => {};
  await opened.promise;
  // Tunnel-mode upgrade has completed (state == .done). Ask the parent to
  // tear down the proxy connection so handleEnd/handleClose run on the
  // upgrade client.
  process.send!("open");
  await closed.promise;
}

for (let i = 0; i < 2; i++) {
  await roundTrip();
}

// JS `onclose` fires from inside the upgrade client's handleClose(), before
// that function's trailing deref runs. Yield to the event loop so the final
// destroy is emitted before we exit.
await new Promise(r => setImmediate(r));
await new Promise(r => setImmediate(r));

process.exit(0);
