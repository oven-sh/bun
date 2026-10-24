class Link {
  next: this | null = null;
  weight = 1;
}

class NamedLink extends Link {
  size = 2;
  name = "named";
  shout(): string {
    return this.name.toUpperCase();
  }
}

const head = new NamedLink();
const seenAsBase: Link = head;
seenAsBase.next = new Link();
const next = head.next;
if (next !== null) {
  console.log(next instanceof NamedLink);
  console.log(typeof next.size);
  console.log(next.size * 2);
  console.log(typeof next.name);
  console.log(next.name + "!");
  console.log(next.weight + 1);
  console.log(Object.keys(next).join());
  try {
    console.log(next.shout());
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
console.log(JSON.stringify(head));

export {};
