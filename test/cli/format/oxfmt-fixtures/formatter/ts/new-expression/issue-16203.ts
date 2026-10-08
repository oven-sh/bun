const i1 = new (X() as I).y;
const i2 = new (X() as I);
const i3 = new (X()).y;
const i4 = new (X());

new (a.b)();
new (a?.b)();

// js/new-expression/new_expression.js
new (x()``.y)();

// typescript/non-null/parens.ts
const c3 = new (d()!.e)();
new (x()``!.y)();
new (x()!``.y)();
new (x!()``.y)();
