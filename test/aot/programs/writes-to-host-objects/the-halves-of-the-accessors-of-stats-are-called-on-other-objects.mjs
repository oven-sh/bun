// The getters and setters of the dates of fs.Stats are taken out of their descriptors and called on an heir of a stats object and on objects of the program: each defines the property there.
import fs from "node:fs";
const stats = fs.statSync(".");
const heir = Object.create(stats);
console.log(typeof Reflect.get(heir, "atime"), Object.hasOwn(heir, "atime"), Object.hasOwn(stats, "atime"));
console.log(typeof Reflect.get(stats, "ctime", heir), Object.hasOwn(heir, "ctime"), Object.hasOwn(stats, "ctime"));

const birthtime = Object.getOwnPropertyDescriptor(fs.Stats.prototype, "birthtime");
const other = { birthtimeMs: 5 };
console.log(typeof birthtime.get.call(other), Object.keys(other).join(), other.birthtime.getTime());
console.log(typeof Reflect.apply(birthtime.get, heir, []), Object.keys(heir).join());

const mtime = Object.getOwnPropertyDescriptor(fs.Stats.prototype, "mtime");
const stored = { mtimeMs: 5 };
mtime.set.call(stored, 7);
console.log(stored.mtime, Object.keys(stored).join(), mtime.get.name, mtime.set.name);

const inBigIntegers = Object.getPrototypeOf(fs.statSync(".", { bigint: true }));
const atime = Object.getOwnPropertyDescriptor(inBigIntegers, "atime");
const third = { a: 1 };
atime.set.call(third, "text");
console.log(third.atime, Object.keys(third).join());
