class Own extends Iterator<number> {
  next(): IteratorResult<number> {
    return { done: false, value: 100 };
  }
}

console.log("zzqq " + new Own().next().value);
