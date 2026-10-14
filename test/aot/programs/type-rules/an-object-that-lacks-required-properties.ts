// Runtime type checks: an object that lacks required properties.
interface Whole { a: number; b: { x: number }; c: string; d?: number }
try { const partial: Whole = ((): any => ({}))(); console.log("{} from any into a Whole: no error", Object.keys(partial).length) } catch (e) { console.log("{} from any into a Whole:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const narrowed = ((): Whole => ({ c: "only" } as Whole))(); console.log("{ c } as Whole: no error", Object.keys(narrowed).join()) } catch (e) { console.log("{ c } as Whole:", e instanceof TypeError ? "TypeError" : "other " + e) }
