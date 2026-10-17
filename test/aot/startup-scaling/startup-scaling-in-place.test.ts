import { describeStartupScaling } from "./startup-scaling";

describeStartupScaling("--compile-in-place", kind => ["functions", "ES modules"].includes(kind.name), {
  flags: ["--compile-in-place"],
  privateGrowthFactor: 4,
  scenariosThatGrow: ["require cache keys"],
});
