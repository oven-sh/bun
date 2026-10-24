type HasLength = { length: number };
function spread(item: HasLength): HasLength {
  return { ...item };
}
console.log(JSON.stringify(spread({ length: 2 })), JSON.stringify(spread("ab")), JSON.stringify(spread([7, 8])));
