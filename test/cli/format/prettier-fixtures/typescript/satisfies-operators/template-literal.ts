const a = `${(foo + bar) satisfies baz}`;
const b = `${(veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLongFoo + bar) satisfies baz}`;
const b = `${(foo + veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLongBar) satisfies baz}`;
const b = `${(foo + bar) satisfies veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLongBaz}`;
const b = `${(veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLongFoo + veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLongBar) satisfies veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLongBaz}`;
