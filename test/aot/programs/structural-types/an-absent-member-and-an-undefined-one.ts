interface Options {
  name: string;
  limit?: number;
}

function show(o: Options): void {
  console.log("limit" in o);
  console.log(Object.keys(o).join());
  console.log(JSON.stringify(o));
  console.log(Object.keys({ ...o }).join());
  console.log(o.limit);
}

show({ name: "absent" });
show({ name: "undefined", limit: undefined });
show({ name: "given", limit: 1 });

export {};
