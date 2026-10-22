// `yield` in a parameter initializer of a generator is an ECMAScript early error, so it stops the build in a JavaScript file too.
function* g(a = yield) {}
console.log(typeof g);
