//#FILE: test-stdio-pipe-stderr.js
//#SHA1: 5a30748a31ac72c12cd7438b96a8e09c7c8f07f7
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Test that invoking node with require, and piping stderr to file,
// does not result in exception,
// see: https://github.com/nodejs/node/issues/11257

describe("stdio pipe stderr", () => {
  const tmpdir = path.join(__dirname, "tmp");
  const fakeModulePath = path.join(tmpdir, "batman.js");
  const stderrOutputPath = path.join(tmpdir, "stderr-output.txt");

  beforeAll(() => {
    if (!fs.existsSync(tmpdir)) {
      fs.mkdirSync(tmpdir, { recursive: true });
    }
  });

  afterAll(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test("piping stderr to file should not result in exception", done => {
    // We need to redirect stderr to a file to produce #11257
    const stream = fs.createWriteStream(stderrOutputPath);

    // The error described in #11257 only happens when we require a
    // non-built-in module.
    fs.writeFileSync(fakeModulePath, "", "utf8");

    stream.on("open", () => {
      spawnSync(process.execPath, {
        input: `require(${JSON.stringify(fakeModulePath)})`,
        stdio: ["pipe", "pipe", stream],
      });

      const stderr = fs.readFileSync(stderrOutputPath, "utf8").trim();
      expect(stderr).toBe("");

      stream.end();
      fs.unlinkSync(stderrOutputPath);
      fs.unlinkSync(fakeModulePath);
      done();
    });
  });
});

//<#END_FILE: test-stdio-pipe-stderr.js
