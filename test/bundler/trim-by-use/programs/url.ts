const url = new URL("https://user:pw@example.com:8080/a/b?x=1&y=2#frag");
url.searchParams.append("z", "3");
url.searchParams.sort();
url.hostname = "bun.sh";
url.pathname = "/c d";
console.log(
  url.href,
  url.origin,
  url.host,
  url.port,
  url.username,
  [...url.searchParams].join("|"),
  URL.canParse("nope"),
  String(new URLSearchParams({ q: "a b" })),
  JSON.stringify(url),
);
console.log(
  Bun.pathToFileURL("/tmp/a b.txt").href,
  Bun.fileURLToPath(new URL("file:///tmp/x.txt")),
  url,
  url.searchParams,
);
