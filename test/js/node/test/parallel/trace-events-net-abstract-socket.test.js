//#FILE: test-trace-events-net-abstract-socket.js
//#SHA1: 1e3ce82530d15c9598bea3a34d563407dc1cdf25
//-----------------
"use strict";

const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const isLinux = process.platform === "linux";

if (!isLinux) {
  test.skip("This test is Linux-only", () => {});
} else {
  const PIPE = "\0test.sock";
  const tmpdir = os.tmpdir();

  const CODE = `
    const net = require('net');
    net.connect('${PIPE}').on('error', () => {});
    net.connect('\\0${PIPE}').on('error', () => {});
  `;

  const FILE_NAME = path.resolve(tmpdir, "node_trace.1.log");

  test("trace events for net abstract socket", done => {
    const proc = cp.spawn(
      process.execPath,
      ["--trace-events-enabled", "--trace-event-categories", "node.net.native", "-e", CODE],
      { cwd: tmpdir },
    );

    proc.once("exit", () => {
      expect(fs.existsSync(FILE_NAME)).toBe(true);
      fs.readFile(FILE_NAME, (err, data) => {
        expect(err).toBeFalsy();
        const traces = JSON.parse(data.toString()).traceEvents;
        expect(traces.length).toBeGreaterThan(0);
        let count = 0;
        traces.forEach(trace => {
          if (trace.cat === "node,node.net,node.net.native" && trace.name === "connect") {
            count++;
            if (trace.ph === "b") {
              expect(trace.args.path_type).toBeTruthy();
              expect(trace.args.pipe_path).toBeTruthy();
            }
          }
        });
        expect(count).toBe(4);
        done();
      });
    });
  });
}

//<#END_FILE: test-trace-events-net-abstract-socket.js
