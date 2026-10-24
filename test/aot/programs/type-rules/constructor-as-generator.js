// An instance method named `constructor` that is a generator is an ECMAScript early error, so it stops the build in a JavaScript file too.
class A { *constructor() {} }
console.log(typeof A);
