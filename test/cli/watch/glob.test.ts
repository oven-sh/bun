import { bunExe, bunEnv, tempDirWithFiles } from "harness";
import { expect, test } from "bun:test";
import { join } from "path";
import { write, sleep } from "bun";

async function runTest(dir: string, cmd: string[]) {
  const proc = Bun.spawn({
    cmd,
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  let stdout = "";
  let count = 0;

  for await (const chunk of proc.stdout) {
    stdout += new TextDecoder().decode(chunk);
    if (stdout.includes("START")) {
      count++;
      stdout = "";
      if (count === 1) {
        await write(join(dir, "lib/a.js"), `console.log("a modified");`);
      } else if (count === 2) {
        await write(join(dir, "lib/b.js"), `console.log("b modified");`);
      } else if (count === 3) {
        await write(join(dir, "src/c.js"), `console.log("c modified");`);
      } else if (count === 4) {
        proc.kill();
        break;
      }
    }
  }

  return count;
}

test("bun run --watch with comma-separated glob", async () => {
  const dir = tempDirWithFiles("watch-glob-comma", {
    "runner.js": `console.log("START");`,
    "lib/a.js": `console.log("a");`,
    "lib/b.js": `console.log("b");`,
    "src/c.js": `console.log("c");`,
  });

  const count = await runTest(dir, [bunExe(), "run", "--watch=lib/*.js,src/*.js", "runner.js"]);
  expect(count).toBe(4);
}, 20000);

test("bun run --watch with repeated flag", async () => {
  const dir = tempDirWithFiles("watch-glob-repeated", {
    "runner.js": `console.log("START");`,
    "lib/a.js": `console.log("a");`,
    "lib/b.js": `console.log("b");`,
    "src/c.js": `console.log("c");`,
  });

  const count = await runTest(dir, [bunExe(), "run", "--watch=lib/*.js", "--watch=src/*.js", "runner.js"]);
  expect(count).toBe(4);
}, 20000);

test("bun test --watch with glob", async () => {
  const dir = tempDirWithFiles("watch-glob-test", {
    "dummy.test.js": `
      import { test, expect } from 'bun:test';
      test('dummy', () => {
        console.log("START");
        expect(1).toBe(1);
      });
    `,
    "lib/a.js": `console.log("a");`,
    "lib/b.js": `console.log("b");`,
    "src/c.js": `console.log("c");`,
  });

  const count = await runTest(dir, [bunExe(), "test", "--watch=lib/*.js,src/*.js"]);
  expect(count).toBe(4);
}, 20000);

test("bun run --watch with directory glob", async () => {
  const dir = tempDirWithFiles("watch-glob-dir", {
    "runner.js": `console.log("START");`,
    "lib/a.js": `console.log("a");`,
    "lib/b.js": `console.log("b");`,
    "src/c.js": `console.log("c");`,
  });

  const count = await runTest(dir, [bunExe(), "run", "--watch=lib/**,src/**", "runner.js"]);
  expect(count).toBe(4);
}, 20000);
