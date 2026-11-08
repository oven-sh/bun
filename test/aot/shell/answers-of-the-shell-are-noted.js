// quick.py runs a program that asks the shell what compiled code did a second time, with this file in front. A line says so the first time that one of these functions is called, the first time that
// it answers null, which is what it answers where nothing is counted, and the first time that it answers with more than nothing. A program that was never told more than nothing prints about its
// counts what it would print if nothing were counted.
for (const [name, saysSomething] of [
  ["aotOperationCount", answer => answer > 0],
  ["aotRuntimeCounters", answer => /^[1-9]/m.test(answer)],
  ["aotBuiltinEntries", () => true],
  ["memoryUsageStatistics", () => true],
]) {
  const ask = globalThis[name];
  const noted = new Set();
  const note = what => {
    if (!noted.has(what)) print("the shell " + what + " " + name);
    noted.add(what);
  };
  globalThis[name] = function (...given) {
    const answer = ask.apply(this, given);
    note(saysSomething(answer) ? "answered" : answer === null ? "counts nothing for" : "was asked by");
    return answer;
  };
}
