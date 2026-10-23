// Calls the readFile, writeFile and appendFile forms with an empty `flag` or `mode`, alone and next to a second
// invalid option, and prints how each call ends. Run under Node.js v26.4.0 or later and under Bun: the output must
// be identical. Usage: node fs-empty-flag-mode-fixture.js <empty directory>
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const dir = process.argv[2];
const file = path.join(dir, "file.txt");
const missing = path.join(dir, "missing.txt");
const tooLong = path.join(dir, Buffer.alloc(5000, "a").toString());
const lines = [];
let callbacksAfterThrow = 0;

// Each form: how it reports an error, and the call. A callback form takes the callback last.
const forms = {
  "fs.readFileSync": ["sync", (target, options) => fs.readFileSync(target, options)],
  "fs.readFile": ["callback", (target, options, callback) => fs.readFile(target, options, callback)],
  "fs.promises.readFile": ["promise", (target, options) => fs.promises.readFile(target, options)],
  "util.promisify(fs.readFile)": ["promise", (target, options) => promisify(fs.readFile)(target, options)],
  "fileHandle.readFile": ["promise", (handle, options) => handle.readFile(options)],

  "fs.writeFileSync": ["sync", (target, data, options) => fs.writeFileSync(target, data, options)],
  "fs.appendFileSync": ["sync", (target, data, options) => fs.appendFileSync(target, data, options)],
  "fs.writeFile": ["callback", (target, data, options, callback) => fs.writeFile(target, data, options, callback)],
  "fs.appendFile": ["callback", (target, data, options, callback) => fs.appendFile(target, data, options, callback)],
  "fs.promises.writeFile": ["promise", (target, data, options) => fs.promises.writeFile(target, data, options)],
  "fs.promises.appendFile": ["promise", (target, data, options) => fs.promises.appendFile(target, data, options)],
  "util.promisify(fs.writeFile)": [
    "promise",
    (target, data, options) => promisify(fs.writeFile)(target, data, options),
  ],
  "util.promisify(fs.appendFile)": [
    "promise",
    (target, data, options) => promisify(fs.appendFile)(target, data, options),
  ],
};
const readForms = ["fs.readFileSync", "fs.readFile", "fs.promises.readFile"];
const syncAndCallbackWriteForms = ["fs.writeFileSync", "fs.appendFileSync", "fs.writeFile", "fs.appendFile"];
const promiseWriteForms = ["fs.promises.writeFile", "fs.promises.appendFile"];
const writeForms = [...syncAndCallbackWriteForms, ...promiseWriteForms];

// The texts of the `flags` and `mode` errors are the same in Node.js and Bun. Another error is named by its option.
function describeError(error) {
  if (error.name === "AbortError") return "AbortError";
  const message = String(error.message);
  if (/'flags'|'mode'/.test(message)) return `${error.name} ${error.code}: ${message}`;
  for (const option of ["encoding", "signal", "flush", "data"]) {
    if (message.includes(option)) return `${error.name} ${error.code} (${option})`;
  }
  return `${error.name} ${error.code}`;
}

async function outcome(kind, call) {
  if (kind === "callback") {
    const { promise, resolve } = Promise.withResolvers();
    let threw = false;
    try {
      call(error => {
        if (threw) callbacksAfterThrow++;
        resolve(error);
      });
    } catch (error) {
      threw = true;
      return `throws ${describeError(error)}`;
    }
    const error = await promise;
    return error ? `calls back with ${describeError(error)}` : "succeeds";
  }
  let returned;
  try {
    returned = call();
  } catch (error) {
    return `throws ${describeError(error)}`;
  }
  if (kind === "sync") return "succeeds";
  try {
    await returned;
    return "succeeds";
  } catch (error) {
    return `rejects with ${describeError(error)}`;
  }
}

// Gives `use` the target of one call. An fd and a FileHandle are open for that call only.
async function withTarget(target, use) {
  if (target === "fd") {
    const fd = fs.openSync(file, "r+");
    try {
      return await use(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  if (target === "fileHandle") {
    const handle = await fs.promises.open(file, "r+");
    try {
      return await use(handle);
    } finally {
      await handle.close();
    }
  }
  return use({ path: file, missingPath: missing, tooLongPath: tooLong }[target]);
}

// Runs one call on a fresh file, and adds what the call did to the file system.
async function run(kind, target, call) {
  fs.writeFileSync(file, "old");
  fs.rmSync(missing, { force: true });
  let result = await withTarget(target, opened => outcome(kind, callback => call(opened, callback)));
  const content = fs.readFileSync(file, "utf8");
  if (content !== "old") result += `, the file holds ${JSON.stringify(content)}`;
  if (fs.existsSync(missing)) result += ", the missing path exists";
  return result;
}

// Calls each form with `target` and a fresh `rest()`. The forms that end the same way share one line.
async function rows(label, names, target, rest) {
  const byOutcome = new Map();
  for (const name of names) {
    const [kind, call] = forms[name];
    const result = await run(kind, target, (opened, callback) => call(opened, ...rest(), callback));
    if (!byOutcome.has(result)) byOutcome.set(result, []);
    byOutcome.get(result).push(name);
  }
  lines.push(label);
  for (const [result, sameOutcome] of byOutcome) lines.push(`  ${result}: ${sameOutcome.join(", ")}`);
}

const aborted = () => AbortSignal.abort();
const notAborted = () => new AbortController().signal;
// `fs.readFile(path, callback)` and `fs.writeFile(path, data, callback)` take the callback in the options slot.
const withEmpty = (name, callback) => Object.assign(error => callback(error), { [name]: "" });

async function main() {
  lines.push("# flag '' is invalid for a path in fs.readFileSync and fs.readFile");
  await rows("(path, { flag: '' })", [...readForms, "util.promisify(fs.readFile)"], "path", () => [{ flag: "" }]);
  await rows("(path, { encoding: 'utf8', flag: '' })", readForms, "path", () => [{ encoding: "utf8", flag: "" }]);
  await rows("(tooLongPath, { flag: '' })", ["fs.readFile"], "tooLongPath", () => [{ flag: "" }]);
  await rows("(path, { flag: 'bogus' })", readForms, "path", () => [{ flag: "bogus" }]);

  lines.push("", "# flag '' is the default flag for an fd, for a FileHandle and for a callback in the options slot");
  await rows("(fd, { flag: '' })", ["fs.readFileSync", "fs.readFile"], "fd", () => [{ flag: "" }]);
  await rows("(fileHandle, { flag: '' })", ["fs.promises.readFile", "fileHandle.readFile"], "fileHandle", () => [
    { flag: "" },
  ]);
  lines.push("(path, callback) with callback.flag = ''");
  lines.push(
    `  ${await run("callback", "path", (target, callback) => fs.readFile(target, withEmpty("flag", callback)))}: fs.readFile`,
  );

  lines.push("", "# a flag that Node.js accepts");
  for (const [shown, flag] of [
    ["null", null],
    ["undefined", undefined],
    ["0", 0],
    ["'r'", "r"],
  ]) {
    await rows(`(path, { flag: ${shown} })`, readForms, "path", () => [{ flag }]);
  }

  lines.push(
    "",
    "# flag and a second option: an invalid encoding or signal wins, an aborted async call reports AbortError",
  );
  for (const flag of ["", "bogus"]) {
    const and = (shown, second) =>
      rows(`(path, { flag: '${flag}', ${shown} })`, readForms, "path", () => [{ flag, ...second() }]);
    await and("encoding: 'bogus'", () => ({ encoding: "bogus" }));
    await and("signal: 'x'", () => ({ signal: "x" }));
    await and("signal: aborted", () => ({ signal: aborted() }));
    await and("signal: notAborted", () => ({ signal: notAborted() }));
  }

  lines.push("", "# mode '' is invalid in writeFile and appendFile, for every target");
  const withPromisified = [...writeForms, "util.promisify(fs.writeFile)", "util.promisify(fs.appendFile)"];
  await rows("(path, 'x', { mode: '' })", withPromisified, "path", () => ["x", { mode: "" }]);
  await rows("(path, buffer, { mode: '' })", writeForms, "path", () => [Buffer.from("x"), { mode: "" }]);
  await rows("(missingPath, 'x', { mode: '' })", writeForms, "missingPath", () => ["x", { mode: "" }]);
  await rows("(fd, 'x', { mode: '' })", syncAndCallbackWriteForms, "fd", () => ["x", { mode: "" }]);
  await rows("(fileHandle, 'x', { mode: '' })", promiseWriteForms, "fileHandle", () => ["x", { mode: "" }]);

  lines.push("", "# mode '' is the default mode for a callback in the options slot");
  lines.push("(path, 'x', callback) with callback.mode = ''");
  lines.push(
    `  ${await run("callback", "path", (target, callback) => fs.writeFile(target, "x", withEmpty("mode", callback)))}: fs.writeFile`,
  );

  lines.push("", "# a mode or a flag that Node.js accepts");
  for (const [shown, mode] of [
    ["null", null],
    ["undefined", undefined],
    ["0o644", 0o644],
    ["'644'", "644"],
  ]) {
    await rows(`(path, 'x', { mode: ${shown} })`, writeForms, "path", () => ["x", { mode }]);
  }
  await rows("(path, 'x', { flag: '' })", writeForms, "path", () => ["x", { flag: "" }]);

  lines.push(
    "",
    "# mode and a second option: an invalid encoding or signal wins, mode wins over the data and over an abort",
  );
  for (const mode of ["", "9"]) {
    const and = (shown, second, data = "x") =>
      rows(`(path, ${data === "x" ? "'x'" : data}, { mode: '${mode}'${shown} })`, writeForms, "path", () => [
        data,
        { mode, ...second() },
      ]);
    await and(", encoding: 'bogus'", () => ({ encoding: "bogus" }));
    await and(", signal: 'x'", () => ({ signal: "x" }));
    await and(", signal: aborted", () => ({ signal: aborted() }));
    await and(", signal: notAborted", () => ({ signal: notAborted() }));
    await and("", () => ({}), 123);
  }

  lines.push(
    "",
    "# mode and flush: writeFile checks flush first and appendFile checks mode first, whatever the flag is",
  );
  for (const [shown, options] of [
    ["{ mode: '', flush: 1 }", { mode: "", flush: 1 }],
    ["{ mode: '9', flush: 1 }", { mode: "9", flush: 1 }],
    ["{ flag: 'a', mode: '9', flush: 1 }", { flag: "a", mode: "9", flush: 1 }],
    ["{ flag: 'w', mode: '9', flush: 1 }", { flag: "w", mode: "9", flush: 1 }],
  ]) {
    await rows(`(path, 'x', ${shown})`, writeForms, "path", () => ["x", options]);
  }

  lines.push("", `callbacks that ran after their call threw: ${callbacksAfterThrow}`);
  console.log(lines.join("\n"));
}

main();
