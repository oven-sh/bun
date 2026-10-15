import { expect, test } from "bun:test";

test("test timeout kills dangling processes", async () => {
  Bun.spawn({
    cmd: [process.execPath, "--eval", "Bun.sleepSync(50); console.log('This should not be printed!');"],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  await Bun.sleep(5);
}, 1);

test("slow test after test timeout", async () => {
  await Bun.sleep(100);
  console.log("Ran slow test");
});
