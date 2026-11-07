import { runWhenProcessExits } from "bun:internal-for-testing";

runWhenProcessExits(() => {
  console.log("the hook runs");
  throw new Error("made up");
});
process.on("exit", code => console.log("a listener of exit: " + code));
if (process.argv[2] === "handled") {
  process.on("uncaughtException", error => {
    console.log("reported: " + error.message);
    process.exit(3);
  });
}
if (process.argv[3] === "asked") process.exit(0);
