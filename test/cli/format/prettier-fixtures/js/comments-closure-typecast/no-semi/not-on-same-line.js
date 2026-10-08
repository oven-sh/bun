/**
@type {{
  bar: string[]
}}
*/
({}).bar.forEach(doStuff);

// 1

/**
@type {{
  bar: string[]
}}
*/

({}).bar.forEach(doStuff);

/**
@type {{
  bar: string[]
}}
*/

(foo.bar.forEach(doStuff));

/**
@type {{
  bar: string[]
}}
*/

// 2
({}).bar.forEach(doStuff);
