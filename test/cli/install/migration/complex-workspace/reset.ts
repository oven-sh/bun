import fs from "fs";

fs.rmSync("bun.lockb", { recursive: true, force: true });
fs.rmSync("bun.lock", { recursive: true, force: true });
fs.rmSync("node_modules", { recursive: true, force: true });
fs.rmSync("packages/body-parser/node_modules", { recursive: true, force: true });
fs.rmSync("packages/lol-package/node_modules", { recursive: true, force: true });
fs.rmSync("packages/second/node_modules", { recursive: true, force: true });
fs.rmSync("packages/with-postinstall/node_modules", { recursive: true, force: true });
fs.rmSync("packages/with-postinstall/postinstall.txt", { recursive: true, force: true });
