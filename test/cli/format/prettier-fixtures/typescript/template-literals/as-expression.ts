const a = `${(foo + bar) as baz}`;
const b = `${(veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLongFoo + bar) as baz}`;
const b = `${(foo + veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLongBar) as baz}`;
const b = `${(foo + bar) as veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLongBaz}`;
const b = `${(veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLongFoo + veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLongBar) as veryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLongBaz}`;
