// Run under `ulimit -f 1` (a 512 byte RLIMIT_FSIZE) so the write loop fails
// partway through with EFBIG. Handling SIGXFSZ keeps the default terminate
// action from killing us before write() can return the error.
const fs = require("fs");
process.on("SIGXFSZ", () => {});

const [path, flag] = process.argv.slice(2);
let code = "none";
try {
  fs.writeFileSync(path, Buffer.alloc(1000, "A"), flag === "default" ? undefined : { flag });
} catch (e) {
  code = e.code;
}

const contents = fs.readFileSync(path);
console.log(
  JSON.stringify({
    code,
    size: contents.length,
    written: contents.filter(b => b === 0x41).length,
    stale: contents.filter(b => b === 0x42).length,
  }),
);
