// "ArrowFunctionExpression"
class a1 extends (() => {}) {}

// "AssignmentExpression"
class a2 extends (b = c) {}

// "AwaitExpression"
async function f() {
  class a extends (await b) {}
}

// "BinaryExpression"
class a3 extends (b + c) {}

// "CallExpression"
class a4 extends b() {}

// "ClassExpression"
class a5 extends class {} {}

// "ConditionalExpression"
class a6 extends (b ? c : d) {}

// "FunctionExpression"
class a7 extends (function() {}) {}

// "LogicalExpression"
class a8 extends (b || c) {}

// "MemberExpression"
class a9 extends b.c {}

// "NewExpression"
class a10 extends (new B()) {}

// "ObjectExpression"
class a11 extends ({}) {}

// "SequenceExpression"
class a12 extends (b, c) {}

// "TaggedTemplateExpression"
class a13 extends `` {}

// "UnaryExpression"
class a14 extends (void b) {}

// "UpdateExpression"
class a15 extends (++b) {}

// "YieldExpression"
function* f2() {
  // Flow has a bug parsing it.
  // class a extends (yield 1) {}
}

x = class extends (++b) {}
