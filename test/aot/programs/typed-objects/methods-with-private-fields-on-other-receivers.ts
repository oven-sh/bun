// Classes with private fields whose methods are called on other receivers.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
class Vault {
  #secret = 7
  level = 1
  reveal(): number { return this.#secret + this.level }
  static holds(o: object): boolean { return #secret in o }
  held = (): number => this.#secret * this.level
}
const vault = new Vault(), reveal = vault.reveal, held = vault.held
console.log(reveal.call(vault), reveal.call(new Vault()), attempt(() => reveal.call({ level: 1 })), attempt(() => reveal.call(Object.create(vault))), attempt(() => reveal()), held(), held.call({ level: 5 }), Vault.holds(vault), Vault.holds(Object.create(vault)), Vault.holds({ level: 1 }))
