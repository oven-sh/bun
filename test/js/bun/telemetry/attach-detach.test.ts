/**
 * Test Bun.telemetry.attach() and detach() native API
 * NO @opentelemetry/* imports allowed - testing ONLY native hooks
 */
import { describe, expect, test } from "bun:test";

describe("Bun.telemetry.attach()", () => {
  test("returns unique ID for each attached instrument", () => {
    const instrument1 = {
      type: 1, // InstrumentKind.HTTP
      name: "test-instrument-1",
      version: "1.0.0",
      onOperationStart: () => {},
    };

    const instrument2 = {
      type: 1, // InstrumentKind.HTTP
      name: "test-instrument-2",
      version: "1.0.0",
      onOperationStart: () => {},
    };

    const id1 = Bun.telemetry.attach(instrument1);
    const id2 = Bun.telemetry.attach(instrument2);

    expect(typeof id1).toBe("number");
    expect(typeof id2).toBe("number");
    expect(id1).not.toBe(id2);
    expect(id1).toBeGreaterThan(0);
    expect(id2).toBeGreaterThan(0);

    // Cleanup
    Bun.telemetry.detach(id1);
    Bun.telemetry.detach(id2);
  });

  test("accepts instruments with different operation kinds", () => {
    const httpInstrument = {
      type: 1, // InstrumentKind.HTTP
      name: "http-instrument",
      version: "1.0.0",
      onOperationStart: () => {},
    };

    const fetchInstrument = {
      type: 2, // InstrumentKind.Fetch
      name: "fetch-instrument",
      version: "1.0.0",
      onOperationEnd: () => {},
    };

    const httpId = Bun.telemetry.attach(httpInstrument);
    const fetchId = Bun.telemetry.attach(fetchInstrument);

    expect(httpId).toBeGreaterThan(0);
    expect(fetchId).toBeGreaterThan(0);
    expect(httpId).not.toBe(fetchId);

    // Cleanup
    Bun.telemetry.detach(httpId);
    Bun.telemetry.detach(fetchId);
  });

  test("accepts instruments with only one hook function", () => {
    const instruments = [
      {
        type: 1,
        name: "only-start",
        version: "1.0.0",
        onOperationStart: () => {},
      },
      {
        type: 1,
        name: "only-end",
        version: "1.0.0",
        onOperationEnd: () => {},
      },
      {
        type: 1,
        name: "only-error",
        version: "1.0.0",
        onOperationError: () => {},
      },
      {
        type: 1,
        name: "only-inject",
        version: "1.0.0",
        onOperationInject: () => ({}),
      },
    ];

    const ids = instruments.map(inst => Bun.telemetry.attach(inst));

    ids.forEach(id => {
      expect(id).toBeGreaterThan(0);
    });

    // Cleanup
    ids.forEach(id => Bun.telemetry.detach(id));
  });
});

describe("Bun.telemetry.detach()", () => {
  test("removes attached instrument and returns true", () => {
    const instrument = {
      type: 1, // InstrumentKind.HTTP
      name: "test-instrument",
      version: "1.0.0",
      onOperationStart: () => {},
    };

    const id = Bun.telemetry.attach(instrument);
    const removed = Bun.telemetry.detach(id);

    expect(removed).toBe(true);
  });

  test("returns false for non-existent ID", () => {
    const removed = Bun.telemetry.detach(999999);
    expect(removed).toBe(false);
  });

  test("returns false for already-detached ID", () => {
    const instrument = {
      type: 1,
      name: "test",
      version: "1.0.0",
      onOperationStart: () => {},
    };

    const id = Bun.telemetry.attach(instrument);
    Bun.telemetry.detach(id); // First detach

    const removed = Bun.telemetry.detach(id); // Second detach
    expect(removed).toBe(false);
  });

  test("can detach instruments in any order", () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const id = Bun.telemetry.attach({
        type: 1,
        name: `instrument-${i}`,
        version: "1.0.0",
        onOperationStart: () => {},
      });
      ids.push(id);
    }

    // Detach in reverse order
    const results = ids.reverse().map(id => Bun.telemetry.detach(id));

    results.forEach(result => {
      expect(result).toBe(true);
    });
  });
});

describe("Bun.telemetry.listInstruments()", () => {
  test("returns empty array when no instruments attached", () => {
    const list = Bun.telemetry.listInstruments();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(0);
  });

  test("lists all attached instruments", () => {
    const instrument1 = {
      type: 1, // HTTP
      name: "http-instrument",
      version: "1.0.0",
      onOperationStart: () => {},
    };

    const instrument2 = {
      type: 2, // Fetch
      name: "fetch-instrument",
      version: "2.0.0",
      onOperationEnd: () => {},
    };

    const id1 = Bun.telemetry.attach(instrument1);
    const id2 = Bun.telemetry.attach(instrument2);

    const list = Bun.telemetry.listInstruments();

    expect(list.length).toBe(2);

    const info1 = list.find((i: any) => i.id === id1);
    const info2 = list.find((i: any) => i.id === id2);

    expect(info1).toBeDefined();
    expect(info1.kind).toBe(1);
    expect(info1.name).toBe("http-instrument");
    expect(info1.version).toBe("1.0.0");

    expect(info2).toBeDefined();
    expect(info2.kind).toBe(2);
    expect(info2.name).toBe("fetch-instrument");
    expect(info2.version).toBe("2.0.0");

    // Cleanup
    Bun.telemetry.detach(id1);
    Bun.telemetry.detach(id2);
  });

  test("filters instruments by kind", () => {
    const httpId1 = Bun.telemetry.attach({
      type: 1, // HTTP
      name: "http-1",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const httpId2 = Bun.telemetry.attach({
      type: 1, // HTTP
      name: "http-2",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const fetchId = Bun.telemetry.attach({
      type: 2, // Fetch
      name: "fetch-1",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    const httpList = Bun.telemetry.listInstruments(1); // Filter by HTTP
    const fetchList = Bun.telemetry.listInstruments(2); // Filter by Fetch

    expect(httpList.length).toBe(2);
    expect(fetchList.length).toBe(1);

    expect(httpList.every((i: any) => i.kind === 1)).toBe(true);
    expect(fetchList.every((i: any) => i.kind === 2)).toBe(true);

    // Cleanup
    Bun.telemetry.detach(httpId1);
    Bun.telemetry.detach(httpId2);
    Bun.telemetry.detach(fetchId);
  });

  test("updates list after detachment", () => {
    const id = Bun.telemetry.attach({
      type: 1,
      name: "test",
      version: "1.0.0",
      onOperationStart: () => {},
    });

    let list = Bun.telemetry.listInstruments();
    expect(list.length).toBeGreaterThanOrEqual(1);

    Bun.telemetry.detach(id);

    list = Bun.telemetry.listInstruments();
    const found = list.find((i: any) => i.id === id);
    expect(found).toBeUndefined();
  });
});
