interface Draft {
  title: string;
  pages?: number;
  done?: boolean;
}

const draft: Draft = { title: "t", pages: 1, done: true };
console.log(Object.keys(draft).join());
delete draft.pages;
console.log(Object.keys(draft).join());
console.log("pages" in draft);
console.log(draft.pages);
draft.pages = 2;
console.log(Object.keys(draft).join());
console.log(JSON.stringify(draft));

export {};
