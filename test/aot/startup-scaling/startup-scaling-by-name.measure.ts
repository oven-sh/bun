import { describeStartupScaling } from "./startup-scaling";

describeStartupScaling("--compile, modules loaded by name", kind => kind.name === "ES modules in their own folders", { loadsByName: true });
