class Person {
  #name: string;
  constructor(name: string) {
    this.#name = name;
  }
  
  equals(other: unknown) {
    return (
      other &&
      typeof other === "object" &&
      #name in other && // <- this is new!
      this.#name === other.#name
    );
  }
}
