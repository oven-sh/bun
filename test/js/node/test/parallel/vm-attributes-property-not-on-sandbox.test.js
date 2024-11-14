//#FILE: test-vm-attributes-property-not-on-sandbox.js
//#SHA1: c864df0cb9b3ab90c8582ad86f50a8e94be92114
//-----------------
"use strict";
const vm = require("vm");

// Assert that accessor descriptors are not flattened on the sandbox.
// Issue: https://github.com/nodejs/node/issues/2734
test("accessor descriptors are not flattened on the sandbox", () => {
  const sandbox = {};
  vm.createContext(sandbox);
  const code = `Object.defineProperty(
               this,
               'foo',
               { get: function() {return 17} }
             );
             var desc = Object.getOwnPropertyDescriptor(this, 'foo');`;

  vm.runInContext(code, sandbox);
  expect(typeof sandbox.desc.get).toBe("function");
});

//<#END_FILE: test-vm-attributes-property-not-on-sandbox.js
