obj.foo ?? "default";

const x = (foo, bar = foo ?? bar) => {};

foo ? bar ?? foo : baz;

foo ?? (bar ?? baz);
(foo ?? bar) ?? baz;

// Mixing ?? and (&& or ||) requires parens
// It's a syntax error without it.
(foo ?? baz) || baz;
foo ?? (baz || baz);

(foo ?? baz) && baz;
foo ?? (baz && baz);

(foo || baz) ?? baz;
foo || (baz ?? baz);

(foo && baz) ?? baz;
foo && (baz ?? baz);

foo ?? bar ? a : b;
a ? foo ?? bar : b;
a ? b : foo ?? bar;
