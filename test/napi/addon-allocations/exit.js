// bun exit.js <how the process ends>
// Loads the addon that $ADDON names, leaves it busy, and ends. Without $ADDON it ends the same way with no addon.
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const how = isMainThread ? process.argv[2] : workerData;
const stillReferenced = [];

function loadAddon() {
  if (!process.env.ADDON) return;
  const addon = require(process.env.ADDON);
  addon.startDetachedThread();
  addon.replaceHeldBlocks(3);
  addon.runThreads(1);
  stillReferenced.push(
    addon.createExternalBuffer(5000),
    addon.createExternalArrayBuffer(5000),
    addon.createExternalLatin1String(5000),
    addon.createExternalUTF16String(5000),
    addon.createExternal(),
    addon.wrapObject({}),
    addon.addFinalizer({}),
  );
  for (let i = 0; i < 4; i++) addon.queueWork(40);
  while (addon.countDetachedThreadRounds() === 0);
  return addon;
}

function keepReplacingBlocks(addon) {
  setInterval(() => addon?.replaceHeldBlocks(1), 1);
}

if (!isMainThread) {
  const addon = loadAddon();
  if (how === "a worker calls process.exit") process.exit(0);
  if (how !== "a worker returns") {
    keepReplacingBlocks(addon);
    parentPort.postMessage("busy");
  }
} else if (how.includes("worker")) {
  const worker = new Worker(__filename, { workerData: how });
  worker.on("message", async () => {
    if (how === "process.exit is called beside a busy worker") process.exit(5);
    await worker.terminate();
  });
  worker.on("exit", () => console.log("the worker ended"));
} else {
  loadAddon();
  if (how === "process.exit is called") process.exit(7);
  if (how === "an exception is not caught") throw new Error("nobody catches this");
  if (how === "a rejection is not handled") Promise.reject(new Error("nobody handles this"));
}
