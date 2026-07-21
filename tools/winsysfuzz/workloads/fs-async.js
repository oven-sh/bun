// scenario: async fs + streams — the libuv fs threadpool / IOCP completion path
const fsp = require("fs/promises");
const fs = require("fs");
const { pipeline } = require("stream/promises");

await fsp.writeFile("src.bin", Buffer.alloc(512 * 1024, 3));
await fsp.copyFile("src.bin", "dup.bin");
const st = await fsp.stat("dup.bin");
await pipeline(fs.createReadStream("src.bin"), fs.createWriteStream("piped.bin"));
const rd = await fsp.readdir(".");
await Promise.all([fsp.rm("src.bin"), fsp.rm("dup.bin"), fsp.rm("piped.bin")]);
const w = Bun.file("bunfile.txt");
await Bun.write(w, "via Bun.write");
const back = await w.text();
await fsp.rm("bunfile.txt");
console.log(`fs-async ok size=${st.size} dir=${rd.length} bun=${back.length}`);
