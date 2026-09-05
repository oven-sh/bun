// CJS fixture for the auto-mocker: a plain `module.exports` object with a
// function, a class and a constant. Has no `default`, so the auto-mock must
// synthesize one for `import pkg from ...` consumers.
function doWork() {
  return "real-work";
}

class Engine {
  start() {
    return "started";
  }
}

module.exports = {
  doWork,
  Engine,
  LIMIT: 99,
};
