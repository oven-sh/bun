a.map(() => ({
  name,
}));
a.map<A>(() => ({
  name,
}));
a.map(():A => ({
  name,
}));
a.map(():{A} => ({
  name,
}));

// https://github.com/excalidraw/excalidraw/blob/e95222ed323d45adf2183bae835c9fb6708e7029/packages/element/src/elbowArrow.ts#L1882C1-L1899C5
_vertical.flatMap((y, row) =>
  _horizontal.map(
    (x, col): Node => ({
      f: 0,
    }),
  ),
);

// https://github.com/excalidraw/excalidraw/blob/e95222ed323d45adf2183bae835c9fb6708e7029/packages/excalidraw/actions/actionProperties.tsx#L1852
updateElbowArrowPoints(newElement, elementsMap, {
  points: [startGlobalPoint, endGlobalPoint].map(
    (p): LocalPoint => pointFrom(p[0] - newElement.x, p[1] - newElement.y),
  ),
});

// https://github.com/vuejs/core/blob/aac7e1898907445c8f89b22047a9bfcf0a6e91b8/packages-private/sfc-playground/src/App.vue#L50
sfcOptions = computed(
  (): SFCOptions => ({
    a,
  }),
);
