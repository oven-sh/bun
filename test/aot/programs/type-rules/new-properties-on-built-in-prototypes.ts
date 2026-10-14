// Adding properties to the prototypes of built-in classes (`String.prototype`, `Map.prototype` ..) throws.
try { (String.prototype as any).poop = 1; console.log("String.prototype: no error") } catch (e) { console.log("String.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { (Map.prototype as any).poop = 1; console.log("Map.prototype: no error") } catch (e) { console.log("Map.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { (Error.prototype as any).poop = 1; console.log("Error.prototype: no error") } catch (e) { console.log("Error.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { (Function.prototype as any).poop = 1; console.log("Function.prototype: no error") } catch (e) { console.log("Function.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { (Object.prototype as any).poop = 1; console.log("Object.prototype: no error") } catch (e) { console.log("Object.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.defineProperty(Object.prototype, "poop2", { value: 1, configurable: true }); console.log("Object.prototype, defineProperty: no error") } catch (e) { console.log("Object.prototype, defineProperty:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(("" as any).poop, (new Map() as any).poop, (new Error() as any).poop, (Math.floor as any).poop, ({} as any).poop, ({} as any).poop2)
console.log([Array.prototype, Object.prototype, Function.prototype, String.prototype, Map.prototype, Error.prototype].map(o => Object.isExtensible(o)).join())
