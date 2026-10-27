// An accessor on the caller's `ca` array closes the endpoint while native
// listen() or connect() reads its options. With its types removed, this file
// prints the same on Node v26.3.0 built with QUIC (--experimental-quic, and
// --expose-internals for the "state" mode).
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, QuicEndpoint } from "node:quic";

const [mode, keysDir] = process.argv.slice(2);
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));
const ca = readFileSync(join(keysDir, "ca1-cert.pem"));
const sni = { "*": { keys: [key], certs: [cert] } };
const transportParams = { maxIdleTimeout: 1 };
const clientOptions = { alpn: "quic-test", verifyPeer: "manual", transportParams };

// Element 0 runs `action` on its second read. The first read is the
// validation in JS, the second is the copy in native code.
function onNativeRead(value, action) {
  const array = [value];
  let reads = 0;
  Object.defineProperty(array, 0, {
    enumerable: true,
    get() {
      if (++reads === 2) action();
      return value;
    },
  });
  return array;
}

const server = await listen(session => session.closed.catch(() => {}), { sni, alpn: ["quic-test"], transportParams });

if (mode === "state") {
  // @ts-expect-error Node's internal module, which --expose-internals makes resolvable.
  const { getQuicEndpointState } = (await import("internal/quic/quic")).default;
  // Node detaches the state when the endpoint closes, and then reads undefined.
  const state = endpoint => {
    const { isBound, isListening } = getQuicEndpointState(endpoint);
    return { isBound: !!isBound, isListening: !!isListening };
  };

  const destroyed = new QuicEndpoint();
  let inAccessor;
  const destroy = () => {
    inAccessor = state(destroyed);
    destroyed.destroy();
  };
  await listen(() => {}, { endpoint: destroyed, sni, ca: onNativeRead(ca, destroy) });
  const afterDestroy = state(destroyed);
  await destroyed.closed;

  // close() with a session open leaves the endpoint closing, not closed.
  const closing = new QuicEndpoint();
  const held = await connect(server.address!, { endpoint: closing, ...clientOptions });
  await held.opened;
  await listen(() => {}, { endpoint: closing, sni, ca: onNativeRead(ca, () => closing.close()) });
  const afterClose = state(closing);
  held.destroy();
  await closing.closed;

  console.log(JSON.stringify({ inAccessor, afterDestroy, afterClose }));
} else if (mode === "leak") {
  const endpoint = new QuicEndpoint();
  const options = { endpoint, sni, ca: onNativeRead(ca, () => endpoint.destroy()) };
  // From setImmediate: test/leaksan.supp has an entry that matches the stack
  // of a call made from the top level of a module.
  const listening = Promise.withResolvers();
  setImmediate(() => listening.resolve(listen(() => {}, options)));
  await listening.promise;
  await endpoint.closed;
  console.log("closed");
} else {
  const endpoint = new QuicEndpoint();
  let outcome;
  try {
    const session = await connect(server.address!, {
      endpoint,
      ...clientOptions,
      ca: onNativeRead(ca, () => endpoint.destroy()),
    });
    session.opened.catch(() => {});
    session.closed.catch(() => {});
    await endpoint.closed;
    // The endpoint frees its lsquic callbacks after it reports the close.
    await new Promise(resolve => setImmediate(resolve));
    session.destroy();
    outcome = "connect() returned a session";
  } catch (error: any) {
    outcome = error.code;
  }
  console.log(outcome);
}

// Not close(): that waits one idle timeout for the sessions destroyed above.
await server.destroy();
