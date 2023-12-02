console.write ??= process.stdout.write.bind(process.stdout);
var bufs = [];
function template(...args) {
  bufs.push(Buffer.from(args.join("")));
}

template`🐰123`;
template`123🐰`;
template`🐰`;
template`🐰🐰`;
template`🐰🐰123`;
template`🐰123🐰123`;
template`123🐰`;
template`123🐰123`;
template`🐰${(globalThis.boop ||= true)}🐰`;
const outBuf = Buffer.concat(bufs);
const out = outBuf.toString("base64");
console.write(out);
if (!outBuf.equals(Buffer.from(out, "base64"))) {
  throw new Error("Buffer mismatch");
}
process.exit(0);
