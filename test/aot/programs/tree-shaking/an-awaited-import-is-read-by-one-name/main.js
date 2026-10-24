// `(await import(x)).name` and `const { name } = await import(x)` say which exports they read. Here the export that is read reaches others through `this`, through a constant of its file, through a getter-like default, and the file exports a function named then.
console.log((await import("./uses-this.js")).start());
console.log((await import("./uses-constants.js")).read());
const { picked, renamed: other } = await import("./patterns.js");
console.log(picked(), other);
console.log((await import("./default.js")).default.name);
console.log(await import("./thenable.js"));
console.log((await import("./optional.js"))?.maybe?.());
console.log((await import("./twice.js")).first, (await import("./twice.js")).second);
