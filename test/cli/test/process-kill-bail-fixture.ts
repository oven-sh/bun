import { beforeAll, test } from "bun:test";
import { idle } from "./process-kill-helpers";

beforeAll(() => {
  console.log(`beforeAll pid ${idle().pid}`);
});

test("test timeout before --bail exits", async () => {
  await new Promise(() => {});
}, 10);

test("never runs", () => {});
