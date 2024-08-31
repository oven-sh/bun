//#FILE: test-cluster-listen-pipe-readable-writable.js
//#SHA1: ec8b0021cb41214529af900b088dce4d31db708d
//-----------------
"use strict";

const cluster = require("cluster");
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PIPE = path.join(os.tmpdir(), "test.sock");

if (process.platform === "win32") {
  test.skip("skip on Windows", () => {});
} else {
  if (cluster.isPrimary) {
    test("cluster worker can listen on pipe with readable and writable permissions", () => {
      const worker = cluster.fork();
      worker.on("exit", code => {
        expect(code).toBe(0);
      });
    });
  } else {
    test("server listens on pipe with correct permissions", done => {
      const server = net.createServer().listen(
        {
          path: PIPE,
          readableAll: true,
          writableAll: true,
        },
        () => {
          const stat = fs.statSync(PIPE);
          expect(stat.mode & 0o777).toBe(0o777);
          server.close();
          process.disconnect();
          done();
        },
      );
    });
  }
}

//<#END_FILE: test-cluster-listen-pipe-readable-writable.js
