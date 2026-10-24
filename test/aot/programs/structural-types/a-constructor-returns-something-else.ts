class Token {
  text = "token";
  size = 5;
  static pool: Token[] = [];
  constructor(mode: number) {
    if (mode === 1) return { text: "literal", size: 7, upper: () => "LITERAL FROM THE CONSTRUCTOR" };
    if (mode === 2 && Token.pool.length > 0) return Token.pool[0];
    if (mode === 3) return new Impostor();
    if (mode === 4) return Object.create(Token.prototype);
    Token.pool.push(this);
  }
  upper(): string {
    return this.text.toUpperCase();
  }
}

class Impostor {
  size = -1;
  extra = "extra";
  text = "impostor";
  upper(): string {
    return "impostor's upper";
  }
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function inspect(t: Token): string {
  return [t.text, t.size, t.upper(), t instanceof Token, t.constructor.name, Object.keys(t).join("+")].join(" ");
}

function make(mode: number): Token {
  return new Token(mode);
}

for (let mode = 0; mode < 5; mode++) {
  attempt("mode " + mode, () => inspect(new Token(mode)));
  attempt("mode " + mode + " through a function", () => inspect(make(mode)));
}

console.log("pooled is the same object: " + (new Token(2) === new Token(2)) + " " + Token.pool.length);

const direct = new Token(1);
console.log("used at once: " + direct.upper() + " " + direct.text.length + " " + (direct instanceof Token));

for (let i = 0; i < 2000; i++) make(2).upper();
attempt("after 2000 honest", () => inspect(make(3)));
attempt("and a literal", () => inspect(make(1)));
attempt("and honest", () => inspect(make(2)));

class Sub extends Token {
  added = "added";
  constructor(mode: number) {
    super(mode);
  }
  both(): string {
    return this.added + " " + this.text;
  }
}

for (let mode = 0; mode < 5; mode++) {
  attempt("subclass, mode " + mode, () => {
    const s = new Sub(mode);
    return [s.added, s.text, s instanceof Sub, s instanceof Token, Object.keys(s).join("+")].join(" ");
  });
  attempt("subclass method, mode " + mode, () => new Sub(mode).both());
}

const list: Token[] = [0, 1, 2, 3].map(make);
console.log("elements: " + list.map(t => t.upper()).join());
console.log("json: " + JSON.stringify(list));

export {};
