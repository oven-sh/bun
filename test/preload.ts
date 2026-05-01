import * as harness from "./harness";

// We make Bun.env read-only
// so process.env = {} causes them to be out of sync and we assume Bun.env is
for (let key in process.env) {
  if (key === "TZ") continue;
  if (key in harness.bunEnv) continue;
  delete process.env[key];
}

for (let key in harness.bunEnv) {
  if (key === "TZ") continue;
  if (harness.bunEnv[key] === undefined) continue;
  process.env[key] = harness.bunEnv[key] + "";
}

if (Bun.$?.env) Bun.$.env(process.env);
