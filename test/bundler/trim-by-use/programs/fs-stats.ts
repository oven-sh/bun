import { statSync, readdirSync, statfsSync, Stats, Dirent } from "node:fs";
const stats = statSync("/");
console.log(
  stats.isDirectory(),
  stats instanceof Stats,
  typeof stats.mtimeMs,
  typeof statSync("/", { bigint: true }).size,
  readdirSync("/", { withFileTypes: true })[0] instanceof Dirent,
  typeof statfsSync("/").bsize,
  typeof statfsSync("/", { bigint: true }).bsize,
);
console.log((await Bun.file("/").stat()).isDirectory());
