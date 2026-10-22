// The type argument is a claim of the caller's where `any` is passed. What comes back is whatever went in, and every use of it does what plain JavaScript does.
interface Named {
  name: string;
}

class Item implements Named {
  name = "item";
  size = 2;
}

function same<T>(value: T): T {
  return value;
}

function nameOf<T extends Named>(value: T): string {
  return value.name;
}

function keep<T extends Named>(value: T): T {
  return value;
}

function lastOf<T>(list: T[]): T | undefined {
  return list[list.length - 1];
}

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

const strangers: any[] = ["text", 7, null, undefined, { name: 5 }, { other: 1 }, [1, 2], () => 1, new Item()];

for (const stranger of strangers) {
  console.log(
    [
      attempt(() => same<number>(stranger) + 1),
      attempt(() => same<string>(stranger).length),
      attempt(() => same<Item>(stranger).size),
      attempt(() => nameOf<Item>(stranger)),
      attempt(() => keep<Item>(stranger).name),
      attempt(() => keep<Item>(stranger).size + 1),
      attempt(() => lastOf<number>([stranger])! * 2),
      attempt(() => lastOf<Item>([stranger])!.name),
      attempt(() => typeof same<boolean>(stranger)),
    ].join(" | "),
  );
}
