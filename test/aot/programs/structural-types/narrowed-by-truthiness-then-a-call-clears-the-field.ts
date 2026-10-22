function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Leaf {
  weight = 7;
}

class Branch {
  leaf: Leaf | null = new Leaf();
  spare: Leaf | undefined = new Leaf();
}

function clear(b: Branch): void {
  b.leaf = null;
  b.spare = undefined;
}

const branch = new Branch();
if (branch.leaf && branch.spare) {
  say("before", branch.leaf.weight + branch.spare.weight);
  clear(branch);
  say("leaf after", branch.leaf);
  say("spare after", branch.spare);
  try {
    say("leaf weight", branch.leaf.weight);
  } catch (error) {
    say("leaf weight threw a TypeError", error instanceof TypeError);
  }
  try {
    say("spare weight", branch.spare.weight);
  } catch (error) {
    say("spare weight threw a TypeError", error instanceof TypeError);
  }
}
