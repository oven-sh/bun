type Described = { mode: "default"; level: "low" | "high" | "none" };

function describe(text: string): Described | undefined {
  if (text === "skip") return undefined;
  return { mode: "default", level: text === "a" ? "low" : text === "b" ? "high" : "none" };
}

const texts = ["skip", "a", "b", "c", "skipped", ""];
for (let round = 0; round < 3; round++) {
  for (const text of texts) {
    const described = describe(text + (round > 5 ? "x" : ""));
    console.log(text, described ? described.mode + " " + described.level : "nothing");
  }
}
