import { dns } from "bun";
import { describe, expect, it, test } from "bun:test";

describe("dns.lookup", () => {
  it("remote", async () => {
    const [first, second] = await dns.lookup("google.com");
    console.log(first, second);
  });
  it("local", async () => {
    const [first, second] = await dns.lookup("localhost");
    console.log(first, second);
  });
});
