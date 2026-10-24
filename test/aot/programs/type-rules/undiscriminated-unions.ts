// An object that a class's constructor did not create passes for the class type: `Object.create(C.prototype) as C` is used as a C, by typed and by untyped code.
class Feline { lives = 9; sound() { return "meow" } }
function tell(c: Feline): string { return c.sound() + c.lives }
try { const made = Object.create(Feline.prototype) as Feline; made.lives = 1; console.log(tell(made)); console.log("Object.create(C.prototype) as C: no error") } catch (e) { console.log("Object.create(C.prototype) as C:", e instanceof TypeError ? "TypeError" : "other " + e) }
const loose: any = Object.create(Feline.prototype)
loose.lives = 1
console.log(loose instanceof Feline, loose.lives)
try { console.log(loose.sound()); console.log("a method that does not look at `this`, called by untyped code: no error") } catch (e) { console.log("a method that does not look at `this`, called by untyped code:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(tell(loose)); console.log("passed where a C is wanted: no error") } catch (e) { console.log("passed where a C is wanted:", e instanceof TypeError ? "TypeError" : "other " + e) }
