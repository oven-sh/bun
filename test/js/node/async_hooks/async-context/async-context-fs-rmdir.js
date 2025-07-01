const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');

const asyncLocalStorage = new AsyncLocalStorage();
const testDir = path.join('/tmp', 'rmdir-test-' + Date.now());

fs.mkdirSync(testDir);

asyncLocalStorage.run({ test: 'fs.rmdir' }, () => {
  fs.rmdir(testDir, (err) => {
    if (asyncLocalStorage.getStore()?.test !== 'fs.rmdir') {
      console.error('FAIL: fs.rmdir callback lost context');
      process.exit(1);
    }
    process.exit(0);
  });
});