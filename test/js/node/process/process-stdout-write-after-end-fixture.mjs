const code = e => (e == null ? null : String(e.code || e.name || e));
const so = process.stdout;
const ev = [];
so.on("error", e => ev.push("err:" + code(e)));

so.write("A");
so.end("B");

await new Promise(r => setTimeout(r, 50));

let cbErr = "no-callback";
const ret = so.write("C", e => {
  cbErr = code(e);
});

await new Promise(r => setTimeout(r, 50));

process.stderr.write(
  JSON.stringify({
    writableEnded: so.writableEnded,
    writable: so.writable,
    ret,
    cbErr,
    ev,
  }) + "\n",
);
