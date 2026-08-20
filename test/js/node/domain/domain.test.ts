import { describe, expect, test } from "bun:test";
import { Domain, create, createDomain } from "node:domain";

describe("node:domain", () => {
  test("Domain is constructible", () => {
    const d = new Domain();
    expect(typeof d.run).toBe("function");
    expect(typeof d.add).toBe("function");
    expect(typeof d.bind).toBe("function");
    expect(typeof d.intercept).toBe("function");
    expect(typeof d.enter).toBe("function");
    expect(typeof d.exit).toBe("function");
  });

  test("create and createDomain aliases", () => {
    expect(typeof create).toBe("function");
    expect(typeof createDomain).toBe("function");
    const a = create();
    const b = createDomain();
    expect(typeof a.run).toBe("function");
    expect(typeof b.run).toBe("function");
  });

  test("domain.run invokes fn and exits", () => {
    const d = new Domain();
    let ran = false;
    d.run(() => {
      ran = true;
      expect(process.domain).toBe(d);
    });
    expect(ran).toBe(true);
  });
});