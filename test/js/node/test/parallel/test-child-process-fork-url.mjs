import { fork } from "child_process";
import { mustCall } from "../common/index.mjs";

if (process.argv[2] === "child") {
  process.disconnect();
} else {
  const child = fork(new URL(import.meta.url), ["child"]);

  child.on("disconnect", mustCall());
  child.once("exit", mustCall());
}
