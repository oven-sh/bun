model = types
  .model({ something: mxSomething })
  .volatile<[foo]>((self) => ([ loading, false, savingStatus, "idle", undoDisabled, false, aiFocused, false, online, true ]));
