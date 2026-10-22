interface Part {
  depth: number;
}

const list: Part[] = [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
Object.assign(list, { 1: null });
try {
  console.log(list.map(({ depth }) => depth).join());
} catch (error) {
  console.log(error instanceof TypeError);
}

export {};
