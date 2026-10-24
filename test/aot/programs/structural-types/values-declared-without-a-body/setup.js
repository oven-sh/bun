globalThis.ambientCount = "5";
globalThis.ambientName = 12;
globalThis.ambientList = "abc";
globalThis.ambientPoint = { x: "1" };
globalThis.ambientStep = class Step {};
globalThis.ambientTwice = n => [n, n];
globalThis.AmbientBox = function AmbientBox(value) {
  if (new.target === undefined) return "called";
  this.held = value;
};
globalThis.AmbientBox.prototype.get = function () {
  return this.held;
};
globalThis.AmbientTools = { scale: "2", grow: n => n + "0" };
globalThis.AmbientMode = { On: "on", Off: 0 };
