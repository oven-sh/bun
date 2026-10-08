// https://babeljs.io/docs/babel-plugin-syntax-dynamic-import

// There is no example code on babel website

import('./prettier.mjs');
import(prettier);
import('./prettier.mjs').then(module => console.log(module));
import(prettier).then(module => console.log(module));
