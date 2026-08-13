// Prints one line per scenario saying on which microtask tick each dispose call, block
// exit, and error happened. transpiler.test.js runs this file natively and again with
// `using` / `await using` lowered, and expects identical output.

let tick = 0;
const lines = [];

function describeError(e) {
  if (e && e.name === "SuppressedError") {
    return `Suppressed(${describeError(e.error)} over ${describeError(e.suppressed)})`;
  }
  // The lowered helpers use different TypeError messages than the engine does.
  if (e instanceof TypeError) return "TypeError";
  if (e instanceof Error) return e.message;
  return String(e);
}

async function scenario(name, body) {
  tick = 0;
  const events = [];
  const log = what => events.push(`${what}@${tick}`);
  // Bumps `tick` once per microtask turn. Bounded so it cannot starve the event loop.
  const ticker = (async () => {
    for (let i = 0; i < 32; i++) {
      await null;
      tick++;
    }
  })();
  let settled = false;
  body(log).then(
    value => {
      settled = true;
      log(`returned(${value})`);
    },
    error => {
      settled = true;
      log(`threw(${describeError(error)})`);
    },
  );
  await ticker;
  if (!settled) log("still pending");
  lines.push(`${name}: ${events.join(" ")}`);
}

const asyncDisposable = (log, name) => ({
  async [Symbol.asyncDispose]() {
    log(`asyncDispose(${name})`);
  },
});
const rejectingAsyncDisposable = (log, name) => ({
  async [Symbol.asyncDispose]() {
    log(`asyncDispose(${name})`);
    throw new Error(name);
  },
});
const syncDisposable = (log, name) => ({
  [Symbol.dispose]() {
    log(`dispose(${name})`);
  },
});

await scenario("block exits before a sibling's second tick", async () => {
  const order = [];
  const block = (async () => {
    try {
      await using x = null;
    } finally {
      order.push("using-block-exited");
    }
  })();
  const sibling = (async () => {
    await null;
    order.push("one-tick-later");
  })();
  await block;
  await sibling;
  return order.join(" < ");
});

await scenario("null resource", async log => {
  {
    await using a = null;
  }
  log("exit");
});

await scenario("one async resource", async log => {
  {
    await using a = asyncDisposable(log, "a");
  }
  log("exit");
});

await scenario("three async resources", async log => {
  {
    await using a = asyncDisposable(log, "a");
    await using b = asyncDisposable(log, "b");
    await using c = asyncDisposable(log, "c");
  }
  log("exit");
});

await scenario("asyncDispose returns a thenable", async log => {
  {
    await using a = {
      [Symbol.asyncDispose]() {
        log("asyncDispose(a)");
        return {
          then(resolve) {
            log("then(a)");
            resolve();
          },
        };
      },
    };
  }
  log("exit");
});

await scenario("await using falls back to Symbol.dispose and ignores its return value", async log => {
  {
    await using a = {
      [Symbol.dispose]() {
        log("dispose(a)");
        return new Promise(() => {});
      },
    };
  }
  log("exit");
});

await scenario("await using falls back to Symbol.dispose when Symbol.asyncDispose is null", async log => {
  {
    await using a = {
      [Symbol.asyncDispose]: null,
      [Symbol.dispose]() {
        log("dispose(a)");
      },
    };
  }
  log("exit");
});

await scenario("Symbol.dispose fallback that throws", async log => {
  {
    await using a = {
      [Symbol.dispose]() {
        log("dispose(a)");
        throw new Error("a");
      },
    };
    throw new Error("body");
  }
});

await scenario("asyncDispose that throws synchronously", async log => {
  {
    await using a = {
      [Symbol.asyncDispose]() {
        log("asyncDispose(a)");
        throw new Error("a");
      },
    };
  }
  log("unreachable");
});

await scenario("null resources around a sync resource", async log => {
  {
    await using a = null;
    using b = syncDisposable(log, "b");
    await using c = null;
  }
  log("exit");
});

await scenario("sync resource after an awaited resource and a null resource", async log => {
  {
    using a = syncDisposable(log, "a");
    await using b = asyncDisposable(log, "b");
    await using c = null;
  }
  log("exit");
});

await scenario("two null resources", async log => {
  {
    await using a = null;
    await using b = null;
  }
  log("exit");
});

await scenario("body error plus two rejected disposals", async log => {
  {
    await using a = rejectingAsyncDisposable(log, "a");
    await using b = rejectingAsyncDisposable(log, "b");
    throw new Error("body");
  }
});

await scenario("rejected disposal between two successful ones", async log => {
  {
    await using a = asyncDisposable(log, "a");
    await using b = rejectingAsyncDisposable(log, "b");
    await using c = asyncDisposable(log, "c");
  }
  log("unreachable");
});

await scenario("error thrown before the await using", async log => {
  {
    if (log) throw new Error("before");
    await using a = asyncDisposable(log, "a");
  }
});

await scenario("return value passes through", async log => {
  {
    await using a = asyncDisposable(log, "a");
    await using b = null;
    return 42;
  }
});

await scenario("for-of with an await using binding", async log => {
  for (await using item of [asyncDisposable(log, "x"), asyncDisposable(log, "y")]) {
    log("body");
  }
  log("exit");
});

await scenario("nested blocks", async log => {
  {
    await using a = asyncDisposable(log, "a");
    {
      await using b = asyncDisposable(log, "b");
    }
    log("between");
  }
  log("exit");
});

console.log(lines.join("\n"));
