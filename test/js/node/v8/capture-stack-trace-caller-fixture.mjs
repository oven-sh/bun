// Prints, for each way to write `fn`, the frames that Error.captureStackTrace(err, fn) leaves: the function names
// down to main(). It runs the same in node, where every list but the generator ones is the same.
let sink = 0; // `sink++` after a call keeps that call out of tail position, so no frame is dropped by a tail call

function frames(stack) {
  const lines = stack.split("\n");
  if (lines[0] !== "Error: boom") throw new Error("unexpected header: " + lines[0]);
  const names = [];
  for (const line of lines.slice(1)) {
    const match = /^ {4}at (async )?(?:(.+?) \(.*\)|.*)$/.exec(line);
    if (!match) throw new Error("unexpected frame: " + line);
    const name = (match[1] ?? "") + (match[2] ?? "<anonymous>");
    if (name === "main" || name === "async main") break;
    names.push(name);
  }
  return names;
}

function capture(hide) {
  const err = new Error("boom");
  Error.captureStackTrace(err, hide);
  sink++;
  return frames(err.stack);
}

async function theCaller(fn) {
  const result = await fn();
  sink++;
  return result;
}

// Each of these awaits first, so it runs in a frame that the microtask queue resumed.
async function declaration() {
  await null;
  const result = capture(declaration);
  sink++;
  return result;
}
const holder = {
  async method() {
    await null;
    const result = capture(holder.method);
    sink++;
    return result;
  },
};
const arrow = async () => {
  await null;
  const result = capture(arrow);
  sink++;
  return result;
};
const expression = async function () {
  await null;
  const result = capture(expression);
  sink++;
  return result;
};
const key = "comp" + "uted";
const computed = {
  async [key]() {
    await null;
    const result = capture(computed[key]);
    sink++;
    return result;
  },
};
async function renamed() {
  await null;
  const result = capture(renamed);
  sink++;
  return result;
}
Object.defineProperty(renamed, "name", { value: "somethingElse" });
class Class {
  static field = async () => {
    await null;
    const result = capture(Class.field);
    sink++;
    return result;
  };
  async method() {
    await null;
    const result = capture(Class.prototype.method);
    sink++;
    return result;
  }
}

// These capture before the first await, or never await.
const arrowBeforeAwait = async () => {
  const result = capture(arrowBeforeAwait);
  sink++;
  await null;
  return result;
};
const arrowWithoutAwait = async () => {
  const result = capture(arrowWithoutAwait);
  sink++;
  return result;
};

// A function with the name of `fn` is above `fn` on the stack.
const sameName = {
  async work() {
    await null;
    const helper = {
      work() {
        const result = capture(sameName.work);
        sink++;
        return result;
      },
    };
    const result = helper.work();
    sink++;
    return result;
  },
};
// A function with the name of `fn` is on the stack, and `fn` is not.
function twin() {}
const otherTwin = {
  twin() {
    const result = capture(twin);
    sink++;
    return result;
  },
};
function callsOtherTwin() {
  const result = otherTwin.twin();
  sink++;
  return result;
}

const generator = function* () {
  const result = capture(generator);
  sink++;
  yield result;
};
function callerOfGenerator() {
  const result = generator().next().value;
  sink++;
  return result;
}
const generatorResumed = function* () {
  yield 1;
  const result = capture(generatorResumed);
  sink++;
  yield result;
};
function callerOfGeneratorResumed() {
  const iterator = generatorResumed();
  iterator.next();
  const result = iterator.next().value;
  sink++;
  return result;
}
const asyncGenerator = async function* () {
  const result = capture(asyncGenerator);
  sink++;
  yield result;
};
async function callerOfAsyncGenerator() {
  const result = (await asyncGenerator().next()).value;
  sink++;
  return result;
}

// `fn` is not running: it awaits the function that captures.
async function awaiting() {
  const result = await awaited();
  sink++;
  return result;
}
async function awaited() {
  await null;
  const result = capture(awaiting);
  sink++;
  return result;
}
const awaitingArrow = async () => {
  const result = await awaitedByArrow();
  sink++;
  return result;
};
async function awaitedByArrow() {
  await null;
  const result = capture(awaitingArrow);
  sink++;
  return result;
}
async function notAwaiting() {}
async function awaitedByNobody() {
  await null;
  const result = capture(notAwaiting);
  sink++;
  return result;
}

// Two closures of one function expression. Each closes over its own `tag`.
const makeHandler = tag =>
  async function handler(next) {
    await null;
    const result = next ? await next() : tag;
    sink++;
    return result;
  };
const outerHandler = makeHandler("outer");
const innerHandler = makeHandler("inner");
async function callerOfHandlers() {
  const result = await outerHandler(() =>
    innerHandler(async () => {
      await null;
      const result = capture(outerHandler);
      sink++;
      return result;
    }),
  );
  sink++;
  return result;
}
// Two closures of one function expression in one scope, before their first await: the body of the inner one runs
// on the inner one's own frame.
const makePlain = () =>
  async function plain(callback) {
    const result = callback();
    sink++;
    await null;
    return result;
  };
const outerPlain = makePlain();
const innerPlain = makePlain();
function callerOfPlain(hide) {
  let result;
  outerPlain(() => {
    innerPlain(() => {
      result = capture(hide);
      sink++;
    });
    sink++;
  });
  sink++;
  return result;
}

// Not a function that can be on the stack: node ignores these.
function withBound() {
  const result = capture(withBound.bind(null));
  sink++;
  return result;
}
function withProxy() {
  const result = capture(new Proxy(withProxy, {}));
  sink++;
  return result;
}
function withObject() {
  const result = capture({});
  sink++;
  return result;
}
// Functions that are not on the stack.
function notOnStack() {}
function withNotOnStack() {
  const result = capture(notOnStack);
  sink++;
  return result;
}
function withBuiltinConstructor() {
  const result = capture(Promise);
  sink++;
  return result;
}

class BaseError extends Error {
  constructor(message) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
    sink++;
  }
}
class DerivedError extends BaseError {}
function makesDerivedError() {
  const error = new DerivedError("boom");
  sink++;
  return frames(error.stack);
}

async function main() {
  const results = {
    declaration: await theCaller(declaration),
    method: await theCaller(holder.method),
    arrow: await theCaller(arrow),
    expression: await theCaller(expression),
    computedKey: await theCaller(computed[key]),
    renamed: await theCaller(renamed),
    classFieldArrow: await theCaller(Class.field),
    classMethod: await theCaller(Class.prototype.method),
    arrowBeforeAwait: await theCaller(arrowBeforeAwait),
    arrowWithoutAwait: await theCaller(arrowWithoutAwait),
    sameNameAbove: await theCaller(sameName.work),
    sameNameOnly: callsOtherTwin(),
    generator: callerOfGenerator(),
    generatorResumed: callerOfGeneratorResumed(),
    asyncGenerator: await callerOfAsyncGenerator(),
    awaiting: await theCaller(awaiting),
    awaitingArrow: await theCaller(awaitingArrow),
    notAwaiting: await theCaller(awaitedByNobody),
    closureOuter: await callerOfHandlers(),
    closureBeforeAwaitOuter: callerOfPlain(outerPlain),
    closureBeforeAwaitInner: callerOfPlain(innerPlain),
    bound: withBound(),
    proxy: withProxy(),
    object: withObject(),
    notOnStack: withNotOnStack(),
    builtinConstructor: withBuiltinConstructor(),
    thisConstructor: makesDerivedError(),
  };
  sink++;
  return results;
}

console.log(JSON.stringify(await main(), null, 2));
