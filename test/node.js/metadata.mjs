import { spawnSync } from "node:child_process";

const isBun = !!process.isBun;
const os = process.platform === "win32" ? "windows" : process.platform;
const arch = process.arch === "arm64" ? "aarch64" : process.arch;
const version = isBun ? Bun.version : process.versions.node;
const revision = isBun ? Bun.revision : undefined;
const baseline = (() => {
  if (!isBun || arch !== "x64") {
    return undefined;
  }
  const { stdout } = spawnSync(process.execPath, ["--print", "Bun.unsafe.segfault()"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (stdout.includes("baseline")) {
    return true;
  }
  return undefined;
})();
const name = baseline ? `bun-${os}-${arch}-baseline` : `${isBun ? "bun" : "node"}-${os}-${arch}`;

console.log(
  JSON.stringify({
    name,
    os,
    arch,
    version,
    revision,
    baseline,
  }),
);
