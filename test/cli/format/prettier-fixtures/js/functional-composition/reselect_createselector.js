import { createSelector } from 'reselect';

const foo = createSelector(
  getIds,
  getObjects,
  (ids, objects) => ids.map(id => objects[id])
);

const bar = createSelector(
  [getIds, getObjects],
  (ids, objects) => ids.map(id => objects[id])
);
