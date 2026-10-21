// Prints, as JSON, the frames of an Error per way of waiting for the job that made it.
// Each shape is awaited by caller(), which the module awaits at its top level.
// Run with node to compare: the frames that differ from V8 are noted in stack.test.ts.
import { AsyncLocalStorage } from "node:async_hooks";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const file = basename(fileURLToPath(import.meta.url));

// The argument puts the realm in a state where a promise keeps its reactions in another way:
// with an async context, or with the fast paths of promises off.
switch (process.argv[2]) {
  case "async context":
    new AsyncLocalStorage().enterWith({});
    break;
  case "then() replaced": {
    const then = Promise.prototype.then;
    Promise.prototype.then = function (onFulfilled, onRejected) {
      return then.call(this, onFulfilled, onRejected);
    };
    break;
  }
  case "constructor written":
    Promise.prototype.constructor = Promise;
    break;
  case "prototype frozen":
    Object.freeze(Promise.prototype);
    break;
}

// Throws in a later turn of the event loop, so that every promise of a shape has its reaction by then.
async function failing() {
  await new Promise(resolve => setImmediate(resolve));
  throw new Error("failing");
}

function thrower() {
  throw new Error("thrower");
}

class SubPromise extends Promise {}

const shapes = {
  async direct() {
    await failing();
  },
  async all() {
    await Promise.all([failing()]);
  },
  async race() {
    await Promise.race([failing()]);
  },

  // A promise that then(), catch() or finally() returned.
  async then() {
    await failing().then(v => v);
  },
  async thenBoth() {
    await failing().then(
      v => v,
      e => {
        throw e;
      },
    );
  },
  async catch_() {
    await failing().catch(e => {
      throw e;
    });
  },
  async finally_() {
    await failing().finally(() => {});
  },
  async thenWithoutHandlers() {
    await failing().then();
  },
  async thenCatchFinally() {
    await failing()
      .then(v => v)
      .catch(e => {
        throw e;
      })
      .finally(() => {});
  },

  // A promise that was resolved with the promise.
  async returnWithoutAwait() {
    async function inner() {
      return failing();
    }
    await inner();
  },
  async resolveOfConstructor() {
    await new Promise(resolve => resolve(failing()));
  },
  async resolveOfWithResolvers() {
    const { promise, resolve } = Promise.withResolvers();
    resolve(failing());
    await promise;
  },
  async handlerReturnsPromise() {
    await Promise.resolve(1).then(() => failing());
  },
  async finallyHandlerReturnsPromise() {
    await Promise.resolve(1).finally(() => failing());
  },

  // A resolving function as the handler.
  async thenWithResolvingFunctions() {
    const { promise, resolve, reject } = Promise.withResolvers();
    failing().then(resolve, reject);
    await promise;
  },
  async thenable() {
    await {
      then(resolve, reject) {
        failing().then(resolve, reject);
      },
    };
  },

  // The resolve function of `new Promise` as the handler.
  async constructorFunctionsAsHandlers() {
    await new Promise((resolve, reject) => failing().then(resolve, reject));
  },
  async constructorFunctionsInThenAndCatch() {
    await new Promise((resolve, reject) => {
      failing().then(resolve).catch(reject);
    });
  },

  // Combinators and then() inside each other.
  async allOfThen() {
    await Promise.all([failing().then(v => v)]);
  },
  async thenOfAll() {
    await Promise.all([failing()]).then(v => v);
  },
  async raceOfThen() {
    await Promise.race([failing().then(v => v)]);
  },
  async thenOfRace() {
    await Promise.race([failing()]).then(v => v);
  },
  async allOfAll() {
    await Promise.all([Promise.all([failing()])]);
  },

  // A subclass.
  async subclassResolvedWithPromise() {
    await SubPromise.resolve(failing());
  },
  async allSettledOfSubclass() {
    await SubPromise.allSettled([failing()]).then(([result]) => {
      throw result.reason;
    });
  },

  // `for await`, and an async generator.
  async forAwaitOfArray() {
    for await (const _ of [failing()]) {
    }
  },
  async asyncGeneratorAwaits() {
    async function* generator() {
      yield await failing();
    }
    for await (const _ of generator()) {
    }
  },

  // The Error is made in a handler: no async function is on the stack.
  async handlerThrows() {
    await Promise.resolve(1).then(thrower);
  },
  async catchHandlerThrows() {
    await Promise.reject(1).catch(thrower);
  },
  async finallyHandlerThrows() {
    await Promise.resolve(1).finally(thrower);
  },
  async handlerOfPendingPromiseThrows() {
    await new Promise(resolve => setImmediate(resolve)).then(thrower);
  },
  async handlerThrowsThenThen() {
    await Promise.resolve(1)
      .then(thrower)
      .then(v => v);
  },
  async boundHandlerThrows() {
    await Promise.resolve(1).then(thrower.bind(null));
  },
  async handlerInForAwaitThrows() {
    async function* generator() {
      yield 1;
    }
    for await (const _ of generator()) await Promise.resolve(1).then(thrower);
  },
  async thenOfThenableThrows() {
    await {
      then() {
        thrower();
      },
    };
  },
  async asyncGeneratorBodyThrows() {
    async function* generator() {
      await 0;
      thrower();
    }
    for await (const _ of generator()) {
    }
  },

  // The promise has two reactions.
  async twoReactions() {
    const promise = failing();
    promise.catch(() => {});
    await promise.then(v => v);
  },
  // The handlers are resolving functions of another promise, and nothing waits for that promise.
  async resultOfThenWithResolvingFunctions() {
    const { promise, resolve, reject } = Promise.withResolvers();
    await failing().then(resolve, reject);
    await promise;
  },
  // The handler settles a capability, not a promise.
  async handlerOnSubclassThrows() {
    await SubPromise.resolve(1).then(thrower);
  },
  // A reject function is a handler like any other: nothing waits for what then() returned.
  async rejectFunctionAsFulfillHandler() {
    await new Promise((resolve, reject) => failing().then(reject, reject));
  },
  // return(promise) of an async generator waits for the promise.
  async returnOfAsyncGenerator() {
    async function* generator() {}
    await generator().return(failing());
  },
};

function framesOf(error) {
  const frames = [];
  for (let line of String(error.stack).split("\n").slice(1)) {
    line = line.trim();
    if (!line.includes(file)) continue;
    const match = /^at (async )?(?:(.+?) \(.*\)|.*)$/.exec(line);
    frames.push((match[1] ?? "") + (match[2] ?? "<module>"));
  }
  return frames;
}

const result = {};
for (const [name, shape] of Object.entries(shapes)) {
  async function caller() {
    await shape();
  }
  try {
    await caller();
    result[name] = "did not throw";
  } catch (e) {
    result[name] = framesOf(e);
  }
}
console.log(JSON.stringify(result, null, 2));
