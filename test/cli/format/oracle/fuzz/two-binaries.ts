// The files that two builds of `bun-lint` format differently: for a change that must not change any output.
//
//   bun two-binaries.ts --a=<bun-lint> --b=<bun-lint> [--options=<json>] [--extensions=.css,.less,.scss] <directories..>
//
// Both run `format serve`, nothing is written. 70 000 small files take a minute. An input that both reject counts as the same.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const flags = new Map<string, string>();
const roots: string[] = [];
for (const argument of process.argv.slice(2)) {
  const match = /^--([\w-]+)=(.*)$/s.exec(argument);
  if (match) flags.set(match[1], match[2]);
  else roots.push(argument);
}
const options = JSON.parse(flags.get("options") ?? "{}");
const extensions = new Set((flags.get("extensions") ?? ".css,.less,.scss,.yml,.yaml,.md,.jsx").split(","));
const files: string[] = [];
const walk = (path: string) => {
  for (const name of readdirSync(path).sort()) {
    const file = join(path, name);
    const stats = statSync(file, { throwIfNoEntry: false });
    if (stats?.isDirectory()) {
      if (name !== "node_modules") walk(file);
    } else if (stats && extensions.has(name.slice(name.lastIndexOf(".")))) files.push(file);
  }
};
roots.forEach(walk);

class Server {
  process!: ReturnType<typeof Bun.spawn>;
  reader!: ReadableStreamDefaultReader<Uint8Array>;
  buffer = new Uint8Array(0);
  constructor(public binary: string) {
    this.start();
  }
  start() {
    this.process = Bun.spawn({ cmd: [this.binary, "format", "serve", ...Object.entries(options).map(([key, value]) => `--${key}=${value}`)], stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    this.reader = (this.process.stdout as ReadableStream<Uint8Array>).getReader();
    this.buffer = new Uint8Array(0);
  }
  async fill() {
    const { value, done } = await this.reader.read();
    if (done) throw new Error("exit");
    const joined = new Uint8Array(this.buffer.length + value.length);
    joined.set(this.buffer);
    joined.set(value, this.buffer.length);
    this.buffer = joined;
  }
  async format(path: string): Promise<string> {
    try {
      const stdin = this.process.stdin as import("bun").FileSink;
      stdin.write(path + "\n");
      stdin.flush();
      let end: number;
      while ((end = this.buffer.indexOf(10)) < 0) await this.fill();
      const line = new TextDecoder().decode(this.buffer.subarray(0, end));
      this.buffer = this.buffer.subarray(end + 1);
      if (!line.startsWith("ok ")) return "rejected: " + line.replace(/SyntaxErrorAt\(.*$/, "SyntaxError");
      const length = Number(line.slice(3));
      while (this.buffer.length < length) await this.fill();
      const output = Buffer.from(this.buffer.subarray(0, length)).toString("latin1");
      this.buffer = this.buffer.subarray(length);
      return output;
    } catch {
      this.start();
      return "a panic of " + this.binary;
    }
  }
}

const [a, b] = [new Server(flags.get("a")!), new Server(flags.get("b")!)];
let [same, rejected, differ] = [0, 0, 0];
for (const file of files) {
  const [first, second] = await Promise.all([a.format(file), b.format(file)]);
  if (first === second) {
    same++;
    if (first.startsWith("rejected: ")) rejected++;
  } else {
    differ++;
    console.log(file, second.startsWith("a panic") ? second : "");
  }
}
console.log(`${JSON.stringify(options)}: same ${same} (of them rejected ${rejected}), differ ${differ}`);
process.exit(0);
