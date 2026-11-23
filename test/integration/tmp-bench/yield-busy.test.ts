import { bench } from "./run";
bench(
  "three.js",
  "busyall.js",
  "",
  "^Bun.write,^writer,^file,^Response,^fsp,^handle,^[23]00 ,^create,^pipeline",
  "4",
  "20",
);
