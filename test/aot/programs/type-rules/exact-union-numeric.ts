// Bit flags that say which fields an object has.
const enum Has { None = 0, Label = 1, Count = 2, Child = 4, Deep = 1 << 20, Top = 1 << 30 }
interface Flagged { flags: Has }
interface WithLabel extends Flagged { label: string }
interface WithCount extends Flagged { count: number }
interface WithChild extends Flagged { child: Flagged }
function make(flags: Has): Flagged {
  const made: Flagged & Partial<WithLabel & WithCount & WithChild> = { flags }
  if (flags & Has.Label) made.label = "l" + flags
  if (flags & Has.Count) made.count = flags * 0.5
  if (flags & Has.Child) made.child = make(flags & ~Has.Child)
  return made
}
const all = make(Has.Label | Has.Count | Has.Child), none = make(Has.None)
// An object made as a type in which the fields are optional is cast to one in which a field is required. It is no member of that type (not assignable), and that type lacks fields it has, so it cannot become one where it is: the cast
// lets it through as it is. The field is read where it is there, and is undefined where it is not. As in ECMAScript.
try { console.log((all as WithLabel).label); console.log("cast to the interface the flags promise: no error") } catch (e) { console.log("cast to the interface the flags promise:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log((all as WithCount).count); console.log("to the second: no error") } catch (e) { console.log("to the second:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log((all as WithChild).child.flags); console.log("to the third: no error") } catch (e) { console.log("to the third:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log((none as WithLabel).label); console.log("where the field is absent: no error") } catch (e) { console.log("where the field is absent:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(JSON.stringify(all), JSON.stringify(none))
// A numeric enum whose members are all int32 is an int32: flags combine, a larger number does not fit. ECMAScript: 4294975488.
all.flags = Has.Top | Has.Deep | 7
console.log(all.flags)
try { all.flags = all.flags * 4096; console.log("beyond 32 bits: no error") } catch (e) { console.log("beyond 32 bits:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { all.flags = all.flags / 4; console.log("a fraction: no error") } catch (e) { console.log("a fraction:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(all.flags)
