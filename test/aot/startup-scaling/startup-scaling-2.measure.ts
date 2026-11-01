import { test } from "bun:test";
import { unsupported } from "../harness/compiler";
import { describePart } from "./startup-scaling";

if (unsupported) test.skip(unsupported, () => {});
else await describePart(2, 4);
