import fallback, { bump, labelLength, readShared, shared, Subject } from "./subject.ts";
import * as everything from "./subject.ts";
import { run, runOn } from "./runner.ts";

console.log(run("honest", () => shared.readCount()));
console.log(run("an exported constant", readShared));
console.log(run("an exported constant, called here", () => readShared()));
console.log(run("exported by destructuring: labelLength", labelLength));
console.log(run("exported by destructuring: bump", bump));
console.log(run("the default export", fallback));
console.log(run("as a member of the namespace object", () => everything.readShared()));
console.log(run("as a member of the namespace object: bump", () => everything.bump()));
console.log(runOn("on a look-alike", readShared, { count: 70 }));
console.log(runOn("on the shared one", readShared, shared));
console.log(runOn("on a new one", Subject.prototype.readCount, new Subject()));
console.log(run("the shared one is untouched", () => shared.count));
