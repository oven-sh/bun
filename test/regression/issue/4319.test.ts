import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/4319
test("lockfile does not contain garbage memory", () => {
  const pkgjson = {
    "name": "teamsykmelding-slack-reminders",
    "type": "module",
    "dependencies": {
      "bun-types": "0.8.1",
    },
    "scripts": {
      "postinstall": "bun run apoksdpoaskd",
    },
  };
  throw new Error("TODO: write full test");
});
