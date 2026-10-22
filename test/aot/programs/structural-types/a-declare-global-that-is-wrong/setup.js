Object.assign(globalThis, {
  buildNumber: "17",
  featureFlags: { fast: "no" },
  double: n => String(n) + String(n),
  fixedLimit: 20,
  registry: { length: 1, 0: "only" },
  Gadget: class Gadget {
    constructor(size) {
      this.volume = size;
    }
    grow() {
      return "grown";
    }
  },
});

Object.assign(Math, { half: n => n + "/2" });

export function change() {
  Reflect.set(globalThis, "buildNumber", null);
  Reflect.deleteProperty(globalThis, "featureFlags");
}
