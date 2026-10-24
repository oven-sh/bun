class Registry {
  static label = "ab";
}
console.log("before " + typeof Registry.label + " " + Registry.label);
console.log("stored " + Reflect.set(Registry, "label", 7));
console.log("after " + typeof Registry.label + " " + Registry.label);
