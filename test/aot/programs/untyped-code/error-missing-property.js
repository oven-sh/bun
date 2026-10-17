// A property missing on an Error is looked up along its prototype chain, whatever was cached for other Errors; lazily materialized properties still appear.
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));
const readCode = error => error.code;
const readStatus = error => error.status;
const hasCode = error => "code" in error;
const readStack = error => typeof error.stack;
const hasStack = error => "stack" in error;
const readByKey = (error, key) => error[key];

class Failure extends Error {}
class Coded extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
const make = i =>
  i % 5 === 0 ? new TypeError("t") : i % 5 === 1 ? new Failure("f") : i % 5 === 2 ? new RangeError("r") : i % 5 === 3 ? new Error("e", { cause: i }) : new Coded("c", i);

{
  let absent = 0;
  let sum = 0;
  let within = 0;
  for (let i = 0; i < 3000; i++) {
    const error = make(i);
    const code = readCode(error);
    if (code === undefined) absent++;
    else sum += code;
    if (hasCode(error)) within++;
    if (readStatus(error) !== undefined) sum = -1;
  }
  say("absent", absent, sum, within);
}

{
  const error = new Error("one");
  say("before", readCode(error), hasCode(error), Object.hasOwn(error, "code"));
  say("made when asked for", readStack(error), hasStack(error), typeof readByKey(error, "stack"), Object.hasOwn(error, "stack"));
  say("behind that", readCode(error), hasCode(error), readStatus(error));
  error.code = "E_ONE";
  say("given", readCode(error), hasCode(error), Object.keys(error).join());
  delete error.code;
  say("taken away", readCode(error), hasCode(error));
}

{
  const errors = [new Error("a"), new TypeError("b"), new Failure("c")];
  for (let i = 0; i < 3000; i++) readCode(errors[i % 3]);
  Error.prototype.code = "inherited";
  say("the prototype is given it", errors.map(readCode).join(), errors.map(hasCode).join(), readCode(new RangeError("d")));
  Error.prototype.code = "replaced";
  say("and another", errors.map(readCode).join());
  delete Error.prototype.code;
  say("and loses it", errors.map(readCode).join(), errors.map(hasCode).join());
  Failure.prototype.status = 500;
  say("a nearer prototype is given another", errors.map(readStatus).join(), readStatus(new Coded("e", 1)));
  delete Failure.prototype.status;
  say("and loses it", errors.map(readStatus).join());
  Object.defineProperty(Failure.prototype, "code", {
    get() {
      return "got " + this.message;
    },
    configurable: true,
  });
  say("an accessor", errors.map(readCode).join());
  delete Failure.prototype.code;
}

{
  const error = new Error("bare");
  for (let i = 0; i < 100; i++) readCode(error);
  Object.setPrototypeOf(error, { code: "other" });
  say("another prototype", readCode(error), hasCode(error), error instanceof Error);
  Object.setPrototypeOf(error, null);
  say("none", readCode(error), hasCode(error), readStack(error));
}

{
  let caught = 0;
  for (let i = 0; i < 300; i++) {
    try {
      null.x;
    } catch (error) {
      if (readCode(error) === undefined && !hasCode(error) && readStack(error) === "string") caught++;
    }
  }
  say("thrown by the engine", caught);
  const plain = {};
  Error.captureStackTrace(plain);
  say("a captured stack", readStack(plain), hasStack(plain), readCode(plain));
  const frozen = Object.freeze(new Error("frozen"));
  say("frozen", readCode(frozen), hasCode(frozen), readStack(frozen));
  const names = ["line", "column", "sourceURL", "stack", "message", "cause", "name", "code"];
  const fresh = new Error("fresh");
  say("in", names.map(name => name + ":" + (name in fresh)).join());
  const other = new Error("other");
  say("own", names.map(name => name + ":" + Object.hasOwn(other, name)).join());
  const third = new Error("third");
  say("kinds", names.map(name => name + ":" + typeof readByKey(third, name)).join());
}

console.log(lines.join("\n"));
