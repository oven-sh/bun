({}) satisfies {};
({}) satisfies X;
() => ({}) satisfies X;
this.isTabActionBar((e.target || e.srcElement) satisfies HTMLElement);

'current' in (props.pagination satisfies Object);
('current' in props.pagination) satisfies Object;
start + (yearSelectTotal satisfies number);
(start + yearSelectTotal) satisfies number;
scrollTop > (visibilityHeight satisfies number);
(scrollTop > visibilityHeight) satisfies number;
(bValue satisfies boolean) ? 0 : -1;

async function g1() {
  const test = (await 'foo') satisfies number;
}

var x = (v => v) satisfies (x: number) => string;

foo satisfies unknown satisfies Bar;
foo satisfies unknown as Bar;
foo as unknown satisfies Bar;
