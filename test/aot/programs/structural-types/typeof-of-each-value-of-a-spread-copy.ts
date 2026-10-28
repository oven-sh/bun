interface Account {
  label: string;
  x: number;
}
function look(account: Account): string {
  return Object.values({ ...account })
    .map(each => typeof each)
    .join();
}
console.log("kinds " + look({ label: "cd", x: 1.5 }));
