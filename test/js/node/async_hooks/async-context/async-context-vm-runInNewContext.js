process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const vm = require("vm");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "vm.runInNewContext" }, () => {
  const code = `
    setImmediate(() => {
      if (asyncLocalStorage.getStore()?.test !== 'vm.runInNewContext') {
        console.error('FAIL: vm.runInNewContext callback lost context');
        process.exit(1);
      }
      process.exit(0);
    });
  `;

  vm.runInNewContext(code, {
    asyncLocalStorage,
    setImmediate,
    console,
    process,
  });
});
