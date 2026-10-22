class Owner {
  name = "ann";
  age = 3;
}
const full = { owner: new Owner() };
console.log(JSON.stringify(structuredClone({ ...full })));
