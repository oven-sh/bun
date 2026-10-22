enum Answer {
  No = 0,
  Yes = "YES",
}

function kind(answer: Answer): string {
  if (typeof answer === "number") return answer === Answer.No ? "no" : "another number " + answer;
  return answer === Answer.Yes ? "yes" : "another string";
}
function truth(answer: Answer): string {
  return answer ? (answer === Answer.Yes ? "yes" : "truthy, not yes: " + answer) : answer === Answer.No ? "no" : "falsy, not no";
}

const numbers: number[] = [0, 1, -0, 0.5];
console.log(kind(Answer.No), kind(Answer.Yes), truth(Answer.No), truth(Answer.Yes));
for (const n of numbers) {
  const answer: Answer = n;
  console.log(kind(answer), "|", truth(answer));
}
const nan: number = NaN;
console.log(kind(nan), "|", truth(nan));
