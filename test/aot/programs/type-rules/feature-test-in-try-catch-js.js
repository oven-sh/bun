// A write that the lock of a built-in refuses and that a `catch` around it takes over is a warning, and the build goes on: the write throws a TypeError when it runs. A name that `Array.prototype` or `String.prototype` does not have can be added to it, a write to a built-in that is not locked succeeds, and the program sees them all.
const said = [];
try { Object.defineProperty(Array.prototype, "at", { value() { return "replaced"; }, writable: true, configurable: true }); said.push("defined"); } catch (e) { said.push("fell back: " + e.name); }
try { Object.defineProperty(Array.prototype, "lastOne", { get() { return this[this.length - 1]; }, configurable: true }); said.push("defined"); } catch (e) { said.push("fell back: " + e.name); }
try { String.prototype.shout = function () { return this.toUpperCase() + "!"; }; said.push("assigned"); } catch { said.push("fell back"); }
try {
  if (said.length === 3) {
    for (const name of ["a"]) {
      switch (name) {
        case "a":
          Math.max = () => 0;
          said.push("replaced");
      }
    }
  }
} catch (e) {
  said.push("fell back: " + (e instanceof TypeError));
} finally {
  said.push("finally");
}
try { try { Date.now = () => 42; said.push("replaced"); } finally { said.push("inner finally"); } } catch (e) { said.push("the outer catch: " + e.name); }
const later = () => { Object.prototype.never = 1; };
try { later(); said.push("stored"); } catch (e) { said.push("thrown in a function: " + e.name); }
console.log(said.join("\n"));
console.log([1, 2, 3].at(0), [1, 2, 3].lastOne, typeof "a".shout, Math.max(1, 2), Date.now() === 42, [].never);
