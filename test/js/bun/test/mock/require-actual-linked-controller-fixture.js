import { mock } from "bun:test";

mock.module("./require-actual-linked-target-fixture.js", () => ({ value: "mocked" }));

export const registered = true;
