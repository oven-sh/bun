import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import { BroadcastChannel, isMainThread, MessageChannel, parentPort, Worker, workerData } from "node:worker_threads";

const require = createRequire(import.meta.url);
const addon = require("./build/Debug/test_external_string_lifetime.node");
const expectedStrings = [
  Buffer.alloc(4096, "x").toString(),
  Buffer.alloc(4096, "λ", "utf16le").toString("utf16le"),
];

if (!isMainThread) {
  globalThis.held = addon.make();
  let strings = held;
  parentPort.on("message", async () => {
    if (workerData.route === "gc-before-exit") {
      globalThis.held = null;
      strings = null;
      const deadline = Date.now() + 5000;
      while (addon.stats()[0] === 0 || addon.stats()[1] === 0) {
        assert.ok(Date.now() < deadline, "external strings were not collected");
        if (globalThis.Bun) Bun.gc(true);
        else globalThis.gc();
        await setImmediate();
      }
      assert.deepEqual(addon.stats(), [1, 1, 0, 0, 0]);
    }
    process.exit(0);
  });
  switch (workerData.route) {
    case "retained":
    case "gc-before-exit":
      parentPort.postMessage(null);
      break;
    case "latin1":
      parentPort.postMessage(strings[0]);
      break;
    case "utf16":
      parentPort.postMessage(strings[1]);
      break;
    case "array":
      parentPort.postMessage(strings);
      break;
    case "object":
      parentPort.postMessage({ latin1: strings[0], utf16: strings[1] });
      break;
    case "nested":
      parentPort.postMessage([0, { strings }]);
      break;
    case "map":
      parentPort.postMessage(new Map([["strings", strings]]));
      break;
    case "keys":
      parentPort.postMessage({ [strings[0]]: strings[1] });
      break;
    case "structured":
      parentPort.postMessage(structuredClone(strings));
      break;
    case "transfer": {
      const buffer = new ArrayBuffer(8);
      parentPort.postMessage({ strings, buffer }, [buffer]);
      break;
    }
    case "port":
      workerData.port.postMessage(strings);
      workerData.port.close();
      break;
    case "broadcast": {
      const channel = new BroadcastChannel(workerData.channel);
      channel.postMessage(strings);
      channel.close();
      break;
    }
    case "object-url":
      parentPort.postMessage(strings.map(name => URL.createObjectURL(new File(["body"], name))));
      break;
    default:
      throw new Error(`unknown route ${workerData.route}`);
  }
} else if (process.argv[2] === "copy-cost") {
  const { BunString_crossThreadCopyBytes: copyBytes } = require("bun:internal-for-testing");
  globalThis.held = addon.make();
  assert.equal(copyBytes(held[0]), 4096);
  assert.equal(copyBytes(held[1]), 4096);
  const cloned = structuredClone(held);
  assert.equal(copyBytes(cloned[0]), 0);
  assert.equal(copyBytes(cloned[1]), 0);
  assert.equal(copyBytes(expectedStrings[0]), 0);
  assert.equal(copyBytes(expectedStrings[1]), 0);
  assert.equal(copyBytes(expectedStrings[0], true), 0);
  assert.equal(copyBytes(expectedStrings[1], true), 0);
  console.log("latin1=4096 utf16=4096 received=0 ordinary=0 unrelated=0");
} else {
  const mode = process.argv[2];
  const route = process.argv[3];
  const ports = route === "port" ? new MessageChannel() : null;
  const channel = route === "broadcast" ? new BroadcastChannel(`external-strings-${process.pid}`) : null;
  let resolveMessage, rejectMessage;
  const message = new Promise((resolve, reject) => {
    resolveMessage = resolve;
    rejectMessage = reject;
  });
  if (ports) {
    ports.port1.once("message", resolveMessage);
    ports.port1.once("messageerror", rejectMessage);
  }
  if (channel) {
    channel.onmessage = event => resolveMessage(event.data);
    channel.onmessageerror = rejectMessage;
  }
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { route, port: ports?.port2, channel: channel?.name },
    transferList: ports ? [ports.port2] : [],
  });
  if (!ports && !channel) worker.once("message", resolveMessage);
  worker.once("messageerror", rejectMessage);
  const exited = new Promise((resolve, reject) => {
    worker.once("exit", resolve);
    worker.once("error", reject);
  });
  try {
    const data = await Promise.race([
      message,
      exited.then(code => {
        throw new Error(`early exit ${code}`);
      }),
    ]);
    if (mode === "terminate") assert.equal(await worker.terminate(), 1);
    else {
      worker.postMessage("exit");
      assert.equal(await exited, 0);
    }
    switch (route) {
      case "retained":
      case "gc-before-exit":
        assert.equal(data, null);
        break;
      case "latin1":
        assert.equal(data, expectedStrings[0]);
        break;
      case "utf16":
        assert.equal(data, expectedStrings[1]);
        break;
      case "object":
        assert.deepEqual([data.latin1, data.utf16], expectedStrings);
        break;
      case "nested":
        assert.deepEqual(data[1].strings, expectedStrings);
        break;
      case "map":
        assert.deepEqual(data.get("strings"), expectedStrings);
        break;
      case "keys":
        assert.deepEqual([Object.keys(data)[0], Object.values(data)[0]], expectedStrings);
        break;
      case "transfer":
        assert.equal(data.buffer.byteLength, 8);
        assert.deepEqual(data.strings, expectedStrings);
        break;
      case "object-url": {
        const { resolveObjectURL } = require("node:buffer");
        try {
          const files = data.map(resolveObjectURL);
          assert.deepEqual(files.map(file => file.name), expectedStrings);
          assert.deepEqual(await Promise.all(files.map(file => file.text())), ["body", "body"]);
        } finally {
          data.forEach(url => URL.revokeObjectURL(url));
        }
        break;
      }
      default:
        assert.deepEqual(data, expectedStrings);
    }
    const nullCount = route === "gc-before-exit" ? 0 : 1;
    assert.deepEqual(addon.stats(), [1, 1, nullCount, nullCount, 0]);
  } finally {
    await worker.terminate();
    ports?.port1.close();
    channel?.close();
  }
  console.log(`ok ${mode} ${route}`);
}
