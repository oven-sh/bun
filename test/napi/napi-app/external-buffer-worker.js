const { parentPort } = require("node:worker_threads");
const nativeTests = require("./build/Debug/napitests.node");

// The buffers belong to this worker's env: when the worker exits, the env's
// teardown runs their finalizers and frees the bytes. Transferring them to the
// parent would hand it bytes that are about to be freed, so that is refused and
// the parent gets copies instead.
const arrayBuffer = nativeTests.create_external_arraybuffer_for_transfer(4);
const buffer = nativeTests.create_external_buffer_for_transfer(4);
const copies = { arraybuffer: Array.from(new Uint8Array(arrayBuffer)), buffer: Array.from(buffer) };

const transfers = {};
for (const [kind, ab] of [
  ["arraybuffer", arrayBuffer],
  ["buffer", buffer.buffer],
]) {
  try {
    parentPort.postMessage({ kind, ab }, [ab]);
    transfers[kind] = "transferred";
  } catch (e) {
    transfers[kind] = `${e.name} code=${e.code}`;
  }
  transfers[`${kind}ByteLength`] = ab.byteLength;
}
parentPort.postMessage({ transfers, copies, stats: nativeTests.external_for_transfer_stats() });

// Still referenced when the worker exits, so the env's teardown (not GC) is
// what finalizes them.
globalThis.keep = [arrayBuffer, buffer];
