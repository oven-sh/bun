import { expect, it } from "bun:test";
import { bunExe, tempDirWithFiles } from "harness";

it("should wrap passthrough arguments with doublequote", () => {
  const package_json = JSON.stringify({
    scripts: {
      test: `${bunExe()} test.js $1`,
    },
  });
  const dir = tempDirWithFiles("run-warp-arguments", { "package.json": package_json, "test.js": "console.log(process.argv[2])"});
  const { stdout } = Bun.spawnSync({
    cmd: [bunExe(), "run", "test", "Hello World"],
    cwd: dir,
  });
  expect(stdout.toString("utf8").trim()).toBe("Hello World");
});