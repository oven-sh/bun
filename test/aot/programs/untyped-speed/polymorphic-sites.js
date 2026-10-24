// Sites that see several kinds of values: an evaluator that switches on a `type` string, visitors found under that string, `length` of a string, an array, an object and a function, and objects with the same properties in another order.
function literal(value) {
  return { type: "literal", value: value };
}
function binary(operator, left, right) {
  return { type: "binary", operator: operator, left: left, right: right };
}
function negate(operand) {
  return { type: "negate", operand: operand };
}
function variable(name) {
  return { type: "variable", name: name };
}

function evaluate(node, scope) {
  switch (node.type) {
    case "literal":
      return node.value;
    case "variable":
      return scope[node.name];
    case "negate":
      return -evaluate(node.operand, scope);
    case "binary":
      var left = evaluate(node.left, scope);
      var right = evaluate(node.right, scope);
      if (node.operator === "+") return left + right;
      if (node.operator === "*") return left * right;
      return left - right;
  }
  throw new Error("unknown node " + node.type);
}

function size(thing) {
  return thing.length;
}

function label(thing) {
  return thing.name + ":" + thing.id;
}

var visitors = {
  literal: function () {
    return 1;
  },
  variable: function () {
    return 2;
  },
  negate: function (node) {
    return 1 + count(node.operand);
  },
  binary: function (node) {
    return 1 + count(node.left) + count(node.right);
  },
};
function count(node) {
  return visitors[node.type](node);
}

function run(rounds) {
  var tree = binary("+", binary("*", variable("x"), literal(3)), negate(binary("-", variable("y"), literal(1))));
  var sized = ["text", [1, 2, 3], { length: 7 }, function (a, b) {}];
  var named = [{ name: "a", id: 1 }, { id: 2, name: "b" }, { name: "c", id: 3, extra: true }, { kind: 0, name: "d", id: 4 }];
  var total = 0;
  for (var i = 0; i < rounds; i++) {
    total += evaluate(tree, { x: i & 7, y: i & 3 }) + count(tree);
    total += size(sized[i & 3]) + label(named[i & 3]).length;
  }
  return total;
}

console.log(run(1200000));
