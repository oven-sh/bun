a = Boolean(
  a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition,
);
a = Boolean(
  a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition,
)?.toString();
a = new Boolean(
  a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition,
);
a = !(
  a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition
);
a = !!(
  a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition
);

a = Boolean(
  a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition,
  anotherArgument,
);
a = Boolean(
  a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition,
  anotherArgument,
);
a = new Foo(
  a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition,
  anotherArgument,
);

// Different operators
a = Boolean(
  a_long_long_long_long_condition && a_long_long_long_long_condition && a_long_long_long_long_condition,
);
a = Boolean(
  a_long_long_long_long_condition ?? a_long_long_long_long_condition ?? a_long_long_long_long_condition,
);
a = Boolean(
  a_long_long_long_long_condition + a_long_long_long_long_condition + a_long_long_long_long_condition,
);

// Not argument
a = (
  a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition
)(Boolean);
a = new (
  a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition
)(Foo);

// Not `Boolean`
a = not_Boolean(
  a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition,
);

// Nested
a = Boolean(
  (a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition)
  &&
  (a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition)
);
a = Boolean(
  (a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition)
  ||
  (a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition)
);
a = Boolean(Boolean(
  a_long_long_long_long_condition || a_long_long_long_long_condition || a_long_long_long_long_condition,
));
