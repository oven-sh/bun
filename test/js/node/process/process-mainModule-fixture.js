process.mainModule = process.mainModule;

module.exports = {};

if (module.exports !== process.mainModule.exports) {
  throw new Error("module.exports !== process.mainModule");
}

if (require.main !== process.mainModule) {
  throw new Error("require.main !== process.mainModule");
}

process.mainModule = { abc: 123 };

if (require.main === process.mainModule) {
  throw new Error("require.main === process.mainModule");
}

process.exit(0);
