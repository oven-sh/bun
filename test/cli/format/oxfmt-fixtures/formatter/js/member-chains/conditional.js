id === null
  ? null
  : internal.getSuspenseCache(client).getFragmentRef(
      [id, options.fragment, cache.canonicalStringify(variables)],
      client,
      tslib.__assign(tslib.__assign({}, options), {
        variables: variables,
        from: id,
      }),
    );
