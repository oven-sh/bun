const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { writeSync } = require("node:fs");
const { Readable, pipeline } = require("node:stream");

const [role, fdArg, action] = process.argv.slice(2);
if (role === "child") {
  const fd = Number(fdArg);
  const output = fd === 1 ? process.stdout : process.stderr;
  output.on("error", () => {});
  const timer = setTimeout(() => process.exit(91), 5000);
  const completed = error => {
    assert.ifError(error);
    setImmediate(() => {
      assert.equal(output.writableEnded, false);
      assert.equal(output.writableFinished, false);
      assert.equal(output.destroyed, false);
      output.write("late", error => {
        assert.ifError(error);
        output.cork();
        let pending = 2;
        const done = error => {
          assert.ifError(error);
          if (--pending === 0) {
            writeSync(fd === 1 ? 2 : 1, "ok\n");
            clearTimeout(timer);
          }
        };
        output.write("v1", done);
        output.write("v2", done);
        output.uncork();
      });
    });
  };
  if (action === "end") output.end("before", completed);
  else pipeline(Readable.from(["be", "fore"]), output, completed);
} else {
  assert.equal(process.platform, "win32");
  const executable = process.argv[2] || process.execPath;
  for (const fd of [1, 2]) {
    for (const action of ["end", "pipeline"]) {
      const result = spawnSync(executable, [__filename, "child", String(fd), action], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, `${fd} ${action}: ${result.stdout}\n${result.stderr}`);
      assert.equal(fd === 1 ? result.stdout : result.stderr, "beforelatev1v2");
      assert.equal(fd === 1 ? result.stderr : result.stdout, "ok\n");
    }
  }
  console.log("ok");
}
