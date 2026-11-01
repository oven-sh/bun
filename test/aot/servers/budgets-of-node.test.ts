import { unsupported } from "../harness/compiler";
import { test } from "../harness/declare";
import { testServers } from "./one-server";

if (unsupported) test.skip(unsupported, () => {});
else await testServers("budgets", "node");
