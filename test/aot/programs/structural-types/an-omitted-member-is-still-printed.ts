interface Person {
  name: string;
  password: string;
}

function publish(p: Omit<Person, "password">): string {
  return JSON.stringify(p) + " " + Object.keys(p).join() + " " + JSON.stringify({ ...p });
}

const person: Person = { name: "ann", password: "secret" };
console.log(publish(person));
console.log(publish({ name: "bob" }));

export {};
