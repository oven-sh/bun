const vm = require("node:vm");

const microtaskMode = process.argv[2];

let context;
if (microtaskMode === "undefined") {
  context = vm.createContext({ console });
} else {
  context = vm.createContext({ console }, { microtaskMode });
}

const code = `
  Promise.resolve().then(() => {
    console.log('Microtask inside VM');
  });

  Promise.resolve().then(() => {
    console.log('Microtask inside VM 2');
  });

  console.log('End of VM code');
`;

console.log("Before vm.runInContext");

Promise.resolve().then(() => {
  console.log("Microtask outside VM");
});

vm.runInContext(code, context);

console.log("After vm.runInContext");
