// In JavaScript, a write to a built-in that is certain to throw under --aot is a warning where a `catch` around it takes over, and the build goes on; where a function stands between, or there is only a `finally`, nothing changes.
const said = [];
try { Object.defineProperty(Array.prototype, "lastOne", { get() { return this[this.length - 1]; }, configurable: true }); said.push("defined"); } catch (e) { said.push("fell back: " + e.name); }
try { String.prototype.shout = function () { return this.toUpperCase() + "!"; }; said.push("assigned"); } catch { said.push("fell back"); }
try {
  if (said.length === 2) {
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
const later = () => { Array.prototype.never = 1; };
try { later(); said.push("stored"); } catch (e) { said.push("thrown in a function: " + e.name); }
console.log(said.join("\n"));
console.log([1, 2, 3].lastOne, typeof "a".shout, Math.max(1, 2), Date.now() === 42, [].never);
