// Usage: bun writable.js <old> <new>   After some output, does a program of Git for Windows find its stdout writable?
const perl = "C:\\Program Files\\Git\\usr\\bin\\perl.exe";
if (process.argv[2] !== "--run") for (const [i, exe] of process.argv.slice(2, 4).entries()) console.log(`cond writable ${i ? "new" : "old"}: ${Bun.spawnSync([exe, __filename, "--run"], { timeout: 100000, stderr: "inherit" }).stdout}`);
else if (!require("fs").existsSync(perl)) console.log("no perl");
else (async () => {
  const seen = [Bun.spawnSync([perl.replace("perl", "uname"), "-r"]).stdout.toString().trim()];
  for (const size of [100, 10000, 65536, 200000, 1 << 20]) {
    const p = Bun.spawn([perl, "-e", `syswrite(STDOUT, "x" x ${size}); select(undef, undef, undef, 0.3); my $w = ""; vec($w, 1, 1) = 1; print STDERR scalar(select(undef, $w, undef, 3));`], { stderr: "pipe" });
    let n = 0;
    for await (const c of p.stdout) n += c.length;
    seen.push(`${n} bytes, ready ${await p.stderr.text()}`);
  }
  console.log(seen.join("; "));
})();
