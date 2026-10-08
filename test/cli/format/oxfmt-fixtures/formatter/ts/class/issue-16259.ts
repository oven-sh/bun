export class longlonglonglonglonglonglonglonglonglonglongclassname
  extends someobjectsomepropertysomeotherproperty.SomeClass {}

export interface longlonglonglonglonglonglonglonglonglonglongclassname
  extends someobjectsomepropertysomeotherproperty.SomeClass {}

let longRunningProvider = new (class
  implements languages.SignatureHelpProvider
{});

let longRunningProvider2 = new (class
  extends languages.SignatureHelpProvider
{});

let longRunningProvider3 = new (class
  extends languages.SignatureHelpProvider<Hello>
{});

let longRunningProvider4 = new (class
  implements languages.SignatureHelpProvider<Hello>
{});

letlonglongRunningProvider = class
  implements languages.SignatureHelpProvider
{};

letlonglongRunningProvider2 = class
  extends languages.SignatureHelpProvider
{};

letlonglongRunningProvider3 = class
  extends languages.SignatureHelpProvider<Hello>
{};

letlonglongRunningProvider4 = class
  implements languages.SignatureHelpProvider<Hello>
{};
