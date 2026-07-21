// scenario: synchronous fs — the bun_sys / NtCreateFile+NtReadFile+NtWriteFile core
const fs = require("fs");
fs.writeFileSync("big.bin", Buffer.alloc(1 << 20, 7)); // 1 MiB -> multi-chunk write
const big = fs.readFileSync("big.bin");
fs.writeFileSync("a.txt", "hello ".repeat(100));
fs.appendFileSync("a.txt", "tail");
const s = fs.statSync("a.txt");
fs.copyFileSync("a.txt", "b.txt");
fs.renameSync("b.txt", "c.txt");
fs.mkdirSync("d/e", { recursive: true });
fs.writeFileSync("d/e/x.txt", "x");
const entries = fs.readdirSync("d", { recursive: true });
fs.rmSync("d", { recursive: true });
fs.unlinkSync("c.txt");
const realp = fs.realpathSync(".");
console.log(`fs-sync ok big=${big.length} size=${s.size} entries=${entries.length} real=${realp.length > 0}`);
