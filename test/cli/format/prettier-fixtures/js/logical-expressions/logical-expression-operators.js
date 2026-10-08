// Same operators do not require parens
(foo && bar) && baz;
foo && (bar && baz);
foo && ((bar && baz) && qux);
foo && (bar && (baz && qux));
foo && (bar && ((baz && qux) && xyz));
foo && (bar && (baz && (qux && xyz)));

(foo || bar) || baz;
foo || (bar || baz);
foo || ((bar || baz) || qux);
foo || (bar || (baz || qux));
foo || (bar || ((baz || qux) || xyz));
foo || (bar || (baz || (qux || xyz)));

(foo ?? bar) ?? baz;
foo ?? (bar ?? baz);
foo ?? ((bar ?? baz) ?? qux);
foo ?? (bar ?? (baz ?? qux));
foo ?? (bar ?? ((baz ?? qux) ?? xyz));
foo ?? (bar ?? (baz ?? (qux ?? xyz)));

// Explicitly parenthesized && and || requires parens
(foo && bar) || baz;
(foo || bar) && baz;

foo && (bar || baz);
foo || (bar && baz);

// Implicitly parenthesized && and || requires parens
foo && bar || baz;
foo || bar && baz;
