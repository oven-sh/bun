// Prints the history of a REPL and the text of its history file, once setupHistory() has read the file.
// Node.js v26.12.1 prints the same rows. Before v26.8.0 (nodejs/node#64513) it printed other rows.
// usage: repl-history-file-load-fixture.js <an empty directory>
const fs = require("node:fs");
const path = require("node:path");
const { PassThrough, Stream, Writable } = require("node:stream");
const repl = require("node:repl");

// An input that does not support pausing. setupHistory() pauses the REPL while it reads the file, and this input
// delivers a line all the same.
class Unpausable extends Stream {
  readable = true;
  pause() {}
  resume() {}
}

let files = 0;
// `lines` reach the REPL in the same tick as setupHistory(): the read of the file has started and has not ended.
// `send` says how: through write(), after displayPrompt(), or else through an input that does not pause.
// `assigned` becomes the history in that tick too. `after` lines reach the REPL when the file is read.
async function load(name, { file, lines = [], send, assigned, after = [], ...options }) {
  const filePath = path.join(process.argv[2], `history-${files++}.txt`);
  fs.writeFileSync(filePath, file);
  const input = send ? new PassThrough() : new Unpausable();
  const output = new Writable({ write: (chunk, encoding, callback) => callback() });
  const server = repl.start({ input, output, terminal: true, prompt: "", useColors: false, useGlobal: false });
  let historyEvents = 0;
  server.on("history", () => historyEvents++);
  // The REPL calls the callback inside a try block and drops what it throws, so the callback only resolves.
  const loaded = new Promise(resolve => server.setupHistory({ filePath, ...options }, resolve));
  for (const line of lines) {
    if (send === "write()") {
      server.write(line + "\n");
    } else if (send === "displayPrompt()") {
      server.displayPrompt();
      input.write(line + "\n");
    } else {
      input.emit("data", line + "\n");
    }
  }
  if (historyEvents !== lines.length)
    throw new Error(`${name}: the REPL took ${historyEvents} of ${lines.length} lines`);
  if (assigned) server.history = assigned;
  await loaded;
  for (const line of after) {
    const saved = new Promise(resolve => server.once("flushHistory", resolve));
    input.emit("data", line + "\n");
    await saved;
  }
  const row = { history: server.history, file: fs.readFileSync(filePath, "utf8"), historyEvents };
  if (options.history) row.isTheGivenArray = server.history === options.history;
  if (assigned) row.isTheAssignedArray = server.history === assigned;
  console.log(name, JSON.stringify(row));
  const exited = new Promise(resolve => server.once("exit", resolve));
  server.close();
  await exited;
}

(async () => {
  await load("no line, size 2", { file: "old3\nold2\nold1", size: 2 });
  await load("two lines", { file: "old2\nold1", lines: ["1 + 1", "2 + 2"] });
  await load("a file that ends in a newline", { file: "old2\nold1\n", lines: ["1 + 1"] });
  await load("an empty file", { file: "", lines: ["1 + 1"] });
  await load("more entries than size 3", { file: "old3\nold2\nold1", size: 3, lines: ["1 + 1", "2 + 2"] });
  await load("a line equal to the newest entry of the file", {
    file: "1 + 1\nold1",
    removeHistoryDuplicates: true,
    lines: ["1 + 1"],
  });
  await load("a command of two lines, the second after the read", {
    file: "old2\nold1",
    lines: ["[1,"],
    after: ["2]"],
  });
  await load("a line from write()", { file: "old2\nold1", send: "write()", lines: ["1 + 1"] });
  await load("a line after displayPrompt()", { file: "old2\nold1", send: "displayPrompt()", lines: ["1 + 1"] });
  await load("a history assigned to the REPL", { file: "old2\nold1", assigned: ["assigned"] });
  await load("a history option", { file: "old2\nold1", history: ["given"] });
  await load("an empty history option", { file: "old2\nold1", history: [] });
})();
