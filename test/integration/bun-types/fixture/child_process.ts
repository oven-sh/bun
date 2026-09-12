import { execFile, spawn, spawnSync } from "node:child_process";

// windowsKeepAlive is a Bun-only option that node:child_process forwards to Bun.spawn.
{
  const child = spawn("cmd.exe", ["/c", "exit"], {
    stdio: ["ignore", 1, 2],
    windowsHide: true,
    windowsKeepAlive: true,
  });
  child.unref();

  execFile("cmd.exe", ["/c", "exit"], { windowsKeepAlive: true }, () => {});
  spawnSync("cmd.exe", ["/c", "exit"], { windowsKeepAlive: false });

  // @ts-expect-error windowsKeepAlive is a boolean
  spawn("cmd.exe", [], { windowsKeepAlive: "yes" });
}
