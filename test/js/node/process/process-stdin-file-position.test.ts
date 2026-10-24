/**
 * A regular file as stdin is one open file description, and the process shares
 * its position with the process that started it. Node reads such a stdin with
 * `new fs.ReadStream(null, { fd: 0, autoClose: false })`, which has no `start`
 * and so reads at the position and advances it:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/bootstrap/switches/is_main_thread.js#L205-L209
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/streams.js#L202-L210
 *
 * This file uses node:test and node:assert so that the identical file also runs
 * under `node --test`. It cannot import from "harness" for the same reason.
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const consumed = "SECRET-HEADER\n";
const rest = "body1\nbody2\n";

describe("process.stdin over a regular file that the parent already read from", () => {
  let dir: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "process-stdin-file-position-"));
    fs.writeFileSync(path.join(dir, "in.txt"), consumed + rest);
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // The parent reads the first line, starts the child with the descriptor as its stdin,
  // and reads the descriptor again after the child exits.
  function runAfterParentRead(js: string) {
    const fd = fs.openSync(path.join(dir, "in.txt"), "r");
    fs.readSync(fd, Buffer.alloc(consumed.length));
    const child = spawn(process.execPath, ["-e", js], { stdio: [fd, "pipe", "inherit"] });
    let stdout = "";
    child.stdout!.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    return new Promise<{ stdout: string; code: number | null; left: string }>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", code => {
        const buf = Buffer.alloc(consumed.length + rest.length);
        const left = buf.toString("utf8", 0, fs.readSync(fd, buf));
        fs.closeSync(fd);
        resolve({ stdout, code, left });
      });
    });
  }

  const print = "process.stdout.write(JSON.stringify(s))";
  const readers: Record<string, string> = {
    "'data'": `let s = ""; process.stdin.on("data", d => (s += d)).on("end", () => ${print});`,
    "'readable' and read()": `let s = ""; process.stdin.on("readable", () => { for (let c; (c = process.stdin.read()) !== null; ) s += c; }).on("end", () => ${print});`,
    "for await": `(async () => { let s = ""; for await (const c of process.stdin) s += c; ${print}; })();`,
    "node:readline": `let s = ""; require("node:readline").createInterface({ input: process.stdin }).on("line", l => (s += l + "\\n")).on("close", () => ${print});`,
    "fs.readSync(0), then 'data'": `const b = Buffer.alloc(3); let s = b.toString("utf8", 0, require("node:fs").readSync(0, b)); process.stdin.on("data", d => (s += d)).on("end", () => ${print});`,
  };

  test("every way to read it starts at the position and leaves nothing behind", async () => {
    const names = Object.keys(readers);
    const results = await Promise.all(names.map(name => runAfterParentRead(readers[name])));
    const expected = { stdout: JSON.stringify(rest), code: 0, left: "" };
    assert.deepStrictEqual(
      Object.fromEntries(names.map((name, i) => [name, results[i]])),
      Object.fromEntries(names.map(name => [name, expected])),
    );
  });

  test("the getter alone takes no bytes", async () => {
    assert.deepStrictEqual(await runAfterParentRead(`process.stdin;`), { stdout: "", code: 0, left: rest });
  });
});
