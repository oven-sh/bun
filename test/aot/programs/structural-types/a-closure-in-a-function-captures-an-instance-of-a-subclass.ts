class Base {
  value = 1;
}

class Child extends Base {}

function block(): void {
  const o = new Child();
  const read = () => o.value;
  console.log(read());
}

block();

export {};
