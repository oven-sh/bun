export default store => {
  return callApi(endpoint, schema).then(
    response => next(actionWith({
      response,
      type: successType
    })),
    error => next(actionWith({
      type: failureType,
      error: error.message || 'Something bad happened'
    }))
  )
}

it('should group messages with same created time', () => {
  expect(
    groupMessages(messages).toJS(),
  ).toEqual({
    '11/01/2017 13:36': [
      {message: 'test', messageType: 'SMS', status: 'Unknown', created: '11/01/2017 13:36'},
      {message: 'test', messageType: 'Email', status: 'Unknown', created: '11/01/2017 13:36'},
    ],
    '09/01/2017 17:25': [
      {message: 'te', messageType: 'SMS', status: 'Unknown', created: '09/01/2017 17:25'},
      {message: 'te', messageType: 'Email', status: 'Unknown', created: '09/01/2017 17:25'},
    ],
    '11/01/2017 13:33': [
      {message: 'test', messageType: 'SMS', status: 'Unknown', created: '11/01/2017 13:33'},
      {message: 'test', messageType: 'Email', status: 'Unknown', created: '11/01/2017 13:33'},
    ],
    '11/01/2017 13:37': [
      {message: 'test', messageType: 'SMS', status: 'Unknown', created: '11/01/2017 13:37'},
      {message: 'test', messageType: 'Email', status: 'Unknown', created: '11/01/2017 13:37'},
    ],
  });
});
