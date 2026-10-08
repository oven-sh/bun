// "ArrowFunctionExpression"
(() => {})``;

// "AssignmentExpression"
(b = c)``;

// "AwaitExpression"
async function f() {
  (await b)``;
}

// "BinaryExpression"
(b + c)``;

// "CallExpression"
b()``;

// "ClassExpression"
(class {})``;

// "ConditionalExpression"
(b ? c : d)``;

// "FunctionExpression"
(function() {})``;

// "LogicalExpression"
(b || c)``;

// "MemberExpression"
b.c``;

// "NewExpression"
(new B())``;

// "ObjectExpression"
({})``;

// "SequenceExpression"
(b, c)``;

// "TaggedTemplateExpression"
(``)``;

// "UnaryExpression"
(void b)``;

// "UpdateExpression"
(++b)``;

// "YieldExpression"
function* d() {
  (yield 1)``;
}
