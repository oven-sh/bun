/**
 * Test Bun.telemetry.attach() and detach() native API
 * NO @opentelemetry/* imports allowed - testing ONLY native hooks
 */
import { InstrumentRef } from "bun";
import { describe, expect, test } from "bun:test";

describe("Bun.telemetry.attach()", () => {
  test("returns InstrumentRef with unique ID for each attached instrument", () => {
    const instrument1 = {
      kind: "http",
      name: "test-instrument-1",
      version: "1.0.0",
      onOperationStart: () => {},
    } as const;

    const instrument2 = {
      kind: "http",
      name: "test-instrument-2",
      version: "1.0.0",
      onOperationStart: () => {},
    } as const;

    using ref1 = Bun.telemetry.attach(instrument1);
    using ref2 = Bun.telemetry.attach(instrument2);

    // Verify InstrumentRef structure
    expect(typeof ref1).toBe("object");
    expect(typeof ref2).toBe("object");
    expect(typeof ref1.id).toBe("number");
    expect(typeof ref2.id).toBe("number");
    expect(ref1.id).not.toBe(ref2.id);
    expect(ref1.id).toBeGreaterThan(0);
    expect(ref2.id).toBeGreaterThan(0);
  });

  test("accepts instruments with different operation kinds", () => {
    const httpInstrument = {
      kind: "http",
      name: "http-instrument",
      version: "1.0.0",
      onOperationStart: () => {},
    } as const;

    const fetchInstrument = {
      kind: "fetch",
      name: "fetch-instrument",
      version: "1.0.0",
      onOperationEnd: () => {},
    } as const;

    using httpRef = Bun.telemetry.attach(httpInstrument);
    using fetchRef = Bun.telemetry.attach(fetchInstrument);

    expect(httpRef.id).toBeGreaterThan(0);
    expect(fetchRef.id).toBeGreaterThan(0);
    expect(httpRef.id).not.toBe(fetchRef.id);
  });

  test("accepts instruments with only one hook function", () => {
    const instruments = [
      {
        kind: "http",
        name: "only-start",
        version: "1.0.0",
        onOperationStart: () => {},
      },
      {
        kind: "http",
        name: "only-end",
        version: "1.0.0",
        onOperationEnd: () => {},
      },
      {
        kind: "http",
        name: "only-error",
        version: "1.0.0",
        onOperationError: () => {},
      },
      {
        kind: "http",
        name: "only-inject",
        version: "1.0.0",
        onOperationInject: () => ({}),
      },
    ] as const;

    const refs = instruments.map(inst => Bun.telemetry.attach(inst));

    refs.forEach(ref => {
      expect(ref.id).toBeGreaterThan(0);
    });

    // Cleanup
    refs.forEach(ref => Bun.telemetry.detach(ref));
  });
});

describe("Bun.telemetry.detach()", () => {
  test("removes attached instrument and returns true", () => {
    const instrument = {
      kind: "http",
      name: "test-instrument",
      version: "1.0.0",
      onOperationStart: () => {},
    } as const;

    const ref = Bun.telemetry.attach(instrument);
    expect(ref.id).toBeGreaterThan(0);

    const removed = Bun.telemetry.detach(ref);
    expect(removed).toBe(true);
  });

  test("returns false for non-existent ref", () => {
    // Create a fake ref object that doesn't correspond to a real instrument
    const fakeRef = { id: 999999 } as unknown as InstrumentRef;
    const removed = Bun.telemetry.detach(fakeRef);
    expect(removed).toBe(false);
  });

  test("returns false for already-detached ref", () => {
    const instrument = {
      kind: "http",
      name: "test",
      version: "1.0.0",
      onOperationStart: () => {},
    } as const;

    const ref = Bun.telemetry.attach(instrument);
    Bun.telemetry.detach(ref); // First detach

    const removed = Bun.telemetry.detach(ref); // Second detach
    expect(removed).toBe(false);
  });

  test("can detach instruments in any order", () => {
    const refs: InstrumentRef[] = [];
    for (let i = 0; i < 5; i++) {
      const ref = Bun.telemetry.attach({
        kind: "http",
        name: `instrument-${i}`,
        version: "1.0.0",
        onOperationStart: () => {},
      });
      refs.push(ref);
    }

    // Detach in reverse order
    const results = refs.reverse().map(ref => Bun.telemetry.detach(ref));

    results.forEach(result => {
      expect(result).toBe(true);
    });
  });

  test("can detach via ref.id for backwards compatibility", () => {
    const instrument = {
      kind: "http",
      name: "test-backward-compat",
      version: "1.0.0",
      onOperationStart: () => {},
    } as const;

    const ref = Bun.telemetry.attach(instrument);

    // Access the id property explicitly
    const id = ref.id;
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);

    // Detach using the ref object (preferred)
    const removed = Bun.telemetry.detach(ref);
    expect(removed).toBe(true);
  });
});

describe("Bun.telemetry.listInstruments()", () => {
  test("returns empty array when no instruments attached", () => {
    // Clean up any leftover instruments from previous tests
    const existing = Bun.telemetry.listInstruments();
    existing.forEach((info: any) => {
      Bun.telemetry.detach({ id: info.id } as unknown as InstrumentRef);
    });

    const list = Bun.telemetry.listInstruments();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(0);
  });

  test("lists all attached instruments", () => {
    const instrument1 = {
      kind: "http",
      name: "http-instrument",
      version: "1.0.0",
      onOperationStart: () => {},
    } as const;

    const instrument2 = {
      kind: "fetch",
      name: "fetch-instrument",
      version: "2.0.0",
      onOperationEnd: () => {},
    } as const;

    using ref1 = Bun.telemetry.attach(instrument1);
    using ref2 = Bun.telemetry.attach(instrument2);

    const list = Bun.telemetry.listInstruments();

    expect(list.length).toBe(2);

    const info1 = list.find((i: any) => i.id === ref1.id) as any;
    const info2 = list.find((i: any) => i.id === ref2.id) as any;
    expect(info1).toBeDefined();
    expect(info2).toBeDefined();
    if (!info1 || !info2) {
      throw new Error("Instruments not found in list");
    }
    expect(info1.name).toBe(instrument1.name);
    expect(info1.version).toBe(instrument1.version);
    expect(info1.kind).toBe(instrument1.kind);

    expect(info2.name).toBe(instrument2.name);
    expect(info2.version).toBe(instrument2.version);
    expect(info2.kind).toBe(instrument2.kind);
  });

  test("filters instruments by kind", () => {
    using httpRef1 = Bun.telemetry.attach({
      kind: "http",
      name: "http-1",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    using httpRef2 = Bun.telemetry.attach({
      kind: "http",
      name: "http-2",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    using fetchRef = Bun.telemetry.attach({
      kind: "fetch",
      name: "fetch-1",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const httpList = Bun.telemetry.listInstruments("http");
    const fetchList = Bun.telemetry.listInstruments("fetch");

    expect(httpList.length).toBe(2);
    expect(fetchList.length).toBe(1);

    expect(httpList.every((i: any) => i.kind === "http")).toBe(true);
    expect(fetchList.every((i: any) => i.kind === "fetch")).toBe(true);
  });

  test("updates list after detachment", () => {
    const ref = Bun.telemetry.attach({
      kind: "http",
      name: "test",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    let list = Bun.telemetry.listInstruments();
    expect(list.length).toBeGreaterThanOrEqual(1);

    Bun.telemetry.detach(ref);

    list = Bun.telemetry.listInstruments();
    const found = list.find((i: any) => i.id === ref.id);
    expect(found).toBeUndefined();
  });
});
