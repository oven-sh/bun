// bun ownership.js
// Memory of the addon's that JavaScript values refer to, and memory of the runtime's that the addon writes to.
const addon = require(process.env.ADDON);

const sizes = [1, 15, 64, 500, 4096, 70_000, 2_000_000];
const failures = [];

function lendBlocks() {
  const values = [];
  for (const size of sizes) {
    values.push(
      addon.createExternalBuffer(size),
      addon.createExternalArrayBuffer(size),
      addon.createExternalLatin1String(size),
      addon.createExternalUTF16String(size),
    );
  }
  values.push(addon.createExternal(), addon.wrapObject({}), addon.addFinalizer({}));
  for (const value of values) {
    if (typeof value === "string" && !/^[a-z]+$/.test(value)) failures.push("an external string reads differently");
  }
  return values;
}

async function collect() {
  for (let i = 0; i < 50 && addon.countBlocksOnLoan() > 0; i++) {
    Bun.gc(true);
    await new Promise(resolve => setImmediate(resolve));
  }
}

for (let round = 0; round < 20; round++) {
  lendBlocks();
  const written = sizes.flatMap(size => [
    addon.createBufferCopy(size),
    addon.createBuffer(size),
    addon.createArrayBuffer(size),
  ]);
  addon.replaceHeldBlocks(1);
  Bun.gc(true);
  for (const value of written) {
    if (!addon.holdsWrittenBytes(value)) failures.push("memory that the addon wrote to reads differently");
  }
}
await collect();
console.log(JSON.stringify({ failures, blocksOnLoanAfterCollecting: addon.countBlocksOnLoan() }));

globalThis.stillReferenced = lendBlocks();
addon.countFinalizersFromNow();
