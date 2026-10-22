function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = String(run());
  } catch (error) {
    line = "threw";
  }
  console.log(label + " -> " + line);
}

class Link {
  next: this | null = null;
  weight = 1;
  total(): number {
    return this.next === null ? this.weight : this.weight + this.next.weight;
  }
}

class NamedLink extends Link {
  name = "n";
  size = 1;
  names(): string {
    return this.next === null ? this.name : this.name + this.next.name.toUpperCase();
  }
  sizes(): number {
    return this.next === null ? this.size : this.size + this.next.size;
  }
}

function append(head: Link, tail: Link): void {
  head.next = tail;
}

const head = new NamedLink();
append(head, new NamedLink());
attempt("an honest chain", () => [head.names(), head.sizes(), head.total()]);

append(head, new Link());
console.log(JSON.stringify(head));
attempt("total", () => head.total());
attempt("sizes", () => head.sizes());
attempt("names", () => head.names());
attempt("next.name", () => (head.next === null ? "none" : head.next.name));

export {};
