// The message of the TypeError names the value and the type that was expected.
const hide = (v: unknown): any => v
try { const n: number = hide("s"); console.log(n) } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other", (e as Error).message.replace(/ \(in .*/, "")) }
try { const n: number | undefined = hide("s"); console.log(n) } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other", (e as Error).message.replace(/ \(in .*/, "")) }
try { const b: boolean = hide(5); console.log(b) } catch (e) { console.log(e instanceof TypeError ? "TypeError" : "other", (e as Error).message.replace(/ \(in .*/, "")) }
