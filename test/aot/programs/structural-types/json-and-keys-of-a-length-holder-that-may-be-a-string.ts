type HasLength = { length: number };
function json(item: HasLength): string {
  return JSON.stringify(item);
}
function keys(item: HasLength): string[] {
  return Object.keys(item);
}
console.log(json({ length: 2 }), json("ab"), json([7]), keys({ length: 2 }).join(), keys("ab").join());
