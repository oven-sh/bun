// Async functions and generators whose name comes from the binding they are assigned to (`const f = async () => {}`).
// Prints the names of their stack frames, and the frames that Error.captureStackTrace(err, fn) leaves, down to main().
// The bindings are at module scope, where the transpiler keeps them.
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

// With `hide`, the frames Error.captureStackTrace(err, hide) leaves. Without it, all frames of the caller.
function capture(hide) {
  const err = new Error("boom");
  if (hide) Error.captureStackTrace(err, hide);
  sink++;
  const names = frames(err.stack);
  return hide ? names : names.slice(1);
}

async function theCaller(fn, hide) {
  const result = await fn(hide);
  sink++;
  return result;
}

const arrow = async hide => {
  await null;
  const result = capture(hide);
  sink++;
  return result;
};
const arrowBeforeAwait = async hide => {
  const result = capture(hide);
  sink++;
  await null;
  return result;
};
const expression = async function (hide) {
  await null;
  const result = capture(hide);
  sink++;
  return result;
};
const object = {
  property: async hide => {
    await null;
    const result = capture(hide);
    sink++;
    return result;
  },
};
class Class {
  static field = async hide => {
    await null;
    const result = capture(hide);
    sink++;
    return result;
  };
}
let assigned;
assigned = async hide => {
  await null;
  const result = capture(hide);
  sink++;
  return result;
};
const generator = function* (hide) {
  const result = capture(hide);
  sink++;
  yield result;
};
function callerOfGenerator(hide) {
  const result = generator(hide).next().value;
  sink++;
  return result;
}
const generatorResumed = function* (hide) {
  yield 1;
  const result = capture(hide);
  sink++;
  yield result;
};
function callerOfGeneratorResumed(hide) {
  const iterator = generatorResumed(hide);
  iterator.next();
  const result = iterator.next().value;
  sink++;
  return result;
}
const asyncGenerator = async function* (hide) {
  const result = capture(hide);
  sink++;
  yield result;
};
async function callerOfAsyncGenerator(hide) {
  const result = (await asyncGenerator(hide).next()).value;
  sink++;
  return result;
}
// `awaits` is not running when the stack is made: it awaits `declaration`.
const awaits = async () => {
  const result = await declaration();
  sink++;
  return result;
};
async function declaration(hide) {
  await null;
  const result = capture(hide);
  sink++;
  return result;
}

async function main() {
  const results = {
    // The frames of each function, by name.
    names: {
      arrow: await arrow(),
      arrowBeforeAwait: await arrowBeforeAwait(),
      expression: await expression(),
      property: await object.property(),
      classField: await Class.field(),
      assigned: await assigned(),
      generator: callerOfGenerator(),
      generatorResumed: callerOfGeneratorResumed(),
      asyncGenerator: await callerOfAsyncGenerator(),
      awaits: await awaits(),
      declaration: await declaration(),
    },
    // The frames that Error.captureStackTrace(err, fn) leaves when `fn` is that function.
    belowCaller: {
      arrow: await theCaller(arrow, arrow),
      arrowBeforeAwait: await theCaller(arrowBeforeAwait, arrowBeforeAwait),
      expression: await theCaller(expression, expression),
      property: await theCaller(object.property, object.property),
      classField: await theCaller(Class.field, Class.field),
      assigned: await theCaller(assigned, assigned),
      generator: callerOfGenerator(generator),
      generatorResumed: callerOfGeneratorResumed(generatorResumed),
      asyncGenerator: await callerOfAsyncGenerator(asyncGenerator),
      declaration: await theCaller(declaration, declaration),
    },
  };
  sink++;
  return results;
}

console.log(JSON.stringify(await main(), null, 2));
