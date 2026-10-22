// Errors of an ES5 constructor and of classes that extend Error in two levels, thrown through `finally` and told apart with `instanceof`, beside a TypeError that the engine throws.
function HttpError(status, message) {
  var error = Error.call(this, message);
  this.name = "HttpError";
  this.message = error.message;
  this.status = status;
}
HttpError.prototype = Object.create(Error.prototype);
HttpError.prototype.constructor = HttpError;

class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

class RangeValidationError extends ValidationError {
  constructor(field, low, high) {
    super(field, field + " must be in " + low + ".." + high);
    this.low = low;
    this.high = high;
  }
}

var opened = 0;
var closed = 0;

function withResource(work) {
  opened++;
  try {
    return work();
  } finally {
    closed++;
  }
}

function check(request) {
  if (request.age < 0 || request.age > 120) throw new RangeValidationError("age", 0, 120);
  if (!request.name) throw new ValidationError("name", "name is required");
  if (request.id === 13) throw new HttpError(404, "no such id");
  if (request.id === 14) return null.missing;
  return request.id + request.age;
}

function handle(request) {
  try {
    return withResource(function () {
      return check(request);
    });
  } catch (error) {
    if (error instanceof RangeValidationError) return error.high - error.low;
    if (error instanceof ValidationError) return error.field.length;
    if (error instanceof HttpError) return error.status;
    if (error instanceof TypeError) return 1;
    throw error;
  }
}

function run(count) {
  var total = 0;
  for (var i = 0; i < count; i++) {
    total += handle({ id: i % 16, age: (i % 140) - 5, name: i % 9 ? "n" : "" });
  }
  return total + opened - closed;
}

console.log(run(400000));
