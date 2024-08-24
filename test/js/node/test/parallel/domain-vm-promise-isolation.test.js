//#FILE: test-domain-vm-promise-isolation.js
//#SHA1: 866cac427030e1696a6583c234815beed16bf5c8
//-----------------
"use strict";

const domain = require("domain");
const vm = require("vm");

// A promise created in a VM should not include a domain field but
// domains should still be able to propagate through them.
//
// See; https://github.com/nodejs/node/issues/40999

const context = vm.createContext({});

function run(code) {
  const d = domain.createDomain();
  d.run(() => {
    const p = vm.runInContext(code, context)();
    expect(p.domain).toBeUndefined();
    return p.then(() => {
      expect(process.domain).toBe(d);
    });
  });
}

test("VM promise isolation and domain propagation", async () => {
  const runPromises = [];
  for (let i = 0; i < 1000; i++) {
    runPromises.push(run("async () => null"));
  }
  await Promise.all(runPromises);
}, 30000); // Increased timeout for multiple iterations

//<#END_FILE: test-domain-vm-promise-isolation.js
