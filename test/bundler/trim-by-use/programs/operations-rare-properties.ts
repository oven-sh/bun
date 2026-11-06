interface Named {
  name: string;
  size?: number;
}
const named: Named = { name: "n", size: 1 };
delete named.size;
const open: any = named;
open.extra = 7;
console.log("size" in named, "extra" in named, open.extra, Object.keys(named).join());
