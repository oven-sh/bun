class MyContractSelectionWidget extends React.Component<void,  MyContractSelectionWidgetPropsType, void> implements SomethingLarge {
  method() {}
}

class DisplayObject1
  extends utils.EventEmitter
  implements interaction_InteractiveTarget {
}

class DisplayObject2 extends utils.EventEmitter
  implements interaction_InteractiveTarget {
}

class DisplayObject3 extends utils.EventEmitter
  implements interaction_InteractiveTarget,
    somethingElse_SomeOtherThing,
    somethingElseAgain_RunningOutOfNames {
}

class DisplayObject4 extends utils.EventEmitter implements interaction_InteractiveTarget {}
class Readable extends events.EventEmitter implements NodeJS_ReadableStream {}
class InMemoryAppender extends log4javascript.Appender implements ICachedLogMessageProvider {}

class Foo extends Immutable.Record({
  ipaddress: '',
}) {
  ipaddress: string;
}

export class VisTimelineComponent
	implements AfterViewInit, OnChanges, OnDestroy {
}
export class VisTimelineComponent2
	implements AfterViewInit, OnChanges, OnDestroy, AndSomethingReallyReallyLong {
}
