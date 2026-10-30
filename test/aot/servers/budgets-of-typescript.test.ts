import { test } from "bun:test";
import { unsupported } from "../harness/compiler";
import { testServers } from "./one-server";

if (unsupported) test.skip(unsupported, () => {});
else await testServers("budgets", "typescript");
