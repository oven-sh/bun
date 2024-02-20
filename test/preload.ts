import * as harness from "./harness";

Bun.$.env((process.env = { ...harness.bunEnv }));
