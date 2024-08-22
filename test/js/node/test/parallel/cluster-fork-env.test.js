//#FILE: test-cluster-fork-env.js
//#SHA1: 1aa202aeaabf6b9ea83686f38c56516e019364fc
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";

const cluster = require("cluster");

// This test checks that arguments provided to cluster.fork() will create
// new environment variables and override existing environment variables
// in the created worker process.

if (cluster.isWorker) {
  const result = cluster.worker.send({
    prop: process.env.cluster_test_prop,
    overwrite: process.env.cluster_test_overwrite,
  });

  expect(result).toBe(true);
} else if (cluster.isPrimary) {
  test("cluster.fork() creates and overrides environment variables", async () => {
    // To check that the cluster extend on the process.env we will overwrite a
    // property
    process.env.cluster_test_overwrite = "old";

    // Fork worker
    const worker = cluster.fork({
      cluster_test_prop: "custom",
      cluster_test_overwrite: "new",
    });

    // Checks worker env
    const data = await new Promise(resolve => {
      worker.on("message", resolve);
    });

    expect(data.prop).toBe("custom");
    expect(data.overwrite).toBe("new");

    worker.disconnect();
  });
}

//<#END_FILE: test-cluster-fork-env.js
