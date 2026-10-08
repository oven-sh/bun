const foo1 = /** @type {!Foo} */(bar);
const foo2 = /** @type {!Foo} **/(bar);
const foo3 = /** @type {!Foo} * */(bar);
const foo4 = /** @type {!Foo} ***/(bar);
const foo5 = /** @type {!Foo} * * */(bar);
const foo6 = /** @type {!Foo} *****/(bar);
const foo7 = /** @type {!Foo} *   *   *   *   */(bar);
const foo8 = /** @type {!Foo}    ** *   *   */(bar);
