// `__proto__: v` twice in one object literal is an ECMAScript early error, so it stops the build in a JavaScript file too.
console.log({ __proto__: null, "__proto__": null });
