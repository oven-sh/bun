foo(/* HTML */ `<!-- bar1 --> bar <!-- bar2 -->`);
foo(/* HTML */ ` <!-- bar1 --> bar <!-- bar2 --> `);
foo(/* HTML */ `<div><p>bar</p>foo</div>`);
foo(/* HTML */ ` <div><p>bar</p>foo</div> `);
foo(/* GraphQL */ `query { foo { bar } }`);
foo(/* ... */ css`color:magenta`);
const a = b => /* HTML */ `<!-- bar1 --> bar <!-- bar2 -->`
const c = b => /* HTML */ ` <!-- bar1 --> bar <!-- bar2 --> `
