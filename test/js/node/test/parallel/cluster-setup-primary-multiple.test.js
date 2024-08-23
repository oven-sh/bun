//#FILE: test-cluster-setup-primary-multiple.js
//#SHA1: a0b16cb2b01b0265f98508f2a6a9974396b6b03a
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
const debug = require("util").debuglog("test");

test("cluster setup primary multiple times", async () => {
  expect(cluster.isPrimary).toBe(true);

  // The cluster.settings object is cloned even though the current implementation
  // makes that unnecessary. This is to make the test less fragile if the
  // implementation ever changes such that cluster.settings is mutated instead of
  // replaced.
  const cheapClone = obj => JSON.parse(JSON.stringify(obj));

  const configs = [];

  // Capture changes
  cluster.on("setup", () => {
    debug(`"setup" emitted ${JSON.stringify(cluster.settings)}`);
    configs.push(cheapClone(cluster.settings));
  });

  const execs = ["node-next", "node-next-2", "node-next-3"];

  // Make changes to cluster settings
  for (let i = 0; i < execs.length; i++) {
    await new Promise(resolve => {
      setTimeout(() => {
        cluster.setupPrimary({ exec: execs[i] });
        resolve();
      }, i * 100);
    });
  }

  // Cluster emits 'setup' asynchronously, so we must stay alive long
  // enough for that to happen
  await new Promise(resolve => {
    setTimeout(
      () => {
        debug("cluster setup complete");
        resolve();
      },
      (execs.length + 1) * 100,
    );
  });

  // Tests that "setup" is emitted for every call to setupPrimary
  expect(configs.length).toBe(execs.length);

  expect(configs[0].exec).toBe(execs[0]);
  expect(configs[1].exec).toBe(execs[1]);
  expect(configs[2].exec).toBe(execs[2]);
});

//<#END_FILE: test-cluster-setup-primary-multiple.js
