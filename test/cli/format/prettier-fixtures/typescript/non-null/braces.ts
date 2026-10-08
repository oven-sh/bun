const myFunction2 = (key: string): number =>
  ({
    a: 42,
    b: 42,
  }[key]!)

const myFunction3 = key => ({}!.a);

const f = ((a) => {log(a)})!;

if (a) ({ a, ...b }.a())!.c();

(function() {})!()

class a extends ({}!) {}
