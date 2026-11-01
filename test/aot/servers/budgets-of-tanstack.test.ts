import { unsupported } from "../harness/compiler";
import { test } from "../listed";
import { testServers } from "./one-server";

if (unsupported) test.skip(unsupported, () => {});
else await testServers("budgets", "tanstack");
