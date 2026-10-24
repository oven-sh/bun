class Registry {
  static label = "ab";
}
console.log("before " + typeof Registry.label + " " + Registry.label);
Object.assign(Registry, { label: 7 });
console.log("after " + typeof Registry.label + " " + Registry.label);
