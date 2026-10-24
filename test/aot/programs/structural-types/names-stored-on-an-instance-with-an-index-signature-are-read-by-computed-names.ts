function show(run: () => unknown): void {
  console.log(run());
}

interface Scores {
  [player: string]: number;
}
class Scores {
  base: number = 10;
}

function scoreOf(scores: Scores, player: string): number {
  return scores[player];
}

function raised(scores: Scores, player: string): number {
  return scores[player] + 1;
}

const scores = new Scores();
show(() => scores.ann);
show(() => typeof scores.ann);
show(() => scores.ann + 1);
show(() => scoreOf(scores, "constructor"));
scores.ann = 5;
scores["bob"] = 6.5;
show(() => [scores.ann, scoreOf(scores, "bob"), raised(scores, "ann"), Object.keys(scores)]);
scores.cid++;
show(() => [scores.cid, Object.keys(scores)]);
