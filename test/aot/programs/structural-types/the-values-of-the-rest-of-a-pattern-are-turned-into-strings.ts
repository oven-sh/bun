interface Account {
  label: string;
  x: number;
}
function look(account: Account): string {
  const { label, ...rest } = account;
  return (
    label +
    " " +
    Object.values(rest)
      .map(each => String(each))
      .join()
  );
}
console.log("values " + look({ label: "cd", x: 1.5 }));
