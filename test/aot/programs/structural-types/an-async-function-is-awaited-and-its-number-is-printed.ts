async function later(): Promise<number> {
  return 1;
}

console.log("zzqq " + (await later()));

export {};
