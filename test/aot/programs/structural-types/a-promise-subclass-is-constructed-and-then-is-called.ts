class Sub extends Promise<number> {}
new Sub(resolve => resolve(1)).then(n => console.log("zzqq " + n));
export {};
