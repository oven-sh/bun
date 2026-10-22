interface Person {
  id: number;
  name: string;
  email: string;
  password: string;
}

type Card = Pick<Person, "name" | "id">;
type Safe = Omit<Person, "password">;
type OnlyId = Pick<Person, "id">;

function listing(o: object): string {
  const walked: string[] = [];
  for (const key in o) walked.push(key);
  return Object.keys(o).join() + " | " + walked.join() + " | " + JSON.stringify(o) + " | " + JSON.stringify({ ...o });
}

function card(c: Card): string {
  return c.id + ":" + c.name;
}

function safe(s: Safe): string {
  return s.id + ":" + s.name + ":" + s.email;
}

function publish(s: Safe): string {
  return JSON.stringify(s);
}

function copySafe(s: Safe): Safe {
  return { ...s };
}

function reallyOmit(p: Person): Safe {
  const { password, ...rest } = p;
  return password.length > 0 ? rest : rest;
}

function reallyPick(p: Person): Card {
  return { name: p.name, id: p.id };
}

const person: Person = { id: 1, name: "ann", email: "a@x", password: "secret" };
const shuffled: Person = { password: "hidden", email: "b@x", name: "bob", id: 2 };

for (const p of [person, shuffled]) {
  const asCard: Card = p;
  const asSafe: Safe = p;
  const asId: OnlyId = p;
  console.log("card: " + card(asCard) + " / " + listing(asCard));
  console.log("safe: " + safe(asSafe) + " / " + listing(asSafe));
  console.log("only id: " + asId.id + " / " + listing(asId));
  console.log("the omitted member is still there: " + ("password" in asSafe) + " " + Object.hasOwn(asSafe, "password"));
  console.log("published: " + publish(asSafe));
  console.log("a copy has it too: " + listing(copySafe(asSafe)));
  console.log("taken out for real: " + listing(reallyOmit(p)));
  console.log("picked for real: " + listing(reallyPick(p)));
}

const narrow: Card = { name: "cat", id: 3 };
const cards: Card[] = [narrow, person, shuffled, reallyPick(person), { id: 4, name: "dan" }];
console.log("cards: " + cards.map(card).join());
console.log("counts: " + cards.map(c => Object.keys(c).length).join());
console.log("json: " + JSON.stringify(cards));

let length = 0;
for (let i = 0; i < 2000; i++) length += card(narrow).length + Object.keys(narrow).length + publishCard(narrow).length;
console.log("2000 honest: " + length);
console.log("then the whole person: " + card(person) + " " + Object.keys(cards[1]).length + " " + publishCard(person));
console.log("then the shuffled one: " + card(shuffled) + " " + Object.keys(cards[2]).length + " " + publishCard(shuffled));

function publishCard(c: Card): string {
  return JSON.stringify(c) + JSON.stringify({ ...c });
}

class Directory {
  front: Card;
  all: Safe[] = [];
  constructor(p: Person) {
    this.front = p;
    this.all.push(p);
  }
  dump(): string {
    return JSON.stringify(this);
  }
}
console.log("fields: " + new Directory(person).dump());

function rename(c: Card, name: string): void {
  c.name = name;
}
rename(shuffled, "robert");
console.log("stored through the pick: " + JSON.stringify(shuffled));

const back: Partial<Person> = narrow;
console.log("a pick seen as a partial: " + back.password + " " + ("password" in back));
const wholeBack: Partial<Person> = cards[1];
console.log("the whole person seen as a partial: " + wholeBack.password + " " + ("password" in wholeBack));

export {};
