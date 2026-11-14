// Runs one stdio scenario (argv[2]) while a seccomp filter installed by the
// test's helper before exec denies sendto or recvfrom. The filter covers every
// thread of this process, including the pool thread that reads Bun.stdin.
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

switch (process.argv[2]) {
  case "stdout":
    fs.writeSync(1, "S");
    process.stdout.write("A", err => fs.writeSync(2, err ? "callback:" + err.code : "callback:ok"));
    break;
  case "stdin": {
    let got = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => (got += chunk));
    process.stdin.on("error", err => fs.writeSync(2, "error:" + err.code));
    process.stdin.on("end", () => fs.writeSync(1, "got:" + got));
    break;
  }
  case "bun-stdin":
    Bun.stdin.text().then(
      text => fs.writeSync(1, "got:" + text),
      err => fs.writeSync(2, "error:" + err.code),
    );
    break;
  case "spawn-sync": {
    // The child inherits the filter. It writes with write(2), which the filter allows.
    const result = spawnSync(process.execPath, ["-e", "require('node:fs').writeSync(1, 'from child')"], {
      encoding: "utf8",
    });
    fs.writeSync(
      1,
      JSON.stringify({ status: result.status, stdout: result.stdout, error: result.error?.code ?? null }),
    );
    break;
  }
  case "spawn-stdin": {
    // The parent side of a child's stdin socketpair: a nonblocking writer.
    const child = Bun.spawn({
      cmd: [process.execPath, "-e", "require('node:fs').writeSync(1, require('node:fs').readFileSync(0, 'utf8'))"],
      stdin: "pipe",
      stdout: "pipe",
    });
    child.stdin.write("hello");
    child.stdin.end();
    child.stdout.text().then(text => fs.writeSync(1, "got:" + text));
    break;
  }
  default:
    process.exit(2);
}
