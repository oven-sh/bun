let.a = 1;

let.a[0] = 1;

(let[a] = 1);

(let[a].b.c.e = 1);

foo[let[a]] = 1;

(let)[let[a]] = 1;

(let[a] ??= 1);

foo = let[a];

let()[a] = 1;

foo(let)[a] = 1;

foo(let[a])[a] = 1;

(let[0] = 1);

(let["a"] = 1);

let = 1;

var let = 1;

[let[a]] = 1;

({a: let[a]} = 1);

alert(let[0] = 1);

(let[0] = 1) || 2;

((let[0] = 1), 2);

((let[0] = 1) ? a : b);

if (let[0] = 1);

while (let[0] = 1);

do{} while (let[0] = 1);

var a = (let[0] = 1);

(let[0] = 1) instanceof a;

void (let[0] = 1);

(let[0] = 1)();

new (let[0] = 1)();

((let)[0] = 1)``;

((let)[0] = 1).toString;

((let)[0] = 1)?.toString;

[...(let[0] = 1)];

foo = () => (let[0] = 1);

function * foo() {yield (let[0] = 1)}

async function foo() {await (let[0] = 1)}

function foo() {return (let[0] = 1)}

while (true) (let[0] = 1);

throw (let[0] = 1);

({foo: (let[0] = 1)});

[(let[0] = 1)];

for ((let[0] = 1);;);
for ((let)[0] in {});
for ((let)[0] of []);

switch (let[0] = 1) {}

switch (foo) {
  case let[0] = 1:
}

with (let[0] = 1);

(let[x]).foo();

let.let[x].foo();

a = let[x].foo();

(let)[2];

a[1] + (let[2] = 2);
