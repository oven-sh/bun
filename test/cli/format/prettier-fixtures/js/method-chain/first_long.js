export default function theFunction(action$, store) {
  return action$.ofType(THE_ACTION).switchMap(action => Observable
    .webSocket({
      url: THE_URL,
      more: stuff(),
      evenMore: stuff({
        value1: true,
        value2: false,
        value3: false
      })
    })
    .filter(data => theFilter(data))
    .map(({ theType, ...data }) => theMap(theType, data))
    .retryWhen(errors => errors));
}

function f() {
  return this._getWorker(workerOptions)({
    filePath,
    hasteImplModulePath: this._options.hasteImplModulePath,
  }).then(
    metadata => {
      // `1` for truthy values instead of `true` to save cache space.
      fileMetadata[H.VISITED] = 1;
      const metadataId = metadata.id;
      const metadataModule = metadata.module;
      if (metadataId && metadataModule) {
        fileMetadata[H.ID] = metadataId;
        setModule(metadataId, metadataModule);
      }
      fileMetadata[H.DEPENDENCIES] = metadata.dependencies || [];
    }
  );
}
