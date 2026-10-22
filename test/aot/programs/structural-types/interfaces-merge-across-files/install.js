export function install() {
  Object.defineProperty(Array.prototype, "last", { value() { return this[0]; }, configurable: true, writable: true });
  Object.defineProperty(Number.prototype, "doubled", { value() { return String(this) + String(this); }, configurable: true, writable: true });
}
