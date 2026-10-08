/*
https://github.com/prettier/prettier/issues/19491

decorators with declare is used extensively in Ember ecosystem,
and we want to make sure that Prettier doesn't break them.
*/

export default class ProjectStatusComponent extends Component<ProjectStatusSig> {
  @service declare server: ServerService;
}
