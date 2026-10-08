useImperativeHandle(ref, () => ({ getIsPending: () => isPending }), [
  isPending,
]);


useImperativeHandle(
  ref,
  () => {
    return !editor.getInstanceState().isCoarsePointer;
  },
  [editor]
);

// The following output is not the same as above because of this hook requires
// the first argument to be am identifier.
useImperativeHandle(
  'copy shape url',
  () => {
    return !editor.getInstanceState().isCoarsePointer;
  },
  [editor]
);

