import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { expect, test } from "bun:test";
import { join } from "node:path";

async function run(dir: string, args: string[]) {
  const proc = Bun.spawn({
    cmd: args,
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  let count = 0;
  let buf = "";

  for await (const chunk of proc.stdout) {
    buf += new TextDecoder().decode(chunk);
    if (buf.includes("START")) {
      count++;
      buf = "";
      if (count === 1) {
        await Bun.write(join(dir, "a/file.js"), `console.log("a touched");`);
      } else if (count === 2) {
        await Bun.write(join(dir, "b/file.js"), `console.log("b touched");`);
      } else if (count === 3) {
        proc.kill();
        break;
      }
    }
  }

  return count;
}

// These two tests collectively verify that the CLI parser accepts repeated
// --watch flags and comma-separated lists, both resulting in two watch globs.

test("bun --watch with repeated flag parses two globs", async () => {
  const dir = tempDirWithFiles("multi-watch-repeated", {
    "runner.js": `console.log("START");`,
    "a/file.js": `console.log("a");`,
    "b/file.js": `console.log("b");`,
  });

  const count = await run(dir, [bunExe(), "--watch", "a", "--watch", "b", "runner.js"]);
  // initial + a change + b change
  expect(count).toBe(3);
}, 20000);


test("bun --watch with comma-separated globs parses two globs", async () => {
  const dir = tempDirWithFiles("multi-watch-comma", {
    "runner.js": `console.log("START");`,
    "a/file.js": `console.log("a");`,
    "b/file.js": `console.log("b");`,
  });

  const count = await run(dir, [bunExe(), "--watch=a,b", "runner.js"]);
  // initial + a change + b change
  expect(count).toBe(3);
}, 20000);
