// Calls crypto.scryptSync and crypto.scrypt with options and callbacks that Node.js refuses, and with a few that it
// takes, and prints how each call ends. Run under Node.js and under Bun: the output must be identical.
const crypto = require("node:crypto");
const { promisify } = require("node:util");

const describeError = e => `${e.name} [${e.code}]: ${e.message}`;

function syncOutcome(...args) {
  try {
    return `key ${crypto.scryptSync("p", "s", ...args).toString("hex")}`;
  } catch (e) {
    return describeError(e);
  }
}

// What the call throws, or else what the callback gets.
function asyncOutcome(...args) {
  const { promise, resolve } = Promise.withResolvers();
  const callback = (error, key) =>
    resolve(error ? `calls back with ${describeError(error)}` : `key ${key.toString("hex")}`);
  try {
    crypto.scrypt("p", "s", ...args.map(arg => (arg === asyncOutcome.callback ? callback : arg)));
  } catch (e) {
    resolve(describeError(e));
  }
  return promise;
}
asyncOutcome.callback = Symbol("callback");

// The names of the options that the call reads, in order. Node.js reads twice an option that is given: it is printed once.
function logged(members) {
  const read = [];
  const options = new Proxy(members, {
    get(target, key, receiver) {
      if (typeof key === "string" && key !== "constructor" && read.at(-1) !== key) read.push(key);
      return Reflect.get(target, key, receiver);
    },
  });
  return [options, () => (read.length > 0 ? read.join(", ") : "none")];
}

(async () => {
  const lines = [];

  // [label, options]: scryptSync(p, s, 4, options) and scrypt(p, s, 4, options, callback).
  const rows = [
    // Both names of one option. The second is refused for being there, whatever it holds.
    ['{ N: 2, cost: "x" }', { N: 2, cost: "x" }],
    ["{ N: 2, cost: null }", { N: 2, cost: null }],
    ["{ N: 2, cost: -1 }", { N: 2, cost: -1 }],
    ["{ N: 2, cost: 1.5 }", { N: 2, cost: 1.5 }],
    ["{ N: 2, cost: NaN }", { N: 2, cost: NaN }],
    ["{ N: 2, cost: {} }", { N: 2, cost: {} }],
    ["{ N: 2, cost: true }", { N: 2, cost: true }],
    ["{ N: 2, cost: 2 }", { N: 2, cost: 2 }],
    ["{ N: 0, cost: 2 }", { N: 0, cost: 2 }],
    ['{ r: 2, blockSize: "x" }', { r: 2, blockSize: "x" }],
    ["{ r: 2, blockSize: -1 }", { r: 2, blockSize: -1 }],
    ["{ r: 0, blockSize: null }", { r: 0, blockSize: null }],
    ['{ p: 1, parallelization: "x" }', { p: 1, parallelization: "x" }],
    ["{ p: 1, parallelization: 1.5 }", { p: 1, parallelization: 1.5 }],

    // Both names, and a later option that is wrong.
    ['{ N: 2, cost: 2, r: "x" }', { N: 2, cost: 2, r: "x" }],
    ['{ r: 2, blockSize: 2, p: "x" }', { r: 2, blockSize: 2, p: "x" }],
    ["{ p: 1, parallelization: 1, maxmem: -1 }", { p: 1, parallelization: 1, maxmem: -1 }],
    ["{ N: 2, cost: 2, r: 2, blockSize: 2 }", { N: 2, cost: 2, r: 2, blockSize: 2 }],

    // Both names, and an earlier option that is wrong.
    ['{ N: "x", cost: 2 }', { N: "x", cost: 2 }],
    ['{ r: 2, blockSize: 2, N: "x" }', { r: 2, blockSize: 2, N: "x" }],
    ["{ p: 1, parallelization: 1, blockSize: -1 }", { p: 1, parallelization: 1, blockSize: -1 }],

    // One name.
    ['{ cost: "x" }', { cost: "x" }],
    ["{ blockSize: -1 }", { blockSize: -1 }],
    ["{ parallelization: 1.5 }", { parallelization: 1.5 }],

    // A name that holds undefined is not given.
    ["{ N: 2, r: 1, p: 1 }", { N: 2, r: 1, p: 1 }],
    ["{ cost: 2, blockSize: 1, parallelization: 1 }", { cost: 2, blockSize: 1, parallelization: 1 }],
    [
      "{ N: 2, cost: undefined, r: undefined, blockSize: 1, p: 1, parallelization: undefined }",
      { N: 2, cost: undefined, r: undefined, blockSize: 1, p: 1, parallelization: undefined },
    ],
  ];
  for (const [label, options] of rows) {
    lines.push(label);
    const sync = syncOutcome(4, options);
    const async = await asyncOutcome(4, options, asyncOutcome.callback);
    if (sync === async) lines.push(`  ${sync}`);
    else lines.push(`  scryptSync: ${sync}`, `  scrypt: ${async}`);
  }

  // [label, the arguments after the salt, the options among them that are logged]
  const calls = [
    // keylen is checked before the options.
    ['scryptSync(p, s, "x", { N: 2, cost: 2 })', syncOutcome, ["x"], { N: 2, cost: 2 }],
    // The options are read up to the one that is refused.
    ['scryptSync(p, s, 4, { N: 2, cost: "x", r: 1 })', syncOutcome, [4], { N: 2, cost: "x", r: 1 }],
    [
      'scryptSync(p, s, 4, { N: 2, r: 2, blockSize: 2, p: "x" })',
      syncOutcome,
      [4],
      { N: 2, r: 2, blockSize: 2, p: "x" },
    ],
    ["scryptSync(p, s, 4, { N: 2, r: 1, p: 1 })", syncOutcome, [4], { N: 2, r: 1, p: 1 }],
    // The callback is checked after the options.
    ["scrypt(p, s, 4, { N: 2, cost: 2 }, 5)", asyncOutcome, [4], { N: 2, cost: 2 }, [5]],
    ['scrypt(p, s, 4, { N: 2, cost: "x" }, null)', asyncOutcome, [4], { N: 2, cost: "x" }, [null]],
    ['scrypt(p, s, 4, { N: "x" }, 5)', asyncOutcome, [4], { N: "x" }, [5]],
    ["scrypt(p, s, 4, { N: 2 }, 5)", asyncOutcome, [4], { N: 2 }, [5]],
    // Without a fifth argument the fourth is the callback, and nothing of it is read.
    ['scrypt(p, s, 4, { N: 2, cost: "x" })', asyncOutcome, [4], { N: 2, cost: "x" }],
    ['scrypt(p, s, 4, { N: 2, cost: "x" }, undefined)', asyncOutcome, [4], { N: 2, cost: "x" }, [undefined]],
  ];
  for (const [label, outcome, before, members, after = []] of calls) {
    const [options, read] = logged(members);
    lines.push(label, `  ${await outcome(...before, options, ...after)}`, `  reads: ${read()}`);
  }

  const others = [
    ["scrypt(p, s, 4, 5)", () => asyncOutcome(4, 5)],
    ["scrypt(p, s, 4, null)", () => asyncOutcome(4, null)],
    ["scrypt(p, s, 4)", () => asyncOutcome(4)],
    // Options that are undefined or null are no options.
    ["scrypt(p, s, 4, undefined, callback)", () => asyncOutcome(4, undefined, asyncOutcome.callback)],
    ["scrypt(p, s, 4, null, callback)", () => asyncOutcome(4, null, asyncOutcome.callback)],
    ["scrypt(p, s, 4, callback)", () => asyncOutcome(4, asyncOutcome.callback)],
    [
      'promisify(scrypt)(p, s, 4, { N: 2, cost: "x" })',
      () =>
        promisify(crypto.scrypt)("p", "s", 4, { N: 2, cost: "x" }).then(
          key => `key ${key.toString("hex")}`,
          e => `rejects with ${describeError(e)}`,
        ),
    ],
  ];
  for (const [label, outcome] of others) lines.push(label, `  ${await outcome()}`);

  console.log(lines.join("\n"));
})();
