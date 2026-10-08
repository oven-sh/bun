export default function searchUsers(action$) {
  return action$.ofType(ActionTypes.SEARCHED_USERS)
    .map(action => action.payload.query)
    .filter(q => !!q)
    .switchMap(q =>
      Observable.timer(800) // debounce
        .takeUntil(action$.ofType(ActionTypes.CLEARED_SEARCH_RESULTS))
        .mergeMap(() => Observable.merge(
          Observable.of(replace(`?q=${q}`)),
          ajax.getJSON(`https://api.github.com/search/users?q=${q}`)
            .map(res => res.items)
            .map(receiveUsers)
        ))
    );
};
