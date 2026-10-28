interface Account {
  label: string;
  x: number;
}
function look(account: Account): string {
  let found = "";
  for (const each of Object.values({ ...account })) found += String(each) + " ";
  return found;
}
console.log("values " + look({ label: "cd", x: 1.5 }));
