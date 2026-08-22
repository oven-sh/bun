// Run under a small `ulimit -n`. Recursive rm has to open the directory it is
// removing, so once this process has used up its fd table every attempt fails
// with EMFILE, one of the errors fs.rm's `maxRetries` retries on. Unlike a
// locked directory on Windows, the condition can be created and cleared
// deterministically from inside the process, on every POSIX platform.
//
// argv: <sync|promise|callback> <gives-up|recovers|vanishes> <scratch dir>
//   gives-up: nothing clears the condition; rm must fail with EMFILE only after
//             sleeping retryDelay, 2 * retryDelay, ... between the attempts.
//   recovers: the fds are released while rm is retrying; rm must succeed.
//   vanishes: the (empty) directory is rmdir'd out from under rm while it is
//             retrying (rmdir needs no fd); rm must treat the ENOENT of the next
//             attempt as success even though `force` was not passed.
//
// The attempts themselves are not observable from outside rm, so the release
// can only be scheduled on a timer. RELEASE_DELAY_MS only has to outlast the
// first attempt, which starts as soon as the release has been scheduled, while
// the retry schedule below keeps going for over ten seconds, so a late timer
// cannot turn into a spurious failure.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort } = require("node:worker_threads");

const RELEASE_DELAY_MS = 300;

function release(action, fds, dir) {
  if (action === "close") {
    for (const fd of fds) fs.closeSync(fd);
  } else {
    fs.rmdirSync(dir);
  }
}

if (!isMainThread) {
  // rmSync blocks the main thread for the whole retry loop, so the release has
  // to come from another thread. Everything the worker needs is loaded before
  // it reports ready, because by the time the message arrives no fd is left.
  parentPort.once("message", ({ action, fds, dir }) => {
    setTimeout(release, RELEASE_DELAY_MS, action, fds, dir);
  });
  parentPort.postMessage("ready");
} else {
  main();
}

async function main() {
  const [flavor, scenario, scratch] = process.argv.slice(2);
  const dir = path.join(scratch, "target");
  fs.mkdirSync(dir);
  // `vanishes` rmdir's the directory out from under rm, so it has to stay empty.
  if (scenario !== "vanishes") fs.writeFileSync(path.join(dir, "file.txt"), "x");

  const rm = {
    sync: options => fs.rmSync(dir, options),
    promise: options => fs.promises.rm(dir, options),
    callback: options => {
      const { promise, resolve, reject } = Promise.withResolvers();
      fs.rm(dir, options, err => (err ? reject(err) : resolve()));
      return promise;
    },
  }[flavor];
  const errorCode = async fn => {
    try {
      await fn();
      return "ok";
    } catch (err) {
      return err.code;
    }
  };

  let worker;
  if (flavor === "sync" && scenario !== "gives-up") {
    worker = new Worker(__filename);
    await new Promise(resolve => worker.once("message", resolve));
    // Let the process exit once main() is done instead of waiting for the worker.
    worker.unref();
  }

  const fds = [];
  try {
    for (;;) fds.push(fs.openSync(os.devNull, "r"));
  } catch (err) {
    if (err.code !== "EMFILE") throw err;
  }

  // Proves the condition is in place (and that the default is still no retry)
  // before the retrying call below is timed.
  const probe = await errorCode(() => rm({ recursive: true }));

  let options;
  if (scenario === "gives-up") {
    options = { recursive: true, maxRetries: 2, retryDelay: 100 };
  } else {
    options = { recursive: true, maxRetries: 20, retryDelay: 50 };
    const action = scenario === "recovers" ? "close" : "rmdir";
    if (worker) worker.postMessage({ action, fds, dir });
    else setTimeout(release, RELEASE_DELAY_MS, action, fds, dir);
  }

  const start = performance.now();
  const result = await errorCode(() => rm(options));
  const elapsedMs = performance.now() - start;

  console.log(JSON.stringify({ probe, result, existsAfter: fs.existsSync(dir), elapsedMs }));
}
