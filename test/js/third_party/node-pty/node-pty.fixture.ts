// Runs one scenario of node-pty.test.ts and prints its result as one line of JSON.
import * as pty from "@lydell/node-pty";
import { spawn } from "@lydell/node-pty";
import { createHash } from "node:crypto";
import { fstatSync } from "node:fs";
import type { ReadStream } from "node:tty";

const scenario = process.argv[2];
const say = (result: object) => console.log(JSON.stringify(result));

if (scenario === "shell") {
  // https://github.com/oven-sh/bun/issues/25822: a shell that is written to, resized and left.
  const shell = spawn("sh", [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    env: process.env as Record<string, string>,
  });
  let output = "";
  let resized = false;
  shell.onData(data => {
    output += data;
    // The typed command is echoed with its $((...)) in it. Only its output has the sum.
    if (resized || !output.includes("sum=123")) return;
    resized = true;
    shell.resize(100, 30);
    shell.write("exit\n");
  });
  shell.onExit(exit => say({ sawOutput: output.includes("sum=123"), exit, cols: shell.cols, rows: shell.rows }));
  shell.write("echo sum=$((100+23))\n");
} else if (scenario === "flow") {
  // A consumer that stops the stream around every chunk: the output and the end of the child must both arrive.
  // node-pty destroys its socket 200 ms after the child exits, read or not: the child waits until its last line is here.
  const child = spawn("sh", ["-c", "stty -onlcr -echo; seq 1 20000; read ack"], { cols: 80, rows: 24 });
  const hash = createHash("sha256");
  let bytes = 0;
  let tail = "";
  child.onData(data => {
    bytes += Buffer.byteLength(data);
    hash.update(data);
    tail = (tail + data).slice(-6);
    if (tail === "20000\n") child.write("\n");
    child.pause();
    setImmediate(() => child.resume());
  });
  child.onExit(exit => say({ bytes, sha256: hash.digest("hex"), exit }));
} else if (scenario === "open") {
  // open() has no child: it makes a tty.ReadStream over each end of a new pty. Its types do not declare it.
  type Opened = { master: ReadStream; slave: ReadStream; fd: number; resize(cols: number, rows: number): void };
  const term = (pty as unknown as { open(options: { cols: number; rows: number }): Opened }).open({ cols: 80, rows: 24 });
  const { master, slave } = term;
  const got = { slave: "", master: "" };
  const closed: string[] = [];
  let answered = false;
  let size: number[] | undefined;
  slave.on("data", data => {
    got.slave += data;
    // The line that was typed at the master is here: answer it from the slave.
    if (answered || !got.slave.includes("\n")) return;
    answered = true;
    slave.write("out\n");
  });
  master.on("data", data => {
    got.master += data;
    // The echo of the line, then the answer: both ends are done.
    if (size || !got.master.endsWith("out\r\n")) return;
    term.resize(100, 30);
    // What the pty holds now, asked at its other end.
    size = [0, 0];
    (slave as ReadStream & { _handle: { getWindowSize(size: number[]): number } })._handle.getWindowSize(size);
    // An opened terminal has pid -1: destroy() of the terminal would signal every process.
    slave.destroy();
    master.destroy();
  });
  for (const [name, stream] of [["slave", slave], ["master", master]] as const) {
    stream.on("close", () => {
      closed.push(name);
      if (closed.length < 2) return;
      // The master has no name to open it by, so the stream owns the descriptor, as in Node.
      let masterIsOpen = true;
      try {
        masterIsOpen = fstatSync(term.fd).isCharacterDevice();
      } catch {
        masterIsOpen = false;
      }
      say({ ...got, size, closed: closed.sort(), masterIsOpen });
    });
  }
  master.write("hello\n");
} else if (scenario === "flood") {
  // More than the pty holds, written to the slave of open(). The write waits for the loop, and the master reads it on
  // the same loop. The text has no line end, so the terminal passes it as it is.
  type Opened = { master: ReadStream; slave: ReadStream };
  const term = (pty as unknown as { open(options: { cols: number; rows: number }): Opened }).open({ cols: 80, rows: 24 });
  const { master, slave } = term;
  const text = Buffer.alloc(1 << 20, "abcdefghijklmnopqrstuvwxyz0123456789");
  const hash = createHash("sha256");
  const closed: string[] = [];
  let bytes = 0;
  let written: string | null | undefined = "not yet";
  let drained = false;
  slave.on("drain", () => (drained = true));
  master.on("data", data => {
    bytes += Buffer.byteLength(data);
    hash.update(data);
    // The write is complete before the master can read its last byte.
    if (bytes < text.length) return;
    slave.destroy();
    master.destroy();
  });
  for (const [name, stream] of [["slave", slave], ["master", master]] as const) {
    stream.on("close", () => {
      closed.push(name);
      if (closed.length < 2) return;
      say({ ret, written, drained, bytes, sha256: hash.digest("hex"), closed: closed.sort() });
    });
  }
  const ret = slave.write(text, err => (written = err ? (err as NodeJS.ErrnoException).code : null));
} else {
  throw new Error(`unknown scenario ${scenario}`);
}
