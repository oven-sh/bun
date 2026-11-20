// Prints the names of the `at async` frames of native rejections whose awaiters
// form a cycle. The walk that collects the frames has to end, and it has to
// name each function once.
const native = () => Bun.file("/nonexistent-path/does-not-exist.txt").stat();

function asyncFrameNames(error: any): string[] {
  if (error?.code !== "ENOENT") throw new Error(`expected ENOENT, got ${error}`);
  return String(error.stack)
    .split("\n")
    .filter(line => line.includes("at async "))
    .map(line => line.trim().split(" ")[2]);
}
function asyncFramesOf(promise: Promise<unknown>): Promise<string[]> {
  return promise.then(() => {
    throw new Error("expected a rejection");
  }, asyncFrameNames);
}

// Array.fromAsync() is an async function of JSC. It has no frame, so a cycle
// that has no other async function gives the walk no frame to count.
async function caller() {
  await Array.fromAsync({
    length: 1,
    get 0() {
      return native();
    },
  });
}

function builtinAwaitsRaceWithItsOwnPromise() {
  let promise: Promise<unknown>;
  promise = Array.fromAsync({
    length: 2,
    0: null,
    get 1() {
      return Promise.race([promise, native()]);
    },
  });
  return asyncFramesOf(promise);
}

// reader() catches the rejection. Array.fromAsync() awaits a race of reader()
// and its own promise.
function functionBeforeBuiltinCycle() {
  const frames = Promise.withResolvers<string[]>();
  async function reader() {
    try {
      await native();
    } catch (error) {
      frames.resolve(asyncFrameNames(error));
    }
  }
  let promise: Promise<unknown>;
  promise = Array.fromAsync({
    length: 2,
    0: null,
    get 1() {
      return Promise.race([promise, reader()]);
    },
  });
  return frames.promise;
}

function builtinAwaitsRaceWithItsThenResult() {
  let result: Promise<unknown>;
  let steps = 0;
  const promise = Array.fromAsync({
    [Symbol.asyncIterator]: () => ({
      next: () =>
        (steps++ ? Promise.race([native(), result]) : Promise.resolve({ value: 1, done: false })) as Promise<
          IteratorResult<unknown>
        >,
    }),
  });
  const frames = asyncFramesOf(promise);
  result = promise.then(value => value);
  result.catch(() => {});
  return frames;
}

function functionAwaitsRaceWithItsThenResult() {
  const rejected = native();
  const frames = asyncFramesOf(rejected);
  let result: Promise<unknown>;
  async function worker() {
    await null;
    await Promise.race([rejected, result]);
  }
  result = worker().then(value => value);
  result.catch(() => {});
  return frames;
}

// The race is a thenable here. It gives the two functions of the one await to
// both promises, so the walk comes to worker() from each of them.
function functionAwaitsThenableRaceWithItsThenResult() {
  const rejected = native();
  const frames = asyncFramesOf(rejected);
  let result: Promise<unknown>;
  async function worker() {
    await null;
    await {
      then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
        rejected.then(resolve, reject);
        result.then(resolve, reject);
      },
    };
  }
  result = worker().then(value => value);
  result.catch(() => {});
  return frames;
}

// first() awaits a race that has the promise of second(), and second() awaits
// the promise of first().
function twoFunctionsAwaitEachOther() {
  let firstPromise: Promise<unknown>;
  let secondPromise: Promise<unknown>;
  const rejected = native();
  const frames = asyncFramesOf(rejected);
  async function inner() {
    await rejected;
  }
  async function first() {
    await null;
    await Promise.race([secondPromise, inner()]);
  }
  async function second() {
    await null;
    await firstPromise;
  }
  firstPromise = first();
  secondPromise = second();
  firstPromise.catch(() => {});
  secondPromise.catch(() => {});
  return frames;
}

// A cycle of direct awaits. The walk gets into it through a then() whose
// species constructor returns a promise of the cycle.
function rejectionWithThenResult(result: Promise<unknown>) {
  const rejected = native();
  const frames = asyncFramesOf(rejected);
  Object.defineProperty(rejected, "constructor", {
    configurable: true,
    value: {
      [Symbol.species]: function (executor: (resolve: () => void, reject: () => void) => void) {
        executor(
          () => {},
          () => {},
        );
        return result;
      },
    },
  });
  rejected.then(value => value);
  return frames;
}
async function builtinAwaitsItsOwnPromise() {
  let promise: Promise<unknown>;
  promise = Array.fromAsync({
    length: 2,
    0: null,
    get 1() {
      return promise;
    },
  });
  // Array.fromAsync() is at its second await after these.
  for (let i = 0; i < 4; i++) await null;
  return rejectionWithThenResult(promise);
}
async function functionAwaitsItsOwnPromise() {
  let promise: Promise<unknown>;
  async function selfAwait() {
    await null;
    await promise;
  }
  promise = selfAwait();
  for (let i = 0; i < 4; i++) await null;
  return rejectionWithThenResult(promise);
}

async function level3() {
  await native();
}
async function level2() {
  await level3();
}
async function level1() {
  await level2();
}

const frames: Record<string, string[]> = {};
frames["Array.fromAsync() has no frame"] = await asyncFramesOf(caller());
frames["a builtin awaits a race with its own promise"] = await builtinAwaitsRaceWithItsOwnPromise();
frames["a function before a cycle of builtins"] = await functionBeforeBuiltinCycle();
frames["a function awaits a thenable race with its then() result"] =
  await functionAwaitsThenableRaceWithItsThenResult();
frames["two functions await each other"] = await twoFunctionsAwaitEachOther();
frames["a builtin awaits its own promise"] = await builtinAwaitsItsOwnPromise();
frames["a function awaits its own promise"] = await functionAwaitsItsOwnPromise();
Error.stackTraceLimit = 2;
frames["Error.stackTraceLimit = 2"] = await asyncFramesOf(level1());
Error.stackTraceLimit = Infinity;
frames["Error.stackTraceLimit = Infinity, a function awaits its own promise"] = await functionAwaitsItsOwnPromise();
frames["Error.stackTraceLimit = Infinity, a function awaits a race with its then() result"] =
  await functionAwaitsRaceWithItsThenResult();
// From here on then() keeps its result in a capability record.
Promise.prototype.constructor = Promise;
frames["a builtin awaits a race with its then() result, in a capability record"] =
  await builtinAwaitsRaceWithItsThenResult();
console.log(JSON.stringify(frames));
