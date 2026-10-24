class Bare extends Error {}
const made = new Bare();
console.log("zq own message " + Object.hasOwn(made, "message") + " [" + made.message + "]");
console.log("zq undefined given " + Object.hasOwn(new Bare(undefined), "message") + " empty given " + Object.hasOwn(new Bare(""), "message"));
