function look(): string {
  const made: Record<string, number> = Object.create(null, { first: { value: 1, enumerable: true } });
  return Object.values(made)
    .map(each => typeof each + " " + String(each))
    .join();
}
console.log("values " + look());
