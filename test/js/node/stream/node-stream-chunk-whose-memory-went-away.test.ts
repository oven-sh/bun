// A chunk lies in a stream, and its memory goes away: the buffer is transferred, or the WebAssembly memory under it grows.
// The stream still counts the four bytes that it took in. It hands the chunk out as it is now, without bytes, and ends.
// A stream that does not end lets the process exit with the code behind a `for await` never run, so each way runs in a process of its own.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const ways = {
  data: [`readable.on("data", chunk => told.push("data " + chunk.length));`, "data 0, end, close"],
  readable: [
    `readable.on("readable", () => { for (let chunk; (chunk = readable.read()) !== null; ) told.push("read " + chunk.length); });`,
    "read 0, end, close",
  ],
  "for await": [
    `(async () => { for await (const chunk of readable) told.push("chunk " + chunk.length); told.push("behind the loop"); })();`,
    "end, close, chunk 0, behind the loop",
  ],
  pipe: [
    `readable.pipe(new Writable({ write(chunk, encoding, done) { told.push("wrote " + chunk.length); done(); } })).on("finish", () => told.push("finish"));`,
    "wrote 0, end, finish, close",
  ],
};

test.concurrent.each(Object.keys(ways) as (keyof typeof ways)[])(
  "a stream ends over a chunk without memory: %s",
  async way => {
    const [take, told] = ways[way];
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
      const { Readable, Writable } = require("node:stream");
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
      const chunks = { left: Buffer.from(new ArrayBuffer(4)), transferred: Buffer.from(new ArrayBuffer(4)), grown: Buffer.from(memory.buffer, 8, 4) };
      for (const name in chunks) {
        const readable = new Readable({ read() {} });
        const told = [];
        readable.push(chunks[name]);
        readable.push(null);
        if (name === "transferred") structuredClone(chunks[name].buffer, { transfer: [chunks[name].buffer] });
        if (name === "grown") memory.grow(1);
        readable.on("end", () => told.push("end")).on("close", () => told.push("close")).on("error", error => told.push(error.name));
        ${take}
        process.on("exit", () => console.log(name + ": " + told.join(", ") + " | " + readable.readableLength));
      }
    `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.split("\n"), stderr, exitCode }).toEqual({
      stdout: [`left: ${told.replace(" 0", " 4")} | 0`, `transferred: ${told} | 0`, `grown: ${told} | 0`, ""],
      stderr: "",
      exitCode: 0,
    });
  },
);
