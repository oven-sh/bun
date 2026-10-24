function look(): string {
  const made = Object.assign((): number => 1, { first: 1, second: "two" });
  return Object.values(made)
    .map(each => typeof each + " " + String(each))
    .join();
}
console.log("values " + look());
