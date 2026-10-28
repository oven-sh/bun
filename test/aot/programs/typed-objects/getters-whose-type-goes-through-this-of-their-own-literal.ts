// The return type of each getter hangs on the type of `this`, which is the literal that holds the getter: under a computed key, and beside a property of the getter's name.
const describe: any = (...values: unknown[]) => values.map(value => typeof value).join(" ");
const key: any = "computed";
const index: any = 3;

const underComputedKey = {
  // @ts-ignore
  get [key]() {
    return describe(this as any, 1);
  },
};

const underComputedIndex = {
  first: "first",
  // @ts-ignore
  get [index]() {
    let result;
    try {
      result = describe(this as any, this.first);
    } catch (error) {}
    return result;
  },
};

const besideAProperty = {
  // @ts-ignore
  size: 1227,
  // @ts-ignore
  get size() {
    let made;
    try {
      made = new (Proxy as any)(ArrayBuffer as any, {} as any, this as any);
    } catch (error) {}
    return made;
  },
};

const withSetter = {
  stored: [] as unknown[],
  // @ts-ignore
  get [key]() {
    return describe(this, this.stored.length);
  },
  // @ts-ignore
  set [key](value) {
    this.stored.push(value);
  },
};

const nested = {
  // @ts-ignore
  get [key]() {
    const inner = {
      // @ts-ignore
      get [key]() {
        return describe(this as any);
      },
    };
    return describe(this as any, inner[key]);
  },
};

console.log(underComputedKey[key], Object.keys(underComputedKey));
console.log(underComputedIndex[index], Object.keys(underComputedIndex));
console.log(
  typeof besideAProperty.size,
  besideAProperty.size === ArrayBuffer,
  Object.getOwnPropertyDescriptor(besideAProperty, "size")!.get !== undefined,
);
withSetter[key] = "a";
withSetter[key] = 2;
console.log(withSetter[key], withSetter.stored);
console.log(nested[key]);
