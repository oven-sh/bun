// Objects that were not created by the constructor of a class (an heir, a proxy, a literal under a cast) pass where the class type or its interface is declared, and methods that use no `#` name run on them.
interface Owned { owner: string; level: number }
class Vault implements Owned {
  #secret: number
  private soft = "soft"
  protected guard = true
  constructor(secret: number, public owner: string, readonly level: number = 1) { this.#secret = secret }
  reveal(): number { return this.#secret }
  softly(): string { return this.soft + this.guard }
}
const v = new Vault(7, "ann", 2)
try { const heir: Vault = Object.create(v); console.log("heir as a Vault: no error", heir.owner) } catch (e) { console.log("heir as a Vault:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const wrapped = new Proxy(v, {}); console.log("proxy as a Vault: no error", wrapped.owner) } catch (e) { console.log("proxy as a Vault:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const fake = { owner: "f", level: 0 } as unknown as Vault; console.log("literal as a Vault: no error", fake.owner) } catch (e) { console.log("literal as a Vault:", e instanceof TypeError ? "TypeError" : "other " + e) }
const heir: any = Object.create(v), wrapped: any = new Proxy(v as object, {})
try { console.log(heir.softly()); console.log("method on an heir: no error") } catch (e) { console.log("method on an heir:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(wrapped.softly()); console.log("method on a proxy: no error") } catch (e) { console.log("method on a proxy:", e instanceof TypeError ? "TypeError" : "other " + e) }
function ownerOf(o: Owned): string { return o.owner + o.level }
try { console.log(ownerOf(heir)); console.log("heir as an Owned: no error") } catch (e) { console.log("heir as an Owned:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(ownerOf(wrapped)); console.log("proxy as an Owned: no error") } catch (e) { console.log("proxy as an Owned:", e instanceof TypeError ? "TypeError" : "other " + e) }
// (Not `[v, heir]`: whether an element of a literal with the annotation `Owned[]` is checked against Owned at the literal or at the read is not decided.)
const owners: Owned[] = [v]; (owners as unknown[]).push(heir)
try { console.log(owners.map(o => ownerOf(o)).join()); console.log("heir read from an Owned[]: no error") } catch (e) { console.log("heir read from an Owned[]:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(heir.owner, wrapped.level, ownerOf(v), v.softly())
