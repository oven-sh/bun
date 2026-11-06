// The place of a suspended async function in a stack trace is found by an index into its bytecode at which no instruction begins: it points at
// the last byte of the instruction before, which is part of the number of the register that holds what is awaited. No opcode is to be read
// there: some bytes are no opcodes but prefixes, since there are more opcodes than a byte can tell apart. The number of variables decides
// which register it is: the byte is made 249 to 190 in turn, then, as the upper half of a number of 16 bits, each of the four prefixes.
async function inner() { await 1; throw new Error("x"); }
globalThis.inner = inner;
const make = counts => (0, eval)(`[${counts.map(count => `async function outer() { var ${Array.from({ length: count + 1 }, (_, i) => "v" + i).join(", ")}; await inner(); }`).join(",\n")}]`);

// (A collection at the wrong moment turns a stack trace into text early, and the frame is no longer marked as async then. So that is not looked at.)
const hasFrame = text => / at (async )?outer \(/.test(text);
async function errorsOf(functions) {
  const errors = [];
  for (const outer of functions)
    await outer().catch(error => errors.push(error));
  return errors;
}

for (const [what, counts] of [["few", Array.from({ length: 60 }, (_, count) => count)], ["many", [4700, 4900, 5200, 5500]]]) {
  const functions = make(counts);
  const printed = (await errorsOf(functions)).filter(error => hasFrame(Bun.inspect(error))).length;
  const asText = (await errorsOf(functions)).filter(error => hasFrame(error.stack)).length;
  Error.prepareStackTrace = (error, sites) => sites.map(site => ` at ${site.getFunctionName()} (${site.getLineNumber() > 0}:${site.getColumnNumber() > 0})`).join("\n");
  const byCallSites = (await errorsOf(functions)).filter(error => hasFrame(error.stack)).length;
  Error.prepareStackTrace = undefined;
  console.log(`${what} variables: ${functions.length} functions; with the frame: printed ${printed}, as text ${asText}, by call sites ${byCallSites}`);
}
