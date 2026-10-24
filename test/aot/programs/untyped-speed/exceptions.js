// Exceptions in a hot loop: an ES5 error type thrown once in 128 turns and caught at the call, behind a `finally` and above five levels of recursion, beside a TypeError that the engine throws.
function ValidationError(field, message) {
  this.name = "ValidationError";
  this.field = field;
  this.message = message;
}
ValidationError.prototype = Object.create(Error.prototype);
ValidationError.prototype.constructor = ValidationError;

function requireNumber(record, field) {
  var value = record[field];
  if (typeof value !== "number") throw new ValidationError(field, field + " must be a number");
  return value;
}

function validate(record) {
  return requireNumber(record, "id") + requireNumber(record, "size");
}

function safely(fn, argument, fallback) {
  try {
    return fn(argument);
  } catch (error) {
    if (error instanceof ValidationError) return fallback + error.field.length;
    throw error;
  }
}

function withCleanup(record, log) {
  log.opened++;
  try {
    if (record.size === 3) return -1;
    return validate(record);
  } finally {
    log.closed++;
  }
}

function deep(level, record) {
  if (level === 0) return validate(record);
  return deep(level - 1, record) + 1;
}

function run(count) {
  var records = [{ id: 1, size: 2 }, { id: 2, size: 3 }, { id: 3, size: 4 }, { id: 4, size: 5 }];
  var broken = { id: 5, size: "large" };
  var log = { opened: 0, closed: 0 };
  var total = 0;
  for (var i = 0; i < count; i++) {
    var record = (i & 127) === 0 ? broken : records[i & 3];
    total += safely(validate, record, 100);
    try {
      total += withCleanup(record, log);
    } catch (error) {
      total += error.message.length;
    }
    try {
      total += deep(4, record);
    } catch (error) {
      total += error.name.length;
    }
    if ((i & 1023) === 0) {
      try {
        null.missing;
      } catch (error) {
        total += error instanceof TypeError ? 7 : 0;
      }
    }
  }
  return total + log.opened - log.closed;
}

console.log(run(2500000));
