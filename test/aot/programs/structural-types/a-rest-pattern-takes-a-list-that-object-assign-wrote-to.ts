function tail(): string {
  const list: number[] = [1, 2, 3];
  Object.assign(list, { 1: 5 });
  const [, ...rest] = list;
  return rest.join();
}

console.log(tail());

export {};
