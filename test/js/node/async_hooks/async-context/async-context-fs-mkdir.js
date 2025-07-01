const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');

const asyncLocalStorage = new AsyncLocalStorage();
const testDir = path.join('/tmp', 'mkdir-test-' + Date.now());

asyncLocalStorage.run({ test: 'fs.mkdir' }, () => {
  fs.mkdir(testDir, (err) => {
    if (asyncLocalStorage.getStore()?.test !== 'fs.mkdir') {
      console.error('FAIL: fs.mkdir callback lost context');
      try { fs.rmdirSync(testDir); } catch {}
      process.exit(1);
    }
    fs.rmdirSync(testDir);
    process.exit(0);
  });
});