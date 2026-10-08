const bar1 = [1,2,3].reduce((carry, value) => {
  return [...carry, value];
}, ([] as unknown) as number[]);

const bar2 = [1,2,3].reduce((carry, value) => {
  return [...carry, value];
}, <Array<number>>[]);

const bar3 = [1,2,3].reduce((carry, value) => {
  return [...carry, value];
}, ([1, 2, 3] as unknown) as number[]);

const bar4 = [1,2,3].reduce((carry, value) => {
  return [...carry, value];
}, <Array<number>>[1, 2, 3]);

const bar5 = [1,2,3].reduce((carry, value) => {
  return {...carry, [value]: true};
}, ({} as unknown) as {[key: number]: boolean});

const bar6 = [1,2,3].reduce((carry, value) => {
  return {...carry, [value]: true};
}, <{[key: number]: boolean}>{});

const bar7 = [1,2,3].reduce((carry, value) => {
  return {...carry, [value]: true};
}, ({1: true} as unknown) as {[key: number]: boolean});

const bar8 = [1,2,3].reduce((carry, value) => {
  return {...carry, [value]: true};
}, <{[key: number]: boolean}>{1: true});

const bar9 = [1,2,3].reduce((carry, value) => {
  return [...carry, value];
}, [] as foo);
