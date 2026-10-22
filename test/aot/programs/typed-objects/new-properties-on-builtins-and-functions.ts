// Adding properties to `Math`, to `Object` and to a built-in function is allowed: none of them is always locked, and a program that writes them sees its write.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name + ":" + (e as Error).message } }
console.log(attempt(() => { (Math as any).poop = 1; return (Math as any).poop }))
console.log(attempt(() => { (Math.floor as any).poop = 1; return (Math.floor as any).poop }))
console.log(attempt(() => { (Object as any).poop = 1; return (Object as any).poop }))
console.log(["Math", "Math.floor", "Object"].join(), [Math, Math.floor, Object].map(o => Object.isExtensible(o)).join())
