//#FILE: test-trace-events-worker-metadata-with-name.js
//#SHA1: 5fab08e4c738c70e9a4e505594249990a76637bf
//-----------------
"use strict";
const cp = require("child_process");
const fs = require("fs");
const { isMainThread } = require("worker_threads");
const path = require("path");
const os = require("os");

if (isMainThread) {
  test("trace events worker metadata with name", async () => {
    const CODE =
      "const { Worker } = require('worker_threads'); " + `new Worker(${JSON.stringify(__filename)}, { name: 'foo' })`;
    const FILE_NAME = "node_trace.1.log";
    const tmpdir = os.tmpdir();
    const testDir = path.join(tmpdir, "test-trace-events-worker-metadata-with-name");

    // Create and change to test directory
    await fs.promises.mkdir(testDir, { recursive: true });
    process.chdir(testDir);

    await new Promise(resolve => {
      const proc = cp.spawn(process.execPath, ["--trace-event-categories", "node", "-e", CODE]);
      proc.once("exit", resolve);
    });

    expect(fs.existsSync(FILE_NAME)).toBe(true);

    const data = await fs.promises.readFile(FILE_NAME);
    const traces = JSON.parse(data.toString()).traceEvents;

    expect(traces.length).toBeGreaterThan(0);
    expect(traces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cat: "__metadata",
          name: "thread_name",
          args: { name: "[worker 1] foo" },
        }),
      ]),
    );
  });
} else {
  // Do nothing here.
}

//<#END_FILE: test-trace-events-worker-metadata-with-name.js
