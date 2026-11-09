// bun resolution.js <folder>
// Resolves external strings of the addon as package names until the runtime remembers each answer. Then counts the
// strings that are still on loan when no JavaScript value refers to them.
const addon = require(process.env.ADDON);
const { resolutionMemoHits } = require("bun:internal-for-testing");
const fs = require("node:fs");
const path = require("node:path");

const folder = process.argv[2];
const from = require("node:module").createRequire(path.join(folder, "main.js"));
const count = 40;

function resolveEach() {
  let last;
  for (let i = 0; i < count; i++) {
    // Each of another length: the addon has 26 texts of one length.
    const name = addon.createExternalLatin1String(20 + i);
    fs.mkdirSync(path.join(folder, "node_modules", name), { recursive: true });
    fs.writeFileSync(path.join(folder, "node_modules", name, "index.js"), "");
    // The first reads the folder again, the second is remembered, and the memory answers the third.
    for (let repeat = 0; repeat < 3; repeat++) from.resolve(name);
    last = Buffer.from(name).toString();
  }
  return last;
}

const hitsBefore = resolutionMemoHits();
const last = resolveEach();
const answeredFromMemory = resolutionMemoHits() - hitsBefore;
for (let i = 0; i < 50 && addon.countBlocksOnLoan() > 0; i++) {
  Bun.gc(true);
  await new Promise(resolve => setImmediate(resolve));
}
const blocksOnLoanAfterCollecting = addon.countBlocksOnLoan();
// The answer is still remembered, under a string of the runtime's own.
const hitsBeforeTheCopy = resolutionMemoHits();
from.resolve(last);
const answersACopyFromMemory = resolutionMemoHits() - hitsBeforeTheCopy === 1;
console.log(JSON.stringify({ answeredFromMemory, blocksOnLoanAfterCollecting, answersACopyFromMemory }));
