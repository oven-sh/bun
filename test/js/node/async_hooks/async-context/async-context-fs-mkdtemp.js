const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: 'fs.mkdtemp' }, () => {
  fs.mkdtemp(path.join('/tmp', 'test-'), (err, directory) => {
    if (asyncLocalStorage.getStore()?.test !== 'fs.mkdtemp') {
      console.error('FAIL: fs.mkdtemp callback lost context');
      try { fs.rmdirSync(directory); } catch {}
      process.exit(1);
    }
    fs.rmdirSync(directory);
    process.exit(0);
  });
});