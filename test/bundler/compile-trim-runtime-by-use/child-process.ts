const child = Bun.spawnSync(["/bin/echo", "from a child"]);
console.log(child.exitCode, child.stdout.toString());
