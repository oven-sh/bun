// As the colors package does: the receiver is String.prototype itself, the names come out of a table.
const styles = { red: 31, green: 32 };
for (const name of Object.keys(styles)) {
  Object.defineProperty(String.prototype, name, {
    configurable: true,
    get() {
      return "<" + styles[name] + ">" + this + "</>";
    },
  });
}
for (const name of ["twice", "thrice"]) {
  String.prototype[name] = function () {
    return this.repeat(name === "twice" ? 2 : 3);
  };
}
Number.prototype["half" + (process.argv.length > 100 ? "x" : "")] = function () {
  return this / 2;
};
console.log("a".red, "b".green, "c".twice(), "d".thrice(), (8).half());
const asked = process.argv.length > 100 ? "green" : "red";
console.log("e"[asked], typeof "f"["twi" + "ce"], Object.keys(String.prototype).sort().join(" "));
