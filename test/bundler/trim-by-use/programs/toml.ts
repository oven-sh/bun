const value = Bun.TOML.parse(`
title = "trim"
[server]
ports = [8000, 8001]
started = true
[[route]]
path = "/a"
[[route]]
path = "/b"
`);
console.log(JSON.stringify(value));
