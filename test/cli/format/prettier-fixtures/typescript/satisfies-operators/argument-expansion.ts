const bar1 = [1,2,3].reduce((carry, value) => {
  return [...carry, value];
}, ([] satisfies unknown) satisfies number[]);

const bar2 = [1,2,3].reduce((carry, value) => {
  return [...carry, value];
}, ([1, 2, 3] satisfies unknown) satisfies number[]);

const bar3 = [1,2,3].reduce((carry, value) => {
  return {...carry, [value]: true};
}, ({} satisfies unknown) satisfies {[key: number]: boolean});

const bar4 = [1,2,3].reduce((carry, value) => {
  return {...carry, [value]: true};
}, ({1: true} satisfies unknown) satisfies {[key: number]: boolean});

const bar5 = [1,2,3].reduce((carry, value) => {
  return [...carry, value];
}, [] satisfies foo);
