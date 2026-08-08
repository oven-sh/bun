// Repro for NewWebSocketClient(false) leak on wss:// through an HTTP CONNECT
// proxy (tunnel mode). initWithTunnel() starts the struct at ref_count=1 (the
// I/O-layer ref, analogous to the adopted-socket ref in the non-tunnel path)
// and then ws.ref() brings it to 2 for C++'s m_connectedWebSocket. Only the
// C++ ref was ever released (dispatchClose / dispatchAbruptClose / finalize);
// nothing dropped the I/O ref because tcp is .detached so handleClose() never
// fires. Every tunnel-mode connection leaked the full WebSocket client struct
// (send/receive FIFOs + deflate state + poll_ref).
//
// The wss:// endpoint and CONNECT proxy run in the parent test process so this
// subprocess stays minimal (debug+ASAN subprocess startup and the harness
// import are the dominant cost otherwise). For the terminate/abrupt close
// paths we signal the parent over IPC; the parent tears down the proxy's
// client socket and acks back so the next round-trip can't race the teardown.
//
// Runs under BUN_DEBUG_alloc=1 so the test can count
//   new(…NewWebSocketClient(…))   vs   destroy(…NewWebSocketClient(…))
// emitted by `bun.new`/`bun.destroy` on debug builds.

const wssPort = Number(process.env.WSS_PORT);
const proxyPort = Number(process.env.PROXY_PORT);

let pendingAck: (() => void) | null = null;
process.on("message", m => {
  if (m === "ack" && pendingAck) {
    const r = pendingAck;
    pendingAck = null;
    r();
  }
});
function destroyProxySockets(): Promise<void> {
  return new Promise(resolve => {
    pendingAck = resolve;
    process.send!("destroy-sockets");
  });
}

async function roundTrip(mode: "clean" | "terminate" | "abrupt") {
  const ws = new WebSocket(`wss://127.0.0.1:${wssPort}/`, {
    // @ts-ignore Bun-specific options
    tls: { rejectUnauthorized: false },
    proxy: `http://127.0.0.1:${proxyPort}`,
  });
  const opened = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  let isOpen = false;
  ws.onopen = () => {
    isOpen = true;
    opened.resolve();
  };
  ws.onclose = ev => {
    if (!isOpen) opened.reject(new Error(`closed before open: ${ev.code} ${ev.reason}`));
    closed.resolve();
  };
  ws.onerror = ev => {
    if (!isOpen) opened.reject(new Error(`error before open: ${(ev as ErrorEvent).message ?? ev.type}`));
  };
  await opened.promise;
  if (mode === "clean") {
    // Client-initiated close → sendCloseWithBody → clearData → dispatchClose.
    // The parent's wss endpoint echoes the close frame.
    ws.close();
    await closed.promise;
  } else if (mode === "terminate") {
    // C++ WebSocket::terminate() → cancel() → clearData. terminate() then
    // sets m_connectedWebSocketKind = None so the destructor's finalize()
    // never runs — cancel() must drop the C++ ref itself. On the unfixed
    // path onclose never fired, so don't block on it here; the alloc-log
    // new/destroy count still proves the leak.
    // @ts-ignore Bun-specific method
    ws.terminate();
    // Tear down the proxy side so the upgrade client's socket ref drops too,
    // and block until the parent has done so before starting the next
    // round-trip (otherwise its socket could be caught in the teardown).
    await destroyProxySockets();
    closed.promise.catch(() => {});
  } else {
    // Proxy-socket teardown → HTTPClient.handleClose → tunnel.onClose → ws.fail
    // → cancel → clearData.
    await destroyProxySockets();
    await closed.promise;
  }
}

// Exercise all three close paths; each leaked before the fix. Two iterations
// per mode so a ref-count off-by-one that cancels out across a single
// round-trip is still caught.
for (let i = 0; i < 2; i++) await roundTrip("clean");
for (let i = 0; i < 2; i++) await roundTrip("terminate");
for (let i = 0; i < 2; i++) await roundTrip("abrupt");

// dispatchClose/dispatchAbruptClose fire `onclose` from inside the ref-drop
// path; yield so the trailing deref/destroy is emitted before we exit.
await new Promise(r => setImmediate(r));
await new Promise(r => setImmediate(r));

process.exit(0);
