type GetChatsSagaEffects =
  | CallEffect
  | PutEffect<
      | GetUsersRequestedAction
      | GetChatsSucceededAction
      | GetChatsFailedAction
      | GetChatsStartedAction
    >
  | SelectEffect
