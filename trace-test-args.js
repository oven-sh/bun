const cp = require("child_process");
const fs = require("fs");

// Create a child script
fs.writeFileSync(
  "child-args.js",
  `
console.log('process.execArgv:', process.execArgv);
console.log('process.argv:', process.argv);
`,
);

console.log("Testing fork with execArgv...");
const proc = cp.fork("./child-args.js", ["arg1", "arg2"], {
  execArgv: ["--trace-event-categories", "node.environment", "--no-warnings"],
});

proc.on("exit", () => {
  fs.unlinkSync("child-args.js");
});
