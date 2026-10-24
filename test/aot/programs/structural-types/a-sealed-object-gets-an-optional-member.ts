interface Settings {
  theme: string;
  size?: number;
}

function setSize(s: Settings, size: number): void {
  s.size = size;
}

const open: Settings = { theme: "a" };
const sealed: Settings = Object.seal({ theme: "b" });
setSize(open, 1);
console.log(JSON.stringify(open));
try {
  setSize(sealed, 1);
  console.log("stored");
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(JSON.stringify(sealed));

export {};
