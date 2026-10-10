// `bun format` against Prettier with prettier-plugin-svelte 4.1.1, on components: real ones, or those of generate.cjs.
//
//   bun against-plugin.ts <bun> <directory with node_modules/prettier, prettier-plugin-svelte and svelte> <directory with .svelte files> ['<options as JSON>']
//
// Prints the files for which the two differ: other bytes, or only one of them refuses. What `bun format` refuses because the plugin would
// damage the file is counted by itself. So is what Prettier does not end on in ten seconds: it runs in a process of its own.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [bun, withPrettier, directory] = process.argv.slice(2, 5).map(it => resolve(it));
const options = JSON.parse(process.argv[5] ?? "{}");

/** For each path on standard input, a line of JSON: what Prettier prints, and whether the plugin has damaged Prettier. */
async function serve() {
  const require = createRequire(withPrettier + "/");
  const prettier = require("prettier");
  const plugin = require("prettier-plugin-svelte");
  console.error = () => {};
  // What the plugin leaves behind for the next file of the process: see make-fixtures.ts.
  const literalline = prettier.doc.builders.literalline;
  const whole = [...literalline];
  for await (const path of console) {
    await prettier.format("<p></p>", { parser: "svelte", plugins: [plugin] });
    const format = prettier.format(readFileSync(path, "utf8"), { ...options, parser: "svelte", plugins: [plugin] });
    const text: string | null = await format.catch(() => null);
    const isDamaged = literalline.length !== whole.length;
    if (isDamaged) literalline.splice(0, literalline.length, ...whole);
    process.stdout.write(JSON.stringify({ text, isDamaged }) + "\n");
  }
}

function startPrettier() {
  const cmd = [process.execPath, import.meta.path, "--serve", withPrettier, directory, JSON.stringify(options)];
  const child = Bun.spawn({ cmd, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  return { child, reader: child.stdout.getReader(), decoder: new TextDecoder(), buffered: "" };
}

async function compare() {
  const names = readdirSync(directory, { recursive: true, encoding: "utf8" }).filter(it => it.endsWith(".svelte"));
  const root = mkdtempSync(join(tmpdir(), "svelte-against-plugin-"));
  let theirs = startPrettier();
  /** `undefined`: it has not ended in time. */
  async function ask(path: string): Promise<{ text: string | null; isDamaged: boolean } | undefined> {
    theirs.child.stdin.write(path + "\n");
    theirs.child.stdin.flush();
    const timer = setTimeout(() => theirs.child.kill(9), 10_000);
    try {
      while (!theirs.buffered.includes("\n")) {
        const { value, done } = await theirs.reader.read();
        if (done) {
          theirs = startPrettier();
          return undefined;
        }
        theirs.buffered += theirs.decoder.decode(value, { stream: true });
      }
    } finally {
      clearTimeout(timer);
    }
    const line = theirs.buffered.slice(0, theirs.buffered.indexOf("\n"));
    theirs.buffered = theirs.buffered.slice(line.length + 1);
    return JSON.parse(line);
  }
  try {
    cpSync(directory, join(root, "src"), { recursive: true, filter: it => !it.includes("node_modules") });
    writeFileSync(join(root, ".prettierrc"), JSON.stringify({ plugins: ["prettier-plugin-svelte"], ...options }));
    const run = spawnSync(bun, ["format", "--log-level=warn", "src"], { cwd: root, maxBuffer: 1 << 30 });
    const refusals = new Map(
      Array.from(`${run.stderr}`.matchAll(/^\[error\] src[\\/](.+?\.svelte): (.*)$/gm), it => [it[1], it[2]]),
    );
    const count = {
      same: 0,
      bothRefuse: 0,
      damaged: 0,
      pluginDamagesPrettier: 0,
      theyDoNotEnd: 0,
      differ: 0,
      onlyWeRefuse: 0,
      onlyTheyRefuse: 0,
    };
    for (const name of names) {
      const answer = await ask(join(directory, name));
      const refusal = refusals.get(name.replaceAll("\\", "/"));
      const ours = refusal === undefined ? readFileSync(join(root, "src", name), "utf8") : null;
      let kind: keyof typeof count = "differ";
      if (answer === undefined) kind = "theyDoNotEnd";
      else if (answer.isDamaged) kind = "pluginDamagesPrettier";
      else if (ours === answer.text) kind = ours === null ? "bothRefuse" : "same";
      else if (refusal?.includes("would change what is in it")) kind = "damaged";
      else if (ours === null) kind = "onlyWeRefuse";
      else if (answer.text === null) kind = "onlyTheyRefuse";
      count[kind]++;
      if (["differ", "onlyWeRefuse", "onlyTheyRefuse", "theyDoNotEnd"].includes(kind)) console.log(`${kind} ${name}`);
    }
    console.log(JSON.stringify(count));
  } finally {
    theirs.child.kill();
    rmSync(root, { recursive: true });
  }
}

await (process.argv[2] === "--serve" ? serve() : compare());
