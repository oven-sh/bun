// `Object.defineProperty` on `Object.prototype` throws because it is not extensible.
try { Object.defineProperty(Object.prototype, "tag", { value: "polluted", configurable: true, writable: true }); console.log("a property defined on Object.prototype: no error") } catch (e) { console.log("a property defined on Object.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(({} as any).tag)
