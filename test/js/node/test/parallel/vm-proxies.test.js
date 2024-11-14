//#FILE: test-vm-proxies.js
//#SHA1: 3119c41e6c3cc80d380c9467c2f922b2df3e5616
//-----------------
"use strict";

const vm = require("vm");

test("Proxy object in new context", () => {
  // src/node_contextify.cc filters out the Proxy object from the parent
  // context.  Make sure that the new context has a Proxy object of its own.
  let sandbox = {};
  vm.runInNewContext("this.Proxy = Proxy", sandbox);
  expect(typeof sandbox.Proxy).toBe("function");
  expect(sandbox.Proxy).not.toBe(Proxy);
});

test("Explicitly copied Proxy object in new context", () => {
  // Unless we copy the Proxy object explicitly, of course.
  const sandbox = { Proxy };
  vm.runInNewContext("this.Proxy = Proxy", sandbox);
  expect(typeof sandbox.Proxy).toBe("function");
  expect(sandbox.Proxy).toBe(Proxy);
});

//<#END_FILE: test-vm-proxies.js
