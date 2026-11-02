// Bun.semver
console.log(
  Bun.semver.satisfies("1.2.3", "^1.2.0"),
  Bun.semver.satisfies("2.0.0", "^1.2.0"),
  Bun.semver.order("1.0.0", "1.0.1"),
  ["1.10.0", "1.2.0", "1.2.0-beta.1"].sort(Bun.semver.order).join(" "),
);
