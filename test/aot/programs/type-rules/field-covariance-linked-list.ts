// Field covariance in a linked list: through the base type, `next` is given a node that is not of the subtype.
interface ListItem { value: number; next: ListItem | null }
interface TwoWay { value: number; next: TwoWay | null; prev: TwoWay | null }
function toText(head: ListItem | null): string { const out: number[] = []; for (let n = head; n !== null; n = n.next) out.push(n.value); return out.join() }
function reverse(head: ListItem | null): ListItem | null { let done: ListItem | null = null; while (head !== null) { const next: ListItem | null = head.next; head.next = done; done = head; head = next } return done }
function nextOfTwoWay(t: TwoWay): TwoWay | null { return t.next }
const first: TwoWay = { prev: null, value: 10, next: null }
const second: TwoWay = { value: 20, next: null, prev: first }
first.next = second
const mixedHead: ListItem = { value: 0, next: first }
try { console.log(toText(reverse(mixedHead))); console.log("stores through the narrower type: no error") } catch (e) { console.log("stores through the narrower type:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(nextOfTwoWay(second) === first); console.log("a link that holds a TwoWay: no error") } catch (e) { console.log("a link that holds a TwoWay:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(nextOfTwoWay(first) === (mixedHead as object)); console.log("a link that holds a ListItem, read as TwoWay: no error") } catch (e) { console.log("a link that holds a ListItem, read as TwoWay:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(toText(second), JSON.stringify(mixedHead))
