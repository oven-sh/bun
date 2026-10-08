const formatData = pipe(
  zip,
  map(([ ref, data ]) => ({
    nodeId: ref.nodeId.toString(),
    ...attributeFromDataValue(ref.attributeId, data)
  })),
  groupBy(prop('nodeId')),
  map(mergeAll),
  values
);

export const setProp = y => ({
  ...y,
  a: 'very, very, very long very, very long text'
});

export const log = y => {
  console.log('very, very, very long very, very long text')
};
