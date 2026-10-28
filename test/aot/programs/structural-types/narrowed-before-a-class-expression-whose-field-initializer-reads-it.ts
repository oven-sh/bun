function make(v: number | null): { kept: number; read(): number } {
  if (v === null) v = 5;
  return new (class {
    kept = v + 1;
    read(): number {
      return v + this.kept;
    }
  })();
}

console.log(make(null).kept, make(null).read(), make(1).kept, make(1).read());
