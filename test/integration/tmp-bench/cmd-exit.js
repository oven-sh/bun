// Why does a pipeline of cmd.exe end with code 5?   bun cmd-exit.ts    and    bun-49254 cmd-exit.ts
const exe = process.execPath, sys = process.env.SystemRoot + "\\System32\\";
const lines = {
  "no pipe, exe": `${sys}hostname.exe`,
  "no pipe, bun": `"${exe}" -e 0`,
  "builtin | exe": `echo a| ${sys}findstr.exe a`,
  "exe | exe": `${sys}hostname.exe | ${sys}findstr.exe .`,
  "exe | bun": `${sys}hostname.exe | "${exe}" -e 0`,
  "bun | exe": `"${exe}" -p 1 | ${sys}findstr.exe .`,
  "bun | bun": `"${exe}" -p 1 | "${exe}" -e 0`,
  "bun | bun, exit 7": `"${exe}" -p 1 | "${exe}" -e process.exit(7)`,
  "as cmd sees it": `"${exe}" -p 1 | "${exe}" -e 0 && exit 100 || exit 101`,
};
const ways = {
  "ignore,pipe,pipe": { stdio: ["ignore", "pipe", "pipe"] },
  "pipe,pipe,pipe": { stdio: ["pipe", "pipe", "pipe"] },
  "inherit,pipe,pipe": { stdio: ["inherit", "pipe", "pipe"] },
  "ignore,ignore,ignore": { stdio: ["ignore", "ignore", "ignore"] },
  "hidden": { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  "detached": { stdio: ["ignore", "pipe", "pipe"], detached: true },
};
console.log(`# ${Bun.version} ${Bun.revision.slice(0, 9)} ${require("os").release()}`);
console.log("".padEnd(20), Object.keys(ways).join(" | "));
for (const [name, line] of Object.entries(lines)) {
  const codes = [];
  for (const way of Object.values(ways)) codes.push(await Bun.spawn(["cmd.exe", "/d", "/s", "/c", `"${line}"`], { windowsVerbatimArguments: true, timeout: 10000, ...way }).exited);
  console.log(name.padEnd(20), codes.join(" "));
}
const full = await new Promise(r => require("child_process").exec(lines["exe | exe"], e => r(e ? e.code : 0)));
console.log("child_process.exec  ", full);
