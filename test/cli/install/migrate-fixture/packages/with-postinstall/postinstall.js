import { writeFileSync } from "fs";

writeFileSync(import.meta.dir + "/postinstall.txt", `i ran!`);

// TODO: postinstall doesnt run sharp's scripts yet :(
// import "sharp";
