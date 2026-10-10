// Every file of a directory, formatted by the npm package of Prettier and by `bun-lint format serve`.
//
//   bun against-prettier.ts --bin=<bun-lint> --prettier=<directory with node_modules/prettier> [--options=<json>] [--report=<directory>] [--accepts] <directory>
//
// For what `mutations.ts` writes: Prettier runs in a worker that is ended if it hangs, which it does on some of that, and so is our side.
// It prints the files that differ, that only we reject, on which we panic or hang, and with `--accepts` those that only we accept.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

declare var self: Worker;
if (!Bun.isMainThread) {
  let prettier: typeof import("prettier");
  self.onmessage = async ({ data: { root, path, options } }: MessageEvent) => {
    prettier ??= await import(resolve(root, "node_modules/prettier/index.mjs"));
    try {
      postMessage({ expected: await prettier.format(readFileSync(path, "utf8"), { ...options, filepath: path }) });
    } catch (error) {
      postMessage({ error: String(error).slice(0, 100) });
    }
  };
} else {
  const flags = new Map<string, string>();
  const roots: string[] = [];
  for (const argument of process.argv.slice(2)) {
    const match = /^--([\w-]+)(?:=(.*))?$/s.exec(argument);
    if (match) flags.set(match[1], match[2] ?? "");
    else roots.push(argument);
  }
  const options = JSON.parse(flags.get("options") ?? "{}");
  const report = flags.get("report");
  const files = readdirSync(roots[0]).sort().map(name => join(roots[0], name));

  const start = () =>
    Bun.spawn({ cmd: [flags.get("bin")!, "format", "serve", ...Object.entries(options).map(([key, value]) => `--${key}=${value}`)], stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  let server = start();
  let reader = server.stdout.getReader();
  let buffer = new Uint8Array(0);
  const restart = () => {
    server.kill();
    server = start();
    reader = server.stdout.getReader();
    buffer = new Uint8Array(0);
  };
  async function fill() {
    const { value, done } = await reader.read();
    if (done) throw new Error("exit");
    const joined = new Uint8Array(buffer.length + value.length);
    joined.set(buffer);
    joined.set(value, buffer.length);
    buffer = joined;
  }
  async function ours(path: string): Promise<{ output?: string; error?: string }> {
    try {
      server.stdin.write(path + "\n");
      server.stdin.flush();
      let end: number;
      while ((end = buffer.indexOf(10)) < 0) await fill();
      const line = new TextDecoder().decode(buffer.subarray(0, end));
      buffer = buffer.subarray(end + 1);
      if (!line.startsWith("ok ")) return { error: line };
      const length = Number(line.slice(3));
      while (buffer.length < length) await fill();
      const output = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffer.subarray(0, length));
      buffer = buffer.subarray(length);
      return { output };
    } catch {
      restart();
      return { error: "we panic on" };
    }
  }

  let worker = new Worker(import.meta.url);
  const after = <T>(milliseconds: number, value: T) => new Promise<T>(done => setTimeout(() => done(value), milliseconds));
  const count = { same: 0, differ: 0, "we reject": 0, "Prettier rejects": 0, "of which we accept": 0, "Prettier hangs": 0, "we panic or hang": 0 };
  for (const path of files) {
    const answer = new Promise<any>(done => (worker.onmessage = event => done(event.data)));
    worker.postMessage({ root: flags.get("prettier"), path, options });
    const theirs = await Promise.race([answer, after(4000, { hangs: true })]);
    if (theirs.hangs) {
      count["Prettier hangs"]++;
      worker.terminate();
      worker = new Worker(import.meta.url);
    }
    const mine = await Promise.race([ours(path), after(8000, { error: "we hang on" })]);
    if (mine.error === "we hang on") restart();
    if (mine.error?.startsWith("we ")) {
      count["we panic or hang"]++;
      console.log(mine.error, path);
    } else if (theirs.hangs) {
    } else if (theirs.error !== undefined) {
      count["Prettier rejects"]++;
      if (mine.output !== undefined) {
        count["of which we accept"]++;
        if (flags.has("accepts")) console.log("only we accept", path);
      }
    } else if (mine.output === undefined) {
      count["we reject"]++;
      console.log("only we reject", path);
    } else if (mine.output === theirs.expected) {
      count.same++;
    } else {
      count.differ++;
      console.log("differs", path);
      if (report) {
        mkdirSync(report, { recursive: true });
        const name = path.replaceAll("/", "_");
        writeFileSync(join(report, name + ".expected"), theirs.expected);
        writeFileSync(join(report, name + ".actual"), mine.output);
      }
    }
  }
  console.log(Object.entries(count).map(([what, number]) => `${what} ${number}`).join(", "));
  process.exit(0);
}
