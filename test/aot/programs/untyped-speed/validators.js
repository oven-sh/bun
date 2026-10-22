// A schema compiled into nested closures that check five sample objects: `typeof`, `in`, regular expressions made from strings, and messages put together from strings.
function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function compile(schema, path) {
  path = path || "$";
  var checks = [];
  if (schema.type) {
    checks.push(function (value, errors) {
      if (typeOf(value) !== schema.type) errors.push(path + ": expected " + schema.type);
    });
  }
  if (schema.minimum !== undefined) {
    checks.push(function (value, errors) {
      if (typeof value === "number" && value < schema.minimum) errors.push(path + ": below " + schema.minimum);
    });
  }
  if (schema.maxLength !== undefined) {
    checks.push(function (value, errors) {
      if (typeof value === "string" && value.length > schema.maxLength) errors.push(path + ": too long");
    });
  }
  if (schema.pattern) {
    var pattern = new RegExp(schema.pattern);
    checks.push(function (value, errors) {
      if (typeof value === "string" && !pattern.test(value)) errors.push(path + ": does not match");
    });
  }
  if (schema.enum) {
    checks.push(function (value, errors) {
      if (schema.enum.indexOf(value) < 0) errors.push(path + ": not allowed");
    });
  }
  if (schema.properties) {
    var required = schema.required || [];
    var names = Object.keys(schema.properties);
    var validators = names.map(function (name) {
      return compile(schema.properties[name], path + "." + name);
    });
    checks.push(function (value, errors) {
      if (typeOf(value) !== "object") return;
      for (var i = 0; i < required.length; i++) {
        if (!(required[i] in value)) errors.push(path + "." + required[i] + ": missing");
      }
      for (var j = 0; j < names.length; j++) {
        if (value[names[j]] !== undefined) validators[j](value[names[j]], errors);
      }
    });
  }
  if (schema.items) {
    var item = compile(schema.items, path + "[]");
    checks.push(function (value, errors) {
      if (!Array.isArray(value)) return;
      for (var i = 0; i < value.length; i++) item(value[i], errors);
    });
  }
  return function (value, errors) {
    for (var i = 0; i < checks.length; i++) checks[i](value, errors);
    return errors;
  };
}

var validate = compile({
  type: "object",
  required: ["id", "email"],
  properties: {
    id: { type: "number", minimum: 1 },
    email: { type: "string", pattern: "^[^@ ]+@[^@ ]+$", maxLength: 24 },
    role: { enum: ["admin", "user", "guest"] },
    tags: { type: "array", items: { type: "string", maxLength: 5 } },
    address: { type: "object", required: ["city"], properties: { city: { type: "string" }, zip: { type: "string", pattern: "^\\d{5}$" } } },
  },
});

function run(count) {
  var samples = [
    { id: 1, email: "ann@example.com", role: "admin", tags: ["a", "bb"], address: { city: "Paris", zip: "75001" } },
    { id: 0, email: "bob", role: "root", tags: ["toolong", 3] },
    { email: "cy@example.org", address: { zip: "12" } },
    { id: 7, email: "di@a-very-long-domain-name.example", tags: [] },
    { id: "8", email: 9, address: null },
  ];
  var total = 0;
  for (var i = 0; i < count; i++) {
    var errors = validate(samples[i % samples.length], []);
    total += errors.length;
    if (errors.length) total += errors[errors.length - 1].length;
  }
  return total;
}

console.log(run(300000));
