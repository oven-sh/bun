import { beforeAll } from "bun:test";

const FOO = process.env.FOO ?? "";

beforeAll(() => {
  if (!FOO) throw new Error("Environment variable FOO is not set");
});
