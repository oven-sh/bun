import { describe, expect, test } from "bun:test";

describe("Yoga.Config", () => {
  test("Config constructor", () => {
    const config = new Yoga.Config();
    expect(config).toBeDefined();
    expect(config.constructor.name).toBe("Config");
  });

  test("Config.create() static method", () => {
    const config = Yoga.Config.create();
    expect(config).toBeDefined();
    expect(config.constructor.name).toBe("Config");
  });

  test("setUseWebDefaults", () => {
    const config = new Yoga.Config();

    // Should not throw
    expect(() => config.setUseWebDefaults(true)).not.toThrow();
    expect(() => config.setUseWebDefaults(false)).not.toThrow();
    expect(() => config.setUseWebDefaults()).not.toThrow(); // defaults to true
  });

  test("useWebDefaults (legacy)", () => {
    const config = new Yoga.Config();

    // Should not throw
    expect(() => config.useWebDefaults()).not.toThrow();
  });

  test("setPointScaleFactor and getPointScaleFactor", () => {
    const config = new Yoga.Config();

    config.setPointScaleFactor(2.0);
    expect(config.getPointScaleFactor()).toBe(2.0);

    config.setPointScaleFactor(0); // disable pixel rounding
    expect(config.getPointScaleFactor()).toBe(0);

    config.setPointScaleFactor(3.5);
    expect(config.getPointScaleFactor()).toBe(3.5);
  });

  test("setErrata and getErrata", () => {
    const config = new Yoga.Config();

    // Test with different errata values
    config.setErrata(Yoga.Errata.None);
    expect(config.getErrata()).toBe(Yoga.Errata.None);

    config.setErrata(Yoga.Errata.Classic);
    expect(config.getErrata()).toBe(Yoga.Errata.Classic);

    config.setErrata(Yoga.Errata.All);
    expect(config.getErrata()).toBe(Yoga.Errata.All);
  });

  test("setExperimentalFeatureEnabled and isExperimentalFeatureEnabled", () => {
    const config = new Yoga.Config();

    // Test with a hypothetical experimental feature
    const feature = 0; // Assuming 0 is a valid experimental feature

    config.setExperimentalFeatureEnabled(feature, true);
    expect(config.isExperimentalFeatureEnabled(feature)).toBe(true);

    config.setExperimentalFeatureEnabled(feature, false);
    expect(config.isExperimentalFeatureEnabled(feature)).toBe(false);
  });

  test("isEnabledForNodes", () => {
    const config = new Yoga.Config();

    // Should return true for a valid config
    expect(config.isEnabledForNodes()).toBe(true);
  });

  test("free", () => {
    const config = new Yoga.Config();

    // Should not throw
    expect(() => config.free()).not.toThrow();

    // After free, methods should throw or handle gracefully
    // This depends on implementation - for now just test it doesn't crash
    expect(() => config.free()).not.toThrow(); // double free should be safe
  });

  test("error handling", () => {
    const config = new Yoga.Config();

    // Test invalid arguments
    expect(() => config.setErrata()).toThrow();
    expect(() => config.setExperimentalFeatureEnabled()).toThrow();
    expect(() => config.setExperimentalFeatureEnabled(0)).toThrow(); // missing second arg
    expect(() => config.isExperimentalFeatureEnabled()).toThrow();
    expect(() => config.setPointScaleFactor()).toThrow();
  });
});
