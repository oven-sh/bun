import { test } from "bun:test";

test("one minute passes", () => Bun.sleep(60_000), 80_000);
