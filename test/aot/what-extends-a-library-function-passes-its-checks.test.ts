// `Readable` and `EventEmitter` are functions that store into `this`, written in Bun's own modules with a declared `this`. A class
// or a function of the program that extends one of them makes objects that those functions fill and whose methods they are: such an
// object is one of the objects that the declared type stands for. So no check in the library turns it away.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { spawned } from "./run-programs";
import { describe, test } from "./supported";

const programs: Record<string, { file?: string; text: string; output: string }> = {
  "a class below Readable": {
    text: `
      import { Readable } from "node:stream";
      class Numbers extends Readable {
        constructor() { super({ objectMode: true }); this.n = 0; }
        _read() { this.push(this.n < 50 ? { n: this.n++ } : null); }
      }
      let sum = 0;
      for await (const item of new Numbers()) sum += item.n;
      console.log(sum);`,
    output: "1225\n",
  },
  "a class below EventEmitter": {
    text: `
      import { EventEmitter } from "node:events";
      class Bus extends EventEmitter { constructor() { super(); this.total = 0; } }
      const bus = new Bus();
      bus.on("n", function (n) { this.total += n; });
      for (let i = 0; i < 50; i++) bus.emit("n", i);
      console.log(bus.total, bus.listenerCount("n"));`,
    output: "1225 1\n",
  },
  "a class below the value of node:events": {
    text: `
      import EventEmitter from "node:events";
      class Bus extends EventEmitter {}
      const bus = new Bus();
      console.log(bus.on("n", () => {}).emit("n"));`,
    output: "true\n",
  },
  "a function that util.inherits hangs below EventEmitter": {
    file: "main.cjs",
    text: `
      const EventEmitter = require("node:events");
      function Bus() { EventEmitter.call(this); this.total = 0; }
      require("node:util").inherits(Bus, EventEmitter);
      const bus = new Bus();
      bus.on("n", n => { bus.total += n; });
      for (let i = 0; i < 50; i++) bus.emit("n", i);
      console.log(bus.total);`,
    output: "1225\n",
  },
};

describe("what extends a function of the library passes the checks of the library", () => {
  test.concurrent.each(Object.entries(programs))("%s", async (_, { file = "main.mjs", text, output }) => {
    using dir = tempDir("aot-what-extends-a-library-function", { [file]: text });
    const ran = await spawned([bunExe(), "run", "--aot-log-type-mismatches", file], String(dir), bunEnv);
    const turnedAway = ran.stderr
      .split("\n")
      .filter(line => /type-mismatch .* got (untyped )?(Numbers|Bus)\b/.test(line));
    expect({ turnedAway, stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
      turnedAway: [],
      stdout: output,
      exitCode: 0,
    });
  });
});
