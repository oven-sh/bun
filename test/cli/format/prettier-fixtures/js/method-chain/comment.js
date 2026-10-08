function f() {
  return observableFromSubscribeFunction()
    // Debounce manually rather than using editor.onDidStopChanging so that the debounce time is
    // configurable.
    .debounceTime(debounceInterval);
}

_.a(a)
  /* very very very very very very very long such that it is longer than 80 columns */
  .a()

_.a(
  a
)/* very very very very very very very long such that it is longer than 80 columns */
.a();

_.a(
  a
) /* very very very very very very very long such that it is longer than 80 columns */.a();

Something
  // $FlowFixMe(>=0.41.0)
  .getInstance(this.props.dao)
  .getters()

// Warm-up first
measure()
  .then(() => {
    SomethingLong();
  });

measure() // Warm-up first
  .then(() => {
    SomethingLong();
  });

const configModel = this.baseConfigurationService.getCache().consolidated		// global/default values (do NOT modify)
  .merge(this.cachedWorkspaceConfig);

this.doWriteConfiguration(target, value, options) // queue up writes to prevent race conditions
  .then(() => null,
  error => {
    return options.donotNotifyError ? TPromise.wrapError(error) : this.onError(error, target, value);
  });

ret = __DEV__ ?
  // $FlowFixMe: this type differs according to the env
vm.runInContext(source, ctx)
: a

angular.module('AngularAppModule')
  // Hello, I am comment.
  .constant('API_URL', 'http://localhost:8080/api');
