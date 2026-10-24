


















/**
 * @license React
 * react-reconciler.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use strict";
export default function ($$$config: RR.HostConfig): RR.Reconciler {
  function createFiber(tag: RR.WorkTag, pendingProps: RR.Fiber["pendingProps"], key: string | null, mode: RR.TypeOfMode): RR.Fiber {
    return new (FiberNode as unknown as RR.FiberConstructor)(tag, pendingProps, key, mode);
  }
  function noop(): void {}
  function formatProdErrorMessage(code: number, ...args: unknown[]): string; function formatProdErrorMessage(code: number): string {
    var url = "https://react.dev/errors/" + code;
    if (1 < arguments.length) {
      url += "?args[]=" + encodeURIComponent(arguments[1]);
      for (var i = 2; i < arguments.length; i++)
        url += "&args[]=" + encodeURIComponent(arguments[i]);
    }
    return (
      "Minified React error #" +
      code +
      "; visit " +
      url +
      " for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
    );
  }
  function getNearestMountedFiber(fiber: RR.Fiber): RR.Fiber | null { var fiber$asNext: RR.Fiber | null;
    var node: RR.Fiber = fiber,
      nearestMounted: RR.Fiber | null = fiber;
    if (fiber.alternate) for (; node.return; ) node = node.return;
    else {
      fiber$asNext = node;
      do
        (node = fiber$asNext),
          0 !== (node.flags & 4098) && (nearestMounted = node.return),
          (fiber$asNext = node.return);
      while (fiber$asNext);
    }
    return 3 === node.tag ? nearestMounted : null;
  }
  function assertIsMounted(fiber: RR.Fiber): void {
    if (getNearestMountedFiber(fiber) !== fiber)
      throw Error(formatProdErrorMessage(188));
  }
  function findCurrentFiberUsingSlowPath(fiber: RR.Fiber): RR.Fiber | null {
    var alternate: RR.Fiber | null = fiber.alternate;
    if (!alternate) {
      alternate = getNearestMountedFiber(fiber);
      if (null === alternate) throw Error(formatProdErrorMessage(188));
      return alternate !== fiber ? null : fiber;
    }
    for (var a: RR.Fiber = fiber, b: RR.Fiber | null = alternate; ; ) {
      var parentA: RR.Fiber | null = a.return;
      if (null === parentA) break;
      var parentB: RR.Fiber | null = parentA.alternate;
      if (null === parentB) {
        b = parentA.return;
        if (null !== b) {
          a = b;
          continue;
        }
        break;
      }
      if (parentA.child === parentB.child) {
        for (parentB = parentA.child; parentB; ) {
          if (parentB === a) return assertIsMounted(parentA), fiber;
          if (parentB === b) return assertIsMounted(parentA), alternate;
          parentB = parentB.sibling;
        }
        throw Error(formatProdErrorMessage(188));
      }
      if (a.return !== b.return) (a = parentA), (b = parentB);
      else {
        for (var didFindChild = !1, child$0: RR.Fiber | null = parentA.child; child$0; ) {
          if (child$0 === a) {
            didFindChild = !0;
            a = parentA;
            b = parentB;
            break;
          }
          if (child$0 === b) {
            didFindChild = !0;
            b = parentA;
            a = parentB;
            break;
          }
          child$0 = child$0.sibling;
        }
        if (!didFindChild) {
          for (child$0 = parentB.child; child$0; ) {
            if (child$0 === a) {
              didFindChild = !0;
              a = parentB;
              b = parentA;
              break;
            }
            if (child$0 === b) {
              didFindChild = !0;
              b = parentB;
              a = parentA;
              break;
            }
            child$0 = child$0.sibling;
          }
          if (!didFindChild) throw Error(formatProdErrorMessage(189));
        }
      }
      if (a.alternate !== b) throw Error(formatProdErrorMessage(190));
    }
    if (3 !== a.tag) throw Error(formatProdErrorMessage(188));
    return (a.stateNode as RR.FiberRoot).current === a ? fiber : alternate;
  }
  function findCurrentHostFiberImpl(node: RR.Fiber): RR.Fiber | null { var node$asChild: RR.Fiber | null, tag$asHostFiber: RR.Fiber | null;
    var tag: RR.WorkTag = node.tag;
    if (5 === tag || 26 === tag || 27 === tag || 6 === tag) return node;
    for (node$asChild = node.child; null !== node$asChild; ) {
      tag$asHostFiber = findCurrentHostFiberImpl(node$asChild);
      if (null !== tag$asHostFiber) return tag$asHostFiber;
      node$asChild = node$asChild.sibling;
    }
    return null;
  }
  function findCurrentHostFiberWithNoPortalsImpl(node: RR.Fiber): RR.Fiber | null { var node$asChild: RR.Fiber | null, tag$asHostFiber: RR.Fiber | null;
    var tag: RR.WorkTag = node.tag;
    if (5 === tag || 26 === tag || 27 === tag || 6 === tag) return node;
    for (node$asChild = node.child; null !== node$asChild; ) {
      if (
        4 !== node$asChild.tag &&
        ((tag$asHostFiber = findCurrentHostFiberWithNoPortalsImpl(node$asChild)), null !== tag$asHostFiber)
      )
        return tag$asHostFiber;
      node$asChild = node$asChild.sibling;
    }
    return null;
  }
  function getIteratorFn(maybeIterable: RR.ReactNode): RR.IteratorFn | null {
    if (null === maybeIterable || "object" !== typeof maybeIterable)
      return null;
    maybeIterable =
      (MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL]) ||
      maybeIterable["@@iterator"];
    return "function" === typeof maybeIterable ? maybeIterable : null;
  }
  function getComponentNameFromType(type: RR.AnyElementType): string | null {
    if (null == type) return null;
    if ("function" === typeof type)
      return type.$$typeof === REACT_CLIENT_REFERENCE
        ? null
        : type.displayName || type.name || null;
    if ("string" === typeof type) return type;
    switch (type) {
      case REACT_FRAGMENT_TYPE:
        return "Fragment";
      case REACT_PROFILER_TYPE:
        return "Profiler";
      case REACT_STRICT_MODE_TYPE:
        return "StrictMode";
      case REACT_SUSPENSE_TYPE:
        return "Suspense";
      case REACT_SUSPENSE_LIST_TYPE:
        return "SuspenseList";
      case REACT_ACTIVITY_TYPE:
        return "Activity";
    }
    if ("object" === typeof type)
      switch (type.$$typeof) {
        case REACT_PORTAL_TYPE:
          return "Portal";
        case REACT_CONTEXT_TYPE:
          return type.displayName || "Context";
        case REACT_CONSUMER_TYPE:
          return (type._context.displayName || "Context") + ".Consumer";
        case REACT_FORWARD_REF_TYPE:
          var innerType = type.render;
          type = type.displayName;
          type ||
            ((type = innerType.displayName || innerType.name || ""),
            (type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef"));
          return type;
        case REACT_MEMO_TYPE:
          return (
            (innerType = type.displayName || null),
            null !== innerType
              ? innerType
              : getComponentNameFromType(type.type) || "Memo"
          );
        case REACT_LAZY_TYPE:
          innerType = type._payload;
          type = type._init;
          try {
            return getComponentNameFromType(type(innerType));
          } catch (x) {}
      }
    return null;
  }
  function createCursor<T>(defaultValue: T): RR.StackCursor<T> {
    return { current: defaultValue };
  }
  function pop<T>(cursor: RR.StackCursor<T>): void {
    0 > index$jscomp$0 ||
      ((cursor.current = valueStack[index$jscomp$0]),
      (valueStack[index$jscomp$0] = null),
      index$jscomp$0--);
  }
  function push<T>(cursor: RR.StackCursor<T>, value: T): void {
    index$jscomp$0++;
    valueStack[index$jscomp$0] = cursor.current;
    cursor.current = value;
  }
  function clz32Fallback(x: number): number {
    x >>>= 0;
    return 0 === x ? 32 : (31 - ((log$1(x) / LN2) | 0)) | 0;
  }
  function getHighestPriorityLanes(lanes: RR.Lanes): RR.Lanes {
    var pendingSyncLanes: RR.Lanes = lanes & 42;
    if (0 !== pendingSyncLanes) return pendingSyncLanes;
    switch (lanes & -lanes) {
      case 1:
        return 1;
      case 2:
        return 2;
      case 4:
        return 4;
      case 8:
        return 8;
      case 16:
        return 16;
      case 32:
        return 32;
      case 64:
        return 64;
      case 128:
        return 128;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
        return lanes & 261888;
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return lanes & 3932160;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return lanes & 62914560;
      case 67108864:
        return 67108864;
      case 134217728:
        return 134217728;
      case 268435456:
        return 268435456;
      case 536870912:
        return 536870912;
      case 1073741824:
        return 0;
      default:
        return lanes;
    }
  }
  function getNextLanes(root: RR.FiberRoot, wipLanes: RR.Lanes, rootHasPendingCommit: boolean): RR.Lanes { var root$asWarmLanes: RR.Lanes, rootHasPendingCommit$asLanesToPrewarm: RR.Lanes, rootHasPendingCommit$asIdleLanesToPrewarm: RR.Lanes, rootHasPendingCommit$asWipLane: RR.Lane;
    var pendingLanes: RR.Lanes = root.pendingLanes;
    if (0 === pendingLanes) return 0;
    var nextLanes: RR.Lanes = 0,
      suspendedLanes: RR.Lanes = root.suspendedLanes,
      pingedLanes: RR.Lanes = root.pingedLanes;
    root$asWarmLanes = root.warmLanes;
    var nonIdlePendingLanes: RR.Lanes = pendingLanes & 134217727;
    0 !== nonIdlePendingLanes
      ? ((pendingLanes = nonIdlePendingLanes & ~suspendedLanes),
        0 !== pendingLanes
          ? (nextLanes = getHighestPriorityLanes(pendingLanes))
          : ((pingedLanes &= nonIdlePendingLanes),
            0 !== pingedLanes
              ? (nextLanes = getHighestPriorityLanes(pingedLanes))
              : rootHasPendingCommit ||
                ((rootHasPendingCommit$asLanesToPrewarm = nonIdlePendingLanes & ~root$asWarmLanes),
                0 !== rootHasPendingCommit$asLanesToPrewarm &&
                  (nextLanes = getHighestPriorityLanes(rootHasPendingCommit$asLanesToPrewarm)))))
      : ((nonIdlePendingLanes = pendingLanes & ~suspendedLanes),
        0 !== nonIdlePendingLanes
          ? (nextLanes = getHighestPriorityLanes(nonIdlePendingLanes))
          : 0 !== pingedLanes
            ? (nextLanes = getHighestPriorityLanes(pingedLanes))
            : rootHasPendingCommit ||
              ((rootHasPendingCommit$asIdleLanesToPrewarm = pendingLanes & ~root$asWarmLanes),
              0 !== rootHasPendingCommit$asIdleLanesToPrewarm &&
                (nextLanes = getHighestPriorityLanes(rootHasPendingCommit$asIdleLanesToPrewarm))));
    return 0 === nextLanes
      ? 0
      : 0 !== wipLanes &&
          wipLanes !== nextLanes &&
          0 === (wipLanes & suspendedLanes) &&
          ((suspendedLanes = nextLanes & -nextLanes),
          (rootHasPendingCommit$asWipLane = wipLanes & -wipLanes),
          suspendedLanes >= rootHasPendingCommit$asWipLane ||
            (32 === suspendedLanes && 0 !== (rootHasPendingCommit$asWipLane & 4194048)))
        ? wipLanes
        : nextLanes;
  }
  function checkIfRootIsPrerendering(root: RR.FiberRoot, renderLanes: RR.Lanes): boolean {
    return (
      0 ===
      (root.pendingLanes &
        ~(root.suspendedLanes & ~root.pingedLanes) &
        renderLanes)
    );
  }
  function computeExpirationTime(lane: RR.Lane, currentTime: RR.Milliseconds): RR.Milliseconds {
    switch (lane) {
      case 1:
      case 2:
      case 4:
      case 8:
      case 64:
        return currentTime + 250;
      case 16:
      case 32:
      case 128:
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
        return currentTime + 5e3;
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        return -1;
      case 67108864:
      case 134217728:
      case 268435456:
      case 536870912:
      case 1073741824:
        return -1;
      default:
        return -1;
    }
  }
  function claimNextRetryLane(): RR.Lane {
    var lane: RR.Lane = nextRetryLane;
    nextRetryLane <<= 1;
    0 === (nextRetryLane & 62914560) && (nextRetryLane = 4194304);
    return lane;
  }
  function createLaneMap<T>(initial: T): RR.LaneMap<T> {
    for (var laneMap: RR.LaneMap<T> = [], i = 0; 31 > i; i++) laneMap.push(initial);
    return laneMap;
  }
  function markRootUpdated$1(root: RR.FiberRoot, updateLane: RR.Lane): void {
    root.pendingLanes |= updateLane;
    268435456 !== updateLane &&
      ((root.suspendedLanes = 0), (root.pingedLanes = 0), (root.warmLanes = 0));
  }
  function markRootFinished(
    root: RR.FiberRoot,
    finishedLanes: RR.Lanes,
    remainingLanes: RR.Lanes,
    spawnedLane: RR.Lane,
    updatedLanes: RR.Lanes,
    suspendedRetryLanes: RR.Lanes
  ): void {
    var previouslyPendingLanes: RR.Lanes = root.pendingLanes;
    root.pendingLanes = remainingLanes;
    root.suspendedLanes = 0;
    root.pingedLanes = 0;
    root.warmLanes = 0;
    root.expiredLanes &= remainingLanes;
    root.entangledLanes &= remainingLanes;
    root.errorRecoveryDisabledLanes &= remainingLanes;
    root.shellSuspendCounter = 0;
    var entanglements = root.entanglements,
      expirationTimes = root.expirationTimes,
      hiddenUpdates = root.hiddenUpdates;
    for (
      remainingLanes = previouslyPendingLanes & ~remainingLanes;
      0 < remainingLanes;

    ) {
      var index$5 = 31 - clz32(remainingLanes),
        lane = 1 << index$5;
      entanglements[index$5] = 0;
      expirationTimes[index$5] = -1;
      var hiddenUpdatesForLane = hiddenUpdates[index$5];
      if (null !== hiddenUpdatesForLane)
        for (
          hiddenUpdates[index$5] = null, index$5 = 0;
          index$5 < hiddenUpdatesForLane.length;
          index$5++
        ) {
          var update = hiddenUpdatesForLane[index$5];
          null !== update && (update.lane &= -536870913);
        }
      remainingLanes &= ~lane;
    }
    0 !== spawnedLane && markSpawnedDeferredLane(root, spawnedLane, 0);
    0 !== suspendedRetryLanes &&
      0 === updatedLanes &&
      0 !== root.tag &&
      (root.suspendedLanes |=
        suspendedRetryLanes & ~(previouslyPendingLanes & ~finishedLanes));
  }
  function markSpawnedDeferredLane(root: RR.FiberRoot, spawnedLane: RR.Lane, entangledLanes: RR.Lanes): void {
    root.pendingLanes |= spawnedLane;
    root.suspendedLanes &= ~spawnedLane;
    var spawnedLaneIndex = 31 - clz32(spawnedLane);
    root.entangledLanes |= spawnedLane;
    root.entanglements[spawnedLaneIndex] =
      root.entanglements[spawnedLaneIndex] |
      1073741824 |
      (entangledLanes & 261930);
  }
  function markRootEntangled(root: RR.FiberRoot, entangledLanes: RR.Lanes): void { var root$asEntanglements: RR.FiberRoot["entanglements"];
    var rootEntangledLanes: RR.Lanes = (root.entangledLanes |= entangledLanes);
    for (root$asEntanglements = root.entanglements; rootEntangledLanes; ) {
      var index$6 = 31 - clz32(rootEntangledLanes),
        lane = 1 << index$6;
      (lane & entangledLanes) | (root$asEntanglements[index$6] & entangledLanes) &&
        (root$asEntanglements[index$6] |= entangledLanes);
      rootEntangledLanes &= ~lane;
    }
  }
  function getBumpedLaneForHydration(root: RR.FiberRoot, renderLanes: RR.Lanes): RR.Lane {
    var renderLane: RR.Lane = renderLanes & -renderLanes;
    renderLane =
      0 !== (renderLane & 42) ? 1 : getBumpedLaneForHydrationByLane(renderLane);
    return 0 !== (renderLane & (root.suspendedLanes | renderLanes))
      ? 0
      : renderLane;
  }
  function getBumpedLaneForHydrationByLane(lane: RR.Lane): RR.Lane {
    switch (lane) {
      case 2:
        lane = 1;
        break;
      case 8:
        lane = 4;
        break;
      case 32:
        lane = 16;
        break;
      case 256:
      case 512:
      case 1024:
      case 2048:
      case 4096:
      case 8192:
      case 16384:
      case 32768:
      case 65536:
      case 131072:
      case 262144:
      case 524288:
      case 1048576:
      case 2097152:
      case 4194304:
      case 8388608:
      case 16777216:
      case 33554432:
        lane = 128;
        break;
      case 268435456:
        lane = 134217728;
        break;
      default:
        lane = 0;
    }
    return lane;
  }
  function lanesToEventPriority(lanes: RR.Lanes): RR.EventPriority {
    lanes &= -lanes;
    return 2 < lanes
      ? 8 < lanes
        ? 0 !== (lanes & 134217727)
          ? 32
          : 268435456
        : 8
      : 2;
  }
  function setIsStrictModeForDevtools(newIsStrictMode: boolean): void {
    "function" === typeof log && unstable_setDisableYieldValue!(newIsStrictMode);
    if (injectedHook && "function" === typeof injectedHook.setStrictMode)
      try {
        injectedHook.setStrictMode(rendererID, newIsStrictMode);
      } catch (err) {}
  }
  function is(x: unknown, y: any): boolean {
    return (x === y && (0 !== x || 1 / x === 1 / y)) || (x !== x && y !== y);
  }
  function describeBuiltInComponentFrame(name: string): string {
    if (void 0 === prefix)
      try {
        throw Error();
      } catch (x: RR.Thrown) {
        var match: RegExpMatchArray | null = x.stack.trim().match(/\n( *(at )?)/);
        prefix = (match && match[1]) || "";
        suffix =
          -1 < x.stack.indexOf("\n    at")
            ? " (<anonymous>)"
            : -1 < x.stack.indexOf("@")
              ? "@unknown:0:0"
              : "";
      }
    return "\n" + prefix + name + suffix;
  }
  function describeNativeComponentFrame(fn: RR.ComponentFunction, construct: boolean): string {
    if (!fn || reentry) return "";
    reentry = !0;
    var previousPrepareStackTrace: RR.PrepareStackTrace | string | null | undefined = (Error as any).prepareStackTrace;
    (Error as any).prepareStackTrace = void 0;
    try {
      var RunInRootFrame: RR.RootFrameRunner | number = {
        DetermineComponentFrameRoot: function () {
          try {
            if (construct) {
              var Fake: RR.FakeOrResult = function () {
                throw Error();
              };
              Object.defineProperty(Fake.prototype, "props", {
                set: function () {
                  throw Error();
                }
              });
              if ("object" === typeof Reflect && Reflect.construct) {
                try {
                  Reflect.construct(Fake, []);
                } catch (x: RR.Thrown) {
                  var control: Error | undefined = x;
                }
                Reflect.construct(fn, [], Fake);
              } else {
                try {
                  Fake.call();
                } catch (x$8: RR.Thrown) {
                  control = x$8;
                }
                fn.call(Fake.prototype);
              }
            } else {
              try {
                throw Error();
              } catch (x$9: RR.Thrown) {
                control = x$9;
              }
              (Fake = fn()) &&
                "function" === typeof Fake.catch &&
                Fake.catch(function () {});
            }
          } catch (sample: RR.Thrown) {
            if (sample && control && "string" === typeof sample.stack)
              return [sample.stack, control.stack];
          }
          return [null, null];
        }
      };
      RunInRootFrame.DetermineComponentFrameRoot.displayName =
        "DetermineComponentFrameRoot";
      var namePropDescriptor: PropertyDescriptor | number | undefined = Object.getOwnPropertyDescriptor(
        RunInRootFrame.DetermineComponentFrameRoot,
        "name"
      );
      namePropDescriptor &&
        namePropDescriptor.configurable &&
        Object.defineProperty(
          RunInRootFrame.DetermineComponentFrameRoot,
          "name",
          { value: "DetermineComponentFrameRoot" }
        );
      var _RunInRootFrame$Deter = RunInRootFrame.DetermineComponentFrameRoot(),
        sampleStack = _RunInRootFrame$Deter[0],
        controlStack = _RunInRootFrame$Deter[1];
      if (sampleStack && controlStack) {
        var sampleLines = sampleStack.split("\n"),
          controlLines = controlStack.split("\n");
        for (
          namePropDescriptor = RunInRootFrame = 0;
          RunInRootFrame < sampleLines.length &&
          !sampleLines[RunInRootFrame].includes("DetermineComponentFrameRoot");

        )
          RunInRootFrame++;
        for (
          ;
          namePropDescriptor < controlLines.length &&
          !controlLines[namePropDescriptor].includes(
            "DetermineComponentFrameRoot"
          );

        )
          namePropDescriptor++;
        if (
          RunInRootFrame === sampleLines.length ||
          namePropDescriptor === controlLines.length
        )
          for (
            RunInRootFrame = sampleLines.length - 1,
              namePropDescriptor = controlLines.length - 1;
            1 <= RunInRootFrame &&
            0 <= namePropDescriptor &&
            sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor];

          )
            namePropDescriptor--;
        for (
          ;
          1 <= RunInRootFrame && 0 <= namePropDescriptor;
          RunInRootFrame--, namePropDescriptor--
        )
          if (
            sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor]
          ) {
            if (1 !== RunInRootFrame || 1 !== namePropDescriptor) {
              do
                if (
                  (RunInRootFrame--,
                  namePropDescriptor--,
                  0 > namePropDescriptor ||
                    sampleLines[RunInRootFrame] !==
                      controlLines[namePropDescriptor])
                ) {
                  var frame =
                    "\n" +
                    sampleLines[RunInRootFrame].replace(" at new ", " at ");
                  fn.displayName &&
                    frame.includes("<anonymous>") &&
                    (frame = frame.replace("<anonymous>", fn.displayName));
                  return frame;
                }
              while (1 <= RunInRootFrame && 0 <= namePropDescriptor);
            }
            break;
          }
      }
    } finally {
      (reentry = !1), ((Error as any).prepareStackTrace = previousPrepareStackTrace);
    }
    return (previousPrepareStackTrace = fn ? fn.displayName || fn.name : "")
      ? describeBuiltInComponentFrame(previousPrepareStackTrace as string)
      : "";
  }
  function describeFiber(fiber: RR.Fiber, childFiber: RR.Fiber | null): string {
    switch (fiber.tag) {
      case 26:
      case 27:
      case 5:
        return describeBuiltInComponentFrame(fiber.type as string);
      case 16:
        return describeBuiltInComponentFrame("Lazy");
      case 13:
        return fiber.child !== childFiber && null !== childFiber
          ? describeBuiltInComponentFrame("Suspense Fallback")
          : describeBuiltInComponentFrame("Suspense");
      case 19:
        return describeBuiltInComponentFrame("SuspenseList");
      case 0:
      case 15:
        return describeNativeComponentFrame(fiber.type as RR.FunctionComponent, !1);
      case 11:
        return describeNativeComponentFrame((fiber.type as RR.ForwardRefType).render, !1);
      case 1:
        return describeNativeComponentFrame(fiber.type as RR.ClassComponent, !0);
      case 31:
        return describeBuiltInComponentFrame("Activity");
      default:
        return "";
    }
  }
  function getStackByFiberInDevAndProd(workInProgress$given: RR.Fiber): string { var workInProgress; workInProgress = workInProgress$given;
    try {
      var info = "",
        previous: RR.Fiber | null = null;
      do
        (info += describeFiber(workInProgress, previous)),
          (previous = workInProgress),
          (workInProgress = workInProgress.return);
      while (workInProgress);
      return info;
    } catch (x: RR.Thrown) {
      return "\nError generating stack: " + x.message + "\n" + x.stack;
    }
  }
  function createCapturedValueAtFiber(value: RR.Thrown, source: RR.Fiber): RR.CapturedValue { var source$asCaptured: RR.CapturedValue;
    if ("object" === typeof value && null !== value) {
      var existing = CapturedStacks.get(value);
      if (void 0 !== existing) return existing;
      source$asCaptured = {
        value: value,
        source: source,
        stack: getStackByFiberInDevAndProd(source)
      } as RR.CapturedValue;
      CapturedStacks.set(value, source$asCaptured);
      return source$asCaptured;
    }
    return {
      value: value,
      source: source,
      stack: getStackByFiberInDevAndProd(source)
    };
  }
  function pushTreeFork(workInProgress: RR.Fiber, totalChildren: number): void {
    forkStack[forkStackIndex++] = treeForkCount;
    forkStack[forkStackIndex++] = treeForkProvider;
    treeForkProvider = workInProgress;
    treeForkCount = totalChildren;
  }
  function pushTreeId(workInProgress: RR.Fiber, totalChildren: number, index: number): void { var workInProgress$asBaseOverflow: string, length$asNewOverflow: string;
    idStack[idStackIndex++] = treeContextId;
    idStack[idStackIndex++] = treeContextOverflow;
    idStack[idStackIndex++] = treeContextProvider;
    treeContextProvider = workInProgress;
    var baseIdWithLeadingBit = treeContextId;
    workInProgress$asBaseOverflow = treeContextOverflow;
    var baseLength = 32 - clz32(baseIdWithLeadingBit) - 1;
    baseIdWithLeadingBit &= ~(1 << baseLength);
    index += 1;
    var length: number = 32 - clz32(totalChildren) + baseLength;
    if (30 < length) {
      var numberOfOverflowBits = baseLength - (baseLength % 5);
      length$asNewOverflow = (
        baseIdWithLeadingBit &
        ((1 << numberOfOverflowBits) - 1)
      ).toString(32);
      baseIdWithLeadingBit >>= numberOfOverflowBits;
      baseLength -= numberOfOverflowBits;
      treeContextId =
        (1 << (32 - clz32(totalChildren) + baseLength)) |
        (index << baseLength) |
        baseIdWithLeadingBit;
      treeContextOverflow = length$asNewOverflow + workInProgress$asBaseOverflow;
    } else
      (treeContextId =
        (1 << length) | (index << baseLength) | baseIdWithLeadingBit),
        (treeContextOverflow = workInProgress$asBaseOverflow);
  }
  function pushMaterializedTreeId(workInProgress: RR.Fiber): void {
    null !== workInProgress.return &&
      (pushTreeFork(workInProgress, 1), pushTreeId(workInProgress, 1, 0));
  }
  function popTreeContext(workInProgress: RR.Fiber): void {
    for (; workInProgress === treeForkProvider; )
      (treeForkProvider = forkStack[--forkStackIndex] as RR.Fiber | null),
        (forkStack[forkStackIndex] = null),
        (treeForkCount = forkStack[--forkStackIndex] as number),
        (forkStack[forkStackIndex] = null);
    for (; workInProgress === treeContextProvider; )
      (treeContextProvider = idStack[--idStackIndex] as RR.Fiber | null),
        (idStack[idStackIndex] = null),
        (treeContextOverflow = idStack[--idStackIndex] as string),
        (idStack[idStackIndex] = null),
        (treeContextId = idStack[--idStackIndex] as number),
        (idStack[idStackIndex] = null);
  }
  function restoreSuspendedTreeContext(workInProgress: RR.Fiber, suspendedContext: RR.TreeContext): void {
    idStack[idStackIndex++] = treeContextId;
    idStack[idStackIndex++] = treeContextOverflow;
    idStack[idStackIndex++] = treeContextProvider;
    treeContextId = suspendedContext.id;
    treeContextOverflow = suspendedContext.overflow;
    treeContextProvider = workInProgress;
  }
  function pushHostContainer(fiber: RR.Fiber, nextRootInstance: RR.Container): void { var fiber$asContext: RR.HostContext;
    push(rootInstanceStackCursor, nextRootInstance);
    push(contextFiberStackCursor, fiber);
    push(contextStackCursor, null);
    fiber$asContext = getRootHostContext(nextRootInstance);
    pop(contextStackCursor);
    push(contextStackCursor, fiber$asContext);
  }
  function popHostContainer(): void {
    pop(contextStackCursor);
    pop(contextFiberStackCursor);
    pop(rootInstanceStackCursor);
  }
  function pushHostContext(fiber: RR.Fiber): void {
    null !== fiber.memoizedState && push(hostTransitionProviderCursor, fiber);
    var context = contextStackCursor.current,
      nextContext = getChildHostContext(context, fiber.type);
    context !== nextContext &&
      (push(contextFiberStackCursor, fiber),
      push(contextStackCursor, nextContext));
  }
  function popHostContext(fiber: RR.Fiber): void {
    contextFiberStackCursor.current === fiber &&
      (pop(contextStackCursor), pop(contextFiberStackCursor));
    hostTransitionProviderCursor.current === fiber &&
      (pop(hostTransitionProviderCursor),
      isPrimaryRenderer
        ? (HostTransitionContext._currentValue = NotPendingTransition)
        : (HostTransitionContext._currentValue2 = NotPendingTransition));
  }
  function throwOnHydrationMismatch(fiber: RR.Fiber, fromText?: boolean): never; function throwOnHydrationMismatch(fiber: RR.Fiber): never {
    var error = Error(
      formatProdErrorMessage(
        418,
        1 < arguments.length && void 0 !== arguments[1] && arguments[1]
          ? "text"
          : "HTML",
        ""
      )
    );
    queueHydrationError(createCapturedValueAtFiber(error, fiber));
    throw HydrationMismatchException;
  }
  function prepareToHydrateHostInstance(fiber: RR.Fiber, hostContext: RR.HostContext): void {
    if (!supportsHydration) throw Error(formatProdErrorMessage(175));
    hydrateInstance!(
      fiber.stateNode,
      fiber.type,
      fiber.memoizedProps,
      hostContext,
      fiber
    ) || throwOnHydrationMismatch(fiber, !0);
  }
  function popToNextHostParent(fiber: RR.Fiber): void {
    for (hydrationParentFiber = fiber.return; hydrationParentFiber; )
      switch (hydrationParentFiber.tag) {
        case 5:
        case 31:
        case 13:
          rootOrSingletonContext = !1;
          return;
        case 27:
        case 3:
          rootOrSingletonContext = !0;
          return;
        default:
          hydrationParentFiber = hydrationParentFiber.return;
      }
  }
  function popHydrationState(fiber: RR.Fiber): boolean { var fiber$asSuspenseState: RR.SuspenseState | null, fiber$asSuspenseInstance: RR.SuspenseInstance | null, fiber$asActivityState: RR.ActivityState | null, fiber$asActivityInstance: RR.ActivityInstance | null;
    if (!supportsHydration || fiber !== hydrationParentFiber) return !1;
    if (!isHydrating) return popToNextHostParent(fiber), (isHydrating = !0), !1;
    var tag = fiber.tag;
    supportsSingletons
      ? 3 !== tag &&
        27 !== tag &&
        (5 !== tag ||
          (shouldDeleteUnhydratedTailInstances!(fiber.type) &&
            !shouldSetTextContent(fiber.type, fiber.memoizedProps))) &&
        nextHydratableInstance &&
        throwOnHydrationMismatch(fiber)
      : 3 !== tag &&
        (5 !== tag ||
          (shouldDeleteUnhydratedTailInstances!(fiber.type) &&
            !shouldSetTextContent(fiber.type, fiber.memoizedProps))) &&
        nextHydratableInstance &&
        throwOnHydrationMismatch(fiber);
    popToNextHostParent(fiber);
    if (13 === tag) {
      if (!supportsHydration) throw Error(formatProdErrorMessage(316));
      fiber$asSuspenseState = fiber.memoizedState as RR.SuspenseState | null;
      fiber$asSuspenseInstance = null !== fiber$asSuspenseState ? fiber$asSuspenseState.dehydrated : null;
      if (!fiber$asSuspenseInstance) throw Error(formatProdErrorMessage(317));
      nextHydratableInstance =
        getNextHydratableInstanceAfterSuspenseInstance!(fiber$asSuspenseInstance);
    } else if (31 === tag) {
      fiber$asActivityState = fiber.memoizedState as RR.ActivityState | null;
      fiber$asActivityInstance = null !== fiber$asActivityState ? fiber$asActivityState.dehydrated : null;
      if (!fiber$asActivityInstance) throw Error(formatProdErrorMessage(317));
      nextHydratableInstance =
        getNextHydratableInstanceAfterActivityInstance!(fiber$asActivityInstance);
    } else
      nextHydratableInstance =
        supportsSingletons && 27 === tag
          ? getNextHydratableSiblingAfterSingleton!(
              fiber.type,
              nextHydratableInstance
            )
          : hydrationParentFiber
            ? getNextHydratableSibling!(fiber.stateNode)
            : null;
    return !0;
  }
  function resetHydrationState(): void {
    supportsHydration &&
      ((nextHydratableInstance = hydrationParentFiber = null),
      (isHydrating = !1));
  }
  function upgradeHydrationErrorsToRecoverable(): RR.CapturedValue[] | null {
    var queuedErrors = hydrationErrors;
    null !== queuedErrors &&
      (null === workInProgressRootRecoverableErrors
        ? (workInProgressRootRecoverableErrors = queuedErrors)
        : workInProgressRootRecoverableErrors.push.apply(
            workInProgressRootRecoverableErrors,
            queuedErrors
          ),
      (hydrationErrors = null));
    return queuedErrors;
  }
  function queueHydrationError(error: RR.CapturedValue): void {
    null === hydrationErrors
      ? (hydrationErrors = [error])
      : hydrationErrors.push(error);
  }
  function pushProvider<T>(providerFiber: RR.Fiber, context: RR.ReactContext<T>, nextValue: T): void {
    isPrimaryRenderer
      ? (push(valueCursor, context._currentValue),
        (context._currentValue = nextValue))
      : (push(valueCursor, context._currentValue2),
        (context._currentValue2 = nextValue));
  }
  function popProvider(context: RR.ReactContext): void {
    var currentValue = valueCursor.current;
    isPrimaryRenderer
      ? (context._currentValue = currentValue)
      : (context._currentValue2 = currentValue);
    pop(valueCursor);
  }
  function scheduleContextWorkOnParentPath(
    parent: RR.Fiber | null,
    renderLanes: RR.Lanes,
    propagationRoot: RR.Fiber
  ): void {
    for (; null !== parent; ) {
      var alternate = parent.alternate;
      (parent.childLanes & renderLanes) !== renderLanes
        ? ((parent.childLanes |= renderLanes),
          null !== alternate && (alternate.childLanes |= renderLanes))
        : null !== alternate &&
          (alternate.childLanes & renderLanes) !== renderLanes &&
          (alternate.childLanes |= renderLanes);
      if (parent === propagationRoot) break;
      parent = parent.return;
    }
  }
  function propagateContextChanges(
    workInProgress: RR.Fiber,
    contexts: RR.ReactContext[],
    renderLanes: RR.Lanes,
    forcePropagateEntireTree: boolean
  ): void { var list$asDep: RR.ContextDependency | null, list$asConsumer: RR.Fiber, list$asAlternate: RR.Fiber | null, dependency$asAlternate: RR.Fiber | null;
    var fiber = workInProgress.child;
    null !== fiber && (fiber.return = workInProgress);
    for (; null !== fiber; ) {
      var list: RR.Dependencies | null = fiber.dependencies;
      if (null !== list) {
        var nextFiber = fiber.child;
        list$asDep = list.firstContext;
        a: for (; null !== list$asDep; ) {
          var dependency: RR.ContextDependency = list$asDep;
          list$asConsumer = fiber;
          for (var i = 0; i < contexts.length; i++)
            if (dependency.context === contexts[i]) {
              list$asConsumer.lanes |= renderLanes;
              dependency$asAlternate = list$asConsumer.alternate;
              null !== dependency$asAlternate && (dependency$asAlternate.lanes |= renderLanes);
              scheduleContextWorkOnParentPath(
                list$asConsumer.return,
                renderLanes,
                workInProgress
              );
              forcePropagateEntireTree || (nextFiber = null);
              break a;
            }
          list$asDep = dependency.next;
        }
      } else if (18 === fiber.tag) {
        nextFiber = fiber.return;
        if (null === nextFiber) throw Error(formatProdErrorMessage(341));
        nextFiber.lanes |= renderLanes;
        list$asAlternate = nextFiber.alternate;
        null !== list$asAlternate && (list$asAlternate.lanes |= renderLanes);
        scheduleContextWorkOnParentPath(nextFiber, renderLanes, workInProgress);
        nextFiber = null;
      } else nextFiber = fiber.child;
      if (null !== nextFiber) nextFiber.return = fiber;
      else
        for (nextFiber = fiber; null !== nextFiber; ) {
          if (nextFiber === workInProgress) {
            nextFiber = null;
            break;
          }
          fiber = nextFiber.sibling;
          if (null !== fiber) {
            fiber.return = nextFiber.return;
            nextFiber = fiber;
            break;
          }
          nextFiber = nextFiber.return;
        }
      fiber = nextFiber;
    }
  }
  function propagateParentContextChanges(
    current: RR.Fiber,
    workInProgress: RR.Fiber,
    renderLanes: RR.Lanes,
    forcePropagateEntireTree: boolean
  ): void { var current$asContexts: RR.ReactContext[] | null, currentParent$asProps: RR.ProviderProps | null;
    current$asContexts = null;
    for (
      var parent: RR.Fiber | null = workInProgress, isInsidePropagationBailout = !1;
      null !== parent;

    ) {
      if (!isInsidePropagationBailout)
        if (0 !== (parent.flags & 524288)) isInsidePropagationBailout = !0;
        else if (0 !== (parent.flags & 262144)) break;
      if (10 === parent.tag) {
        var currentParent: RR.Fiber | null = parent.alternate;
        if (null === currentParent) throw Error(formatProdErrorMessage(387));
        currentParent$asProps = currentParent.memoizedProps as RR.ProviderProps | null;
        if (null !== currentParent$asProps) {
          var context: RR.ReactContext = parent.type as RR.ReactContext;
          objectIs(parent.pendingProps.value, currentParent$asProps.value) ||
            (null !== current$asContexts ? current$asContexts.push(context) : (current$asContexts = [context]));
        }
      } else if (parent === hostTransitionProviderCursor.current) {
        currentParent = parent.alternate;
        if (null === currentParent) throw Error(formatProdErrorMessage(387));
        (currentParent.memoizedState as RR.Hook).memoizedState !==
          (parent.memoizedState as RR.Hook).memoizedState &&
          (null !== current$asContexts
            ? current$asContexts.push(HostTransitionContext)
            : (current$asContexts = [HostTransitionContext]));
      }
      parent = parent.return;
    }
    null !== current$asContexts &&
      propagateContextChanges(
        workInProgress,
        current$asContexts,
        renderLanes,
        forcePropagateEntireTree
      );
    workInProgress.flags |= 262144;
  }
  function checkIfContextChanged(currentDependencies: RR.Dependencies): boolean { var currentDependencies$asDependency: RR.ContextDependency | null;
    for (
      currentDependencies$asDependency = currentDependencies.firstContext;
      null !== currentDependencies$asDependency;

    ) {
      var context = currentDependencies$asDependency.context;
      if (
        !objectIs(
          isPrimaryRenderer ? context._currentValue : context._currentValue2,
          currentDependencies$asDependency.memoizedValue
        )
      )
        return !0;
      currentDependencies$asDependency = currentDependencies$asDependency.next;
    }
    return !1;
  }
  function prepareToReadContext(workInProgress: RR.Fiber): void { var workInProgress$asDependencies: RR.Dependencies | null;
    currentlyRenderingFiber$1 = workInProgress;
    lastContextDependency = null;
    workInProgress$asDependencies = workInProgress.dependencies;
    null !== workInProgress$asDependencies && (workInProgress$asDependencies.firstContext = null);
  }
  function readContext<T>(context: RR.ReactContext<T>): T {
    return readContextForConsumer(currentlyRenderingFiber$1, context);
  }
  function readContextDuringReconciliation<T>(consumer: RR.Fiber, context: RR.ReactContext<T>): T {
    null === currentlyRenderingFiber$1 && prepareToReadContext(consumer);
    return readContextForConsumer(consumer, context);
  }
  function readContextForConsumer<T>(consumer: RR.Fiber | null, context: RR.ReactContext<T>): T { var context$asDependency: RR.ContextDependency;
    var value = isPrimaryRenderer
      ? context._currentValue
      : context._currentValue2;
    context$asDependency = { context: context, memoizedValue: value, next: null } as RR.ContextDependency;
    if (null === lastContextDependency) {
      if (null === consumer) throw Error(formatProdErrorMessage(308));
      lastContextDependency = context$asDependency;
      consumer.dependencies = { lanes: 0, firstContext: context$asDependency };
      consumer.flags |= 524288;
    } else lastContextDependency = lastContextDependency.next = context$asDependency;
    return value;
  }
  function createCache(): RR.Cache {
    return {
      controller: new AbortControllerLocal(),
      data: new Map(),
      refCount: 0
    };
  }
  function releaseCache(cache: RR.Cache): void {
    cache.refCount--;
    0 === cache.refCount &&
      scheduleCallback$2(NormalPriority, function () {
        cache.controller.abort();
      });
  }
  function noop$1(): void {}
  function ensureRootIsScheduled(root: RR.FiberRoot): void {
    root !== lastScheduledRoot &&
      null === root.next &&
      (null === lastScheduledRoot
        ? (firstScheduledRoot = lastScheduledRoot = root)
        : (lastScheduledRoot = lastScheduledRoot.next = root));
    mightHavePendingSyncWork = !0;
    didScheduleMicrotask ||
      ((didScheduleMicrotask = !0), scheduleImmediateRootScheduleTask());
  }
  function flushSyncWorkAcrossRoots_impl(syncTransitionLanes: RR.Lanes, onlyLegacy: boolean): void {
    if (!isFlushingWork && mightHavePendingSyncWork) {
      isFlushingWork = !0;
      do {
        var didPerformSomeWork = !1;
        for (var root: RR.FiberRoot | null = firstScheduledRoot; null !== root; ) {
          if (!onlyLegacy)
            if (0 !== syncTransitionLanes) {
              var pendingLanes = root.pendingLanes;
              if (0 === pendingLanes) var JSCompiler_inline_result: RR.Lanes = 0;
              else {
                var suspendedLanes = root.suspendedLanes,
                  pingedLanes = root.pingedLanes;
                JSCompiler_inline_result =
                  ((1 << (31 - clz32(42 | syncTransitionLanes) + 1)) - 1) as RR.Lanes;
                JSCompiler_inline_result &=
                  pendingLanes & ~(suspendedLanes & ~pingedLanes);
                JSCompiler_inline_result =
                  JSCompiler_inline_result & 201326741
                    ? (JSCompiler_inline_result & 201326741) | 1
                    : JSCompiler_inline_result
                      ? JSCompiler_inline_result | 2
                      : 0;
              }
              0 !== JSCompiler_inline_result &&
                ((didPerformSomeWork = !0),
                performSyncWorkOnRoot(root, JSCompiler_inline_result));
            } else
              (JSCompiler_inline_result = workInProgressRootRenderLanes),
                (JSCompiler_inline_result = getNextLanes(
                  root,
                  root === workInProgressRoot ? JSCompiler_inline_result : 0,
                  null !== root.cancelPendingCommit ||
                    root.timeoutHandle !== noTimeout
                )),
                0 === (JSCompiler_inline_result & 3) ||
                  checkIfRootIsPrerendering(root, JSCompiler_inline_result) ||
                  ((didPerformSomeWork = !0),
                  performSyncWorkOnRoot(root, JSCompiler_inline_result));
          root = root.next;
        }
      } while (didPerformSomeWork);
      isFlushingWork = !1;
    }
  }
  function processRootScheduleInImmediateTask(): void {
    processRootScheduleInMicrotask();
  }
  function processRootScheduleInMicrotask(): void {
    mightHavePendingSyncWork = didScheduleMicrotask = !1;
    var syncTransitionLanes: RR.Lanes = 0;
    0 !== currentEventTransitionLane &&
      shouldAttemptEagerTransition() &&
      (syncTransitionLanes = currentEventTransitionLane);
    for (
      var currentTime = now(), prev: RR.FiberRoot | null = null, root: RR.FiberRoot | null = firstScheduledRoot;
      null !== root;

    ) {
      var next = root.next,
        nextLanes = scheduleTaskForRootDuringMicrotask(root, currentTime);
      if (0 === nextLanes)
        (root.next = null),
          null === prev ? (firstScheduledRoot = next) : (prev.next = next),
          null === next && (lastScheduledRoot = prev);
      else if (
        ((prev = root), 0 !== syncTransitionLanes || 0 !== (nextLanes & 3))
      )
        mightHavePendingSyncWork = !0;
      root = next;
    }
    (0 !== pendingEffectsStatus && 5 !== pendingEffectsStatus) ||
      flushSyncWorkAcrossRoots_impl(syncTransitionLanes, !1);
    0 !== currentEventTransitionLane && (currentEventTransitionLane = 0);
  }
  function scheduleTaskForRootDuringMicrotask(root: RR.FiberRoot, currentTime: RR.Milliseconds): RR.Lane { var currentTime$asRoot: RR.FiberRoot | null, currentTime$asLane: RR.Lane, pingedLanes$asTask: RR.SchedulerTask | null, pingedLanes$asCallback: RR.SchedulerCallback, suspendedLanes$asPriority: RR.SchedulerPriority, suspendedLanes$asTask: RR.SchedulerTask;
    for (
      var suspendedLanes: RR.Lanes = root.suspendedLanes,
        pingedLanes: RR.Lanes = root.pingedLanes,
        expirationTimes = root.expirationTimes,
        lanes = root.pendingLanes & -62914561;
      0 < lanes;

    ) {
      var index$3 = 31 - clz32(lanes),
        lane = 1 << index$3,
        expirationTime = expirationTimes[index$3];
      if (-1 === expirationTime) {
        if (0 === (lane & suspendedLanes) || 0 !== (lane & pingedLanes))
          expirationTimes[index$3] = computeExpirationTime(lane, currentTime);
      } else expirationTime <= currentTime && (root.expiredLanes |= lane);
      lanes &= ~lane;
    }
    currentTime$asRoot = workInProgressRoot;
    suspendedLanes = workInProgressRootRenderLanes;
    suspendedLanes = getNextLanes(
      root,
      root === currentTime$asRoot ? suspendedLanes : 0,
      null !== root.cancelPendingCommit || root.timeoutHandle !== noTimeout
    );
    pingedLanes$asTask = root.callbackNode;
    if (
      0 === suspendedLanes ||
      (root === currentTime$asRoot &&
        (2 === workInProgressSuspendedReason ||
          9 === workInProgressSuspendedReason)) ||
      null !== root.cancelPendingCommit
    )
      return (
        null !== pingedLanes$asTask &&
          null !== pingedLanes$asTask &&
          cancelCallback$1(pingedLanes$asTask),
        (root.callbackNode = null),
        (root.callbackPriority = 0)
      );
    if (
      0 === (suspendedLanes & 3) ||
      checkIfRootIsPrerendering(root, suspendedLanes)
    ) {
      currentTime$asLane = suspendedLanes & -suspendedLanes;
      if (currentTime$asLane === root.callbackPriority) return currentTime$asLane;
      null !== pingedLanes$asTask && cancelCallback$1(pingedLanes$asTask);
      switch (lanesToEventPriority(suspendedLanes)) {
        case 2:
        case 8:
          suspendedLanes$asPriority = UserBlockingPriority;
          break;
        case 32:
          suspendedLanes$asPriority = NormalPriority$1;
          break;
        case 268435456:
          suspendedLanes$asPriority = IdlePriority;
          break;
        default:
          suspendedLanes$asPriority = NormalPriority$1;
      }
      pingedLanes$asCallback = performWorkOnRootViaSchedulerTask.bind(null, root);
      suspendedLanes$asTask = scheduleCallback$3(suspendedLanes$asPriority, pingedLanes$asCallback);
      root.callbackPriority = currentTime$asLane;
      root.callbackNode = suspendedLanes$asTask;
      return currentTime$asLane;
    }
    null !== pingedLanes$asTask &&
      null !== pingedLanes$asTask &&
      cancelCallback$1(pingedLanes$asTask);
    root.callbackPriority = 2;
    root.callbackNode = null;
    return 2;
  }
  function performWorkOnRootViaSchedulerTask(root: RR.FiberRoot, didTimeout: boolean): RR.SchedulerCallback | null {
    if (0 !== pendingEffectsStatus && 5 !== pendingEffectsStatus)
      return (root.callbackNode = null), (root.callbackPriority = 0), null;
    var originalCallbackNode = root.callbackNode;
    if (flushPendingEffects() && root.callbackNode !== originalCallbackNode)
      return null;
    var workInProgressRootRenderLanes$jscomp$0 = workInProgressRootRenderLanes;
    workInProgressRootRenderLanes$jscomp$0 = getNextLanes(
      root,
      root === workInProgressRoot ? workInProgressRootRenderLanes$jscomp$0 : 0,
      null !== root.cancelPendingCommit || root.timeoutHandle !== noTimeout
    );
    if (0 === workInProgressRootRenderLanes$jscomp$0) return null;
    performWorkOnRoot(root, workInProgressRootRenderLanes$jscomp$0, didTimeout);
    scheduleTaskForRootDuringMicrotask(root, now());
    return null != root.callbackNode &&
      root.callbackNode === originalCallbackNode
      ? performWorkOnRootViaSchedulerTask.bind(null, root)
      : null;
  }
  function performSyncWorkOnRoot(root: RR.FiberRoot, lanes: RR.Lanes): null | undefined {
    if (flushPendingEffects()) return null;
    performWorkOnRoot(root, lanes, !0);
  }
  function scheduleImmediateRootScheduleTask(): void {
    supportsMicrotasks
      ? scheduleMicrotask!(function () {
          0 !== (executionContext & 6)
            ? scheduleCallback$3(
                ImmediatePriority,
                processRootScheduleInImmediateTask
              )
            : processRootScheduleInMicrotask();
        })
      : scheduleCallback$3(
          ImmediatePriority,
          processRootScheduleInImmediateTask
        );
  }
  function requestTransitionLane(): RR.Lane {
    if (0 === currentEventTransitionLane) {
      var actionScopeLane = currentEntangledLane;
      0 === actionScopeLane &&
        ((actionScopeLane = nextTransitionUpdateLane),
        (nextTransitionUpdateLane <<= 1),
        0 === (nextTransitionUpdateLane & 261888) &&
          (nextTransitionUpdateLane = 256));
      currentEventTransitionLane = actionScopeLane;
    }
    return currentEventTransitionLane;
  }
  function entangleAsyncAction(transition: RR.Transition, thenable: RR.Wakeable): RR.Wakeable {
    if (null === currentEntangledListeners) {
      var entangledListeners: Array<() => unknown> = (currentEntangledListeners = []);
      currentEntangledPendingCount = 0;
      currentEntangledLane = requestTransitionLane();
      currentEntangledActionThenable = {
        status: "pending",
        value: void 0,
        then: function (resolve) {
          entangledListeners.push(resolve);
        }
      };
    }
    currentEntangledPendingCount++;
    thenable.then(pingEngtangledActionScope, pingEngtangledActionScope);
    return thenable;
  }
  function pingEngtangledActionScope(): void {
    if (
      0 === --currentEntangledPendingCount &&
      null !== currentEntangledListeners
    ) {
      null !== currentEntangledActionThenable &&
        (currentEntangledActionThenable.status = "fulfilled");
      var listeners: Array<() => unknown> = currentEntangledListeners;
      currentEntangledListeners = null;
      currentEntangledLane = 0;
      currentEntangledActionThenable = null;
      for (var i = 0; i < listeners.length; i++) (0, listeners[i])();
    }
  }
  function chainThenableValue<T>(thenable: RR.Thenable<unknown>, result: T): RR.ChainedThenable<T> {
    var listeners: Array<(value?: T) => unknown> = [],
      thenableWithOverride: RR.ChainedThenable<T> = {
        status: "pending",
        value: null,
        reason: null,
        then: function (resolve) {
          listeners.push(resolve);
        }
      };
    thenable.then(
      function () {
        thenableWithOverride.status = "fulfilled";
        thenableWithOverride.value = result;
        for (var i = 0; i < listeners.length; i++) (0, listeners[i])(result);
      },
      function (error: RR.Thrown) { var error$asIndex: number;
        thenableWithOverride.status = "rejected";
        thenableWithOverride.reason = error;
        for (error$asIndex = 0; error$asIndex < listeners.length; error$asIndex++)
          (0, listeners[error$asIndex])(void 0);
      }
    );
    return thenableWithOverride;
  }
  function peekCacheFromPool(): RR.Cache | null {
    var cacheResumedFromPreviousRender = resumedCache.current;
    return null !== cacheResumedFromPreviousRender
      ? cacheResumedFromPreviousRender
      : workInProgressRoot!.pooledCache;
  }
  function pushTransition(offscreenWorkInProgress: RR.Fiber, prevCachePool: RR.SpawnedCachePool | null): void {
    null === prevCachePool
      ? push(resumedCache, resumedCache.current)
      : push(resumedCache, prevCachePool.pool);
  }
  function getSuspendedCache(): RR.SpawnedCachePool | null {
    var cacheFromPool = peekCacheFromPool();
    return null === cacheFromPool
      ? null
      : {
          parent: isPrimaryRenderer
            ? CacheContext._currentValue
            : CacheContext._currentValue2,
          pool: cacheFromPool
        };
  }
  function shallowEqual(objA: RR.Comparand, objB: RR.Comparand): boolean { var keysB$asIndex: number;
    if (objectIs(objA, objB)) return !0;
    if (
      "object" !== typeof objA ||
      null === objA ||
      "object" !== typeof objB ||
      null === objB
    )
      return !1;
    var keysA = Object.keys(objA),
      keysB: string[] = Object.keys(objB);
    if (keysA.length !== keysB.length) return !1;
    for (keysB$asIndex = 0; keysB$asIndex < keysA.length; keysB$asIndex++) {
      var currentKey = keysA[keysB$asIndex];
      if (
        !hasOwnProperty.call(objB, currentKey) ||
        !objectIs(objA[currentKey], objB[currentKey])
      )
        return !1;
    }
    return !0;
  }
  function isThenableResolved(thenable: RR.Thenable<unknown>): boolean { var thenable$asStatus: string | undefined;
    thenable$asStatus = thenable.status;
    return "fulfilled" === thenable$asStatus || "rejected" === thenable$asStatus;
  }
  function trackUsedThenable<T>(thenableState: RR.ThenableState, thenable: RR.Thenable<T>, index: number): T | undefined { var thenableState$asReason: RR.Thrown, thenableState$asRoot: RR.FiberRoot | null, thenableState$asThenable: RR.Thenable<T>, index$asPrevious: RR.ThenableState[number] | undefined;
    index$asPrevious = thenableState[index];
    void 0 === index$asPrevious
      ? thenableState.push(thenable)
      : index$asPrevious !== thenable &&
        (thenable.then(noop$1, noop$1), (thenable = index$asPrevious));
    switch (thenable.status) {
      case "fulfilled":
        return thenable.value;
      case "rejected":
        throw (
          ((thenableState$asReason = thenable.reason),
          checkIfUseWrappedInAsyncCatch(thenableState$asReason),
          thenableState$asReason)
        );
      default:
        if ("string" === typeof thenable.status) thenable.then(noop$1, noop$1);
        else {
          thenableState$asRoot = workInProgressRoot;
          if (null !== thenableState$asRoot && 100 < thenableState$asRoot.shellSuspendCounter)
            throw Error(formatProdErrorMessage(482));
          thenableState$asThenable = thenable;
          thenableState$asThenable.status = "pending";
          thenableState$asThenable.then(
            function (fulfilledValue: RR.UsedValue) {
              if ("pending" === thenable.status) {
                var fulfilledThenable = thenable;
                fulfilledThenable.status = "fulfilled";
                fulfilledThenable.value = fulfilledValue;
              }
            },
            function (error: RR.Thrown) {
              if ("pending" === thenable.status) {
                var rejectedThenable = thenable;
                rejectedThenable.status = "rejected";
                rejectedThenable.reason = error;
              }
            }
          );
        }
        switch (thenable.status) {
          case "fulfilled":
            return thenable.value;
          case "rejected":
            throw (
              ((thenableState$asReason = thenable.reason),
              checkIfUseWrappedInAsyncCatch(thenableState$asReason),
              thenableState$asReason)
            );
        }
        suspendedThenable = thenable;
        throw SuspenseException;
    }
  }
  function resolveLazy(lazyType: RR.LazyComponent): RR.LazyResult {
    try {
      var init = lazyType._init;
      return init(lazyType._payload);
    } catch (x: RR.Thrown) {
      if (null !== x && "object" === typeof x && "function" === typeof x.then)
        throw ((suspendedThenable = x), SuspenseException);
      throw x;
    }
  }
  function getSuspendedThenable(): RR.Thenable | RR.NoopThenable {
    if (null === suspendedThenable) throw Error(formatProdErrorMessage(459));
    var thenable = suspendedThenable;
    suspendedThenable = null;
    return thenable;
  }
  function checkIfUseWrappedInAsyncCatch(rejectedReason: RR.Thrown): void {
    if (
      rejectedReason === SuspenseException ||
      rejectedReason === SuspenseActionException
    )
      throw Error(formatProdErrorMessage(483));
  }
  function unwrapThenable(thenable: RR.Thenable<RR.ReactNode>): RR.ReactNode {
    var index = thenableIndexCounter$1;
    thenableIndexCounter$1 += 1;
    null === thenableState$1 && (thenableState$1 = []);
    return trackUsedThenable(thenableState$1, thenable, index);
  }
  function coerceRef(workInProgress: RR.Fiber, element: RR.ReactElement): void { var element$asRef: RR.Ref | undefined;
    element$asRef = element.props.ref as RR.Ref | undefined;
    workInProgress.ref = void 0 !== element$asRef ? element$asRef : null;
  }
  function throwOnInvalidObjectTypeImpl(returnFiber: RR.Fiber, newChild: RR.ReactNode): never { var returnFiber$asString: string;
    if (newChild.$$typeof === REACT_LEGACY_ELEMENT_TYPE)
      throw Error(formatProdErrorMessage(525));
    returnFiber$asString = Object.prototype.toString.call(newChild);
    throw Error(
      formatProdErrorMessage(
        31,
        "[object Object]" === returnFiber$asString
          ? "object with keys {" + Object.keys(newChild).join(", ") + "}"
          : returnFiber$asString
      )
    );
  }
  function createChildReconciler(shouldTrackSideEffects: boolean): RR.ChildReconciler {
    function deleteChild(returnFiber: RR.Fiber, childToDelete: RR.Fiber): void {
      if (shouldTrackSideEffects) {
        var deletions = returnFiber.deletions;
        null === deletions
          ? ((returnFiber.deletions = [childToDelete]),
            (returnFiber.flags |= 16))
          : deletions.push(childToDelete);
      }
    }
    function deleteRemainingChildren(returnFiber: RR.Fiber, currentFirstChild: RR.Fiber | null): null {
      if (!shouldTrackSideEffects) return null;
      for (; null !== currentFirstChild; )
        deleteChild(returnFiber, currentFirstChild),
          (currentFirstChild = currentFirstChild.sibling);
      return null;
    }
    function mapRemainingChildren(currentFirstChild: RR.Fiber | null): RR.ExistingChildren {
      for (var existingChildren: RR.ExistingChildren = new Map(); null !== currentFirstChild; )
        null !== currentFirstChild.key
          ? existingChildren.set(currentFirstChild.key, currentFirstChild)
          : existingChildren.set(currentFirstChild.index, currentFirstChild),
          (currentFirstChild = currentFirstChild.sibling);
      return existingChildren;
    }
    function useFiber(fiber: RR.Fiber, pendingProps: RR.Fiber["pendingProps"]): RR.Fiber {
      fiber = createWorkInProgress(fiber, pendingProps);
      fiber.index = 0;
      fiber.sibling = null;
      return fiber;
    }
    function placeChild(newFiber: RR.Fiber, lastPlacedIndex: number, newIndex: number): number { var newIndex$asCurrent: RR.Fiber | null, newIndex$asOldIndex: number;
      newFiber.index = newIndex;
      if (!shouldTrackSideEffects)
        return (newFiber.flags |= 1048576), lastPlacedIndex;
      newIndex$asCurrent = newFiber.alternate;
      if (null !== newIndex$asCurrent)
        return (
          (newIndex$asOldIndex = newIndex$asCurrent.index),
          newIndex$asOldIndex < lastPlacedIndex
            ? ((newFiber.flags |= 67108866), lastPlacedIndex)
            : newIndex$asOldIndex
        );
      newFiber.flags |= 67108866;
      return lastPlacedIndex;
    }
    function placeSingleChild(newFiber: RR.Fiber): RR.Fiber {
      shouldTrackSideEffects &&
        null === newFiber.alternate &&
        (newFiber.flags |= 67108866);
      return newFiber;
    }
    function updateTextNode(returnFiber: RR.Fiber, current: RR.Fiber | null, textContent: string, lanes: RR.Lanes): RR.Fiber {
      if (null === current || 6 !== current.tag)
        return (
          (current = createFiberFromText(textContent, returnFiber.mode, lanes)),
          (current.return = returnFiber),
          current
        );
      current = useFiber(current, textContent);
      current.return = returnFiber;
      return current;
    }
    function updateElement(returnFiber: RR.Fiber, current: RR.Fiber | null, element: RR.ReactElement, lanes: RR.Lanes): RR.Fiber {
      var elementType = element.type;
      if (elementType === REACT_FRAGMENT_TYPE)
        return updateFragment(
          returnFiber,
          current,
          element.props.children,
          lanes,
          element.key
        );
      if (
        null !== current &&
        (current.elementType === elementType ||
          ("object" === typeof elementType &&
            null !== elementType &&
            elementType.$$typeof === REACT_LAZY_TYPE &&
            resolveLazy(elementType) === current.type))
      )
        return (
          (current = useFiber(current, element.props)),
          coerceRef(current, element),
          (current.return = returnFiber),
          current
        );
      current = createFiberFromTypeAndProps(
        element.type,
        element.key,
        element.props,
        null,
        returnFiber.mode,
        lanes
      );
      coerceRef(current, element);
      current.return = returnFiber;
      return current;
    }
    function updatePortal(returnFiber: RR.Fiber, current: RR.Fiber | null, portal: RR.ReactPortal, lanes: RR.Lanes): RR.Fiber {
      if (
        null === current ||
        4 !== current.tag ||
        (current.stateNode as RR.PortalState).containerInfo !== portal.containerInfo ||
        (current.stateNode as RR.PortalState).implementation !== portal.implementation
      )
        return (
          (current = createFiberFromPortal(portal, returnFiber.mode, lanes)),
          (current.return = returnFiber),
          current
        );
      current = useFiber(current, portal.children || []);
      current.return = returnFiber;
      return current;
    }
    function updateFragment(returnFiber: RR.Fiber, current: RR.Fiber | null, fragment: RR.ReactNode, lanes: RR.Lanes, key: string | null): RR.Fiber {
      if (null === current || 7 !== current.tag)
        return (
          (current = createFiberFromFragment(
            fragment,
            returnFiber.mode,
            lanes,
            key
          )),
          (current.return = returnFiber),
          current
        );
      current = useFiber(current, fragment);
      current.return = returnFiber;
      return current;
    }
    function createChild(returnFiber: RR.Fiber, newChild: RR.ReactNode, lanes: RR.Lanes): RR.Fiber | null { var newChild$asCreated: RR.Fiber, lanes$asCreated: RR.Fiber;
      if (
        ("string" === typeof newChild && "" !== newChild) ||
        "number" === typeof newChild ||
        "bigint" === typeof newChild
      )
        return (
          (newChild$asCreated = createFiberFromText(
            "" + newChild,
            returnFiber.mode,
            lanes
          )),
          (newChild$asCreated.return = returnFiber),
          newChild$asCreated
        );
      if ("object" === typeof newChild && null !== newChild) {
        switch (newChild.$$typeof) {
          case REACT_ELEMENT_TYPE: var newChild$asElement: RR.ReactElement = newChild;
            return (
              (lanes$asCreated = createFiberFromTypeAndProps(
                newChild$asElement.type,
                newChild$asElement.key,
                newChild$asElement.props,
                null,
                returnFiber.mode,
                lanes
              )),
              coerceRef(lanes$asCreated, newChild$asElement),
              (lanes$asCreated.return = returnFiber),
              lanes$asCreated
            );
          case REACT_PORTAL_TYPE:
            return (
              (newChild$asCreated = createFiberFromPortal(
                newChild,
                returnFiber.mode,
                lanes
              )),
              (newChild$asCreated.return = returnFiber),
              newChild$asCreated
            );
          case REACT_LAZY_TYPE:
            return (
              (newChild = resolveLazy(newChild)),
              createChild(returnFiber, newChild, lanes)
            );
        }
        if (isArrayImpl(newChild) || getIteratorFn(newChild))
          return (
            (newChild$asCreated = createFiberFromFragment(
              newChild,
              returnFiber.mode,
              lanes,
              null
            )),
            (newChild$asCreated.return = returnFiber),
            newChild$asCreated
          );
        if ("function" === typeof newChild.then)
          return createChild(returnFiber, unwrapThenable(newChild), lanes);
        if (newChild.$$typeof === REACT_CONTEXT_TYPE)
          return createChild(
            returnFiber,
            readContextDuringReconciliation(returnFiber, newChild),
            lanes
          );
        throwOnInvalidObjectTypeImpl(returnFiber, newChild);
      }
      return null;
    }
    function updateSlot(returnFiber: RR.Fiber, oldFiber: RR.Fiber | null, newChild: RR.ReactNode, lanes: RR.Lanes): RR.Fiber | null {
      var key = null !== oldFiber ? oldFiber.key : null;
      if (
        ("string" === typeof newChild && "" !== newChild) ||
        "number" === typeof newChild ||
        "bigint" === typeof newChild
      )
        return null !== key
          ? null
          : updateTextNode(returnFiber, oldFiber, "" + newChild, lanes);
      if ("object" === typeof newChild && null !== newChild) {
        switch (newChild.$$typeof) {
          case REACT_ELEMENT_TYPE: var newChild$asElement: RR.ReactElement = newChild;
            return newChild$asElement.key === key
              ? updateElement(returnFiber, oldFiber, newChild$asElement, lanes)
              : null;
          case REACT_PORTAL_TYPE:
            return newChild.key === key
              ? updatePortal(returnFiber, oldFiber, newChild, lanes)
              : null;
          case REACT_LAZY_TYPE:
            return (
              (newChild = resolveLazy(newChild)),
              updateSlot(returnFiber, oldFiber, newChild, lanes)
            );
        }
        if (isArrayImpl(newChild) || getIteratorFn(newChild))
          return null !== key
            ? null
            : updateFragment(returnFiber, oldFiber, newChild, lanes, null);
        if ("function" === typeof newChild.then)
          return updateSlot(
            returnFiber,
            oldFiber,
            unwrapThenable(newChild),
            lanes
          );
        if (newChild.$$typeof === REACT_CONTEXT_TYPE)
          return updateSlot(
            returnFiber,
            oldFiber,
            readContextDuringReconciliation(returnFiber, newChild),
            lanes
          );
        throwOnInvalidObjectTypeImpl(returnFiber, newChild);
      }
      return null;
    }
    function updateFromMap(
      existingChildren: RR.ExistingChildren,
      returnFiber: RR.Fiber,
      newIdx: number,
      newChild: RR.ReactNode,
      lanes: RR.Lanes
    ): RR.Fiber | null { var existingChildren$asMatched: RR.Fiber | null;
      if (
        ("string" === typeof newChild && "" !== newChild) ||
        "number" === typeof newChild ||
        "bigint" === typeof newChild
      )
        return (
          (existingChildren$asMatched = existingChildren.get(newIdx) || null),
          updateTextNode(returnFiber, existingChildren$asMatched, "" + newChild, lanes)
        );
      if ("object" === typeof newChild && null !== newChild) {
        switch (newChild.$$typeof) {
          case REACT_ELEMENT_TYPE: var newChild$asElement: RR.ReactElement = newChild;
            return (
              (existingChildren$asMatched =
                existingChildren.get(
                  null === newChild$asElement.key ? newIdx : newChild$asElement.key
                ) || null),
              updateElement(returnFiber, existingChildren$asMatched, newChild$asElement, lanes)
            );
          case REACT_PORTAL_TYPE:
            return (
              (existingChildren$asMatched =
                existingChildren.get(
                  null === newChild.key ? newIdx : newChild.key
                ) || null),
              updatePortal(returnFiber, existingChildren$asMatched, newChild, lanes)
            );
          case REACT_LAZY_TYPE:
            return (
              (newChild = resolveLazy(newChild)),
              updateFromMap(
                existingChildren,
                returnFiber,
                newIdx,
                newChild,
                lanes
              )
            );
        }
        if (isArrayImpl(newChild) || getIteratorFn(newChild))
          return (
            (existingChildren$asMatched = existingChildren.get(newIdx) || null),
            updateFragment(returnFiber, existingChildren$asMatched, newChild, lanes, null)
          );
        if ("function" === typeof newChild.then)
          return updateFromMap(
            existingChildren,
            returnFiber,
            newIdx,
            unwrapThenable(newChild),
            lanes
          );
        if (newChild.$$typeof === REACT_CONTEXT_TYPE)
          return updateFromMap(
            existingChildren,
            returnFiber,
            newIdx,
            readContextDuringReconciliation(returnFiber, newChild),
            lanes
          );
        throwOnInvalidObjectTypeImpl(returnFiber, newChild);
      }
      return null;
    }
    function reconcileChildrenArray(
      returnFiber: RR.Fiber,
      currentFirstChild: RR.Fiber | null,
      newChildren: RR.ReactNode[],
      lanes: RR.Lanes
    ): RR.Fiber | null { var currentFirstChild$asLastPlacedIndex: number, oldFiber$asCreated: RR.Fiber | null, oldFiber$asExisting: RR.ExistingChildren;
      for (
        var resultingFirstChild: RR.Fiber | null = null,
          previousNewFiber: RR.Fiber | null = null,
          oldFiber: RR.Fiber | null = currentFirstChild,
          newIdx: number = (currentFirstChild$asLastPlacedIndex = 0),
          nextOldFiber: RR.Fiber | null = null;
        null !== oldFiber && newIdx < newChildren.length;
        newIdx++
      ) {
        oldFiber.index > newIdx
          ? ((nextOldFiber = oldFiber), (oldFiber = null))
          : (nextOldFiber = oldFiber.sibling);
        var newFiber = updateSlot(
          returnFiber,
          oldFiber,
          newChildren[newIdx],
          lanes
        );
        if (null === newFiber) {
          null === oldFiber && (oldFiber = nextOldFiber);
          break;
        }
        shouldTrackSideEffects &&
          oldFiber &&
          null === newFiber.alternate &&
          deleteChild(returnFiber, oldFiber);
        currentFirstChild$asLastPlacedIndex = placeChild(newFiber, currentFirstChild$asLastPlacedIndex, newIdx);
        null === previousNewFiber
          ? (resultingFirstChild = newFiber)
          : (previousNewFiber.sibling = newFiber);
        previousNewFiber = newFiber;
        oldFiber = nextOldFiber;
      }
      if (newIdx === newChildren.length)
        return (
          deleteRemainingChildren(returnFiber, oldFiber),
          isHydrating && pushTreeFork(returnFiber, newIdx),
          resultingFirstChild
        );
      if (null === oldFiber) {
        for (; newIdx < newChildren.length; newIdx++)
          (oldFiber$asCreated = createChild(returnFiber, newChildren[newIdx], lanes)),
            null !== oldFiber$asCreated &&
              ((currentFirstChild$asLastPlacedIndex = placeChild(
                oldFiber$asCreated,
                currentFirstChild$asLastPlacedIndex,
                newIdx
              )),
              null === previousNewFiber
                ? (resultingFirstChild = oldFiber$asCreated)
                : (previousNewFiber.sibling = oldFiber$asCreated),
              (previousNewFiber = oldFiber$asCreated));
        isHydrating && pushTreeFork(returnFiber, newIdx);
        return resultingFirstChild;
      }
      for (
        oldFiber$asExisting = mapRemainingChildren(oldFiber);
        newIdx < newChildren.length;
        newIdx++
      )
        (nextOldFiber = updateFromMap(
          oldFiber$asExisting,
          returnFiber,
          newIdx,
          newChildren[newIdx],
          lanes
        )),
          null !== nextOldFiber &&
            (shouldTrackSideEffects &&
              null !== nextOldFiber.alternate &&
              oldFiber$asExisting.delete(
                null === nextOldFiber.key ? newIdx : nextOldFiber.key
              ),
            (currentFirstChild$asLastPlacedIndex = placeChild(
              nextOldFiber,
              currentFirstChild$asLastPlacedIndex,
              newIdx
            )),
            null === previousNewFiber
              ? (resultingFirstChild = nextOldFiber)
              : (previousNewFiber.sibling = nextOldFiber),
            (previousNewFiber = nextOldFiber));
      shouldTrackSideEffects &&
        oldFiber$asExisting.forEach(function (child) {
          return deleteChild(returnFiber, child);
        });
      isHydrating && pushTreeFork(returnFiber, newIdx);
      return resultingFirstChild;
    }
    function reconcileChildrenIterator(
      returnFiber: RR.Fiber,
      currentFirstChild: RR.Fiber | null,
      newChildren: RR.ChildIterator | null | undefined,
      lanes: RR.Lanes
    ): RR.Fiber | null { var currentFirstChild$asLastPlacedIndex: number, oldFiber$asExisting: RR.ExistingChildren, step$asNewFiber: RR.Fiber | null;
      if (null == newChildren) throw Error(formatProdErrorMessage(151));
      for (
        var resultingFirstChild: RR.Fiber | null = null,
          previousNewFiber: RR.Fiber | null = null,
          oldFiber: RR.Fiber | null = currentFirstChild,
          newIdx: number = (currentFirstChild$asLastPlacedIndex = 0),
          nextOldFiber: RR.Fiber | null = null,
          step: RR.ChildIteratorResult = newChildren.next();
        null !== oldFiber && !step.done;
        newIdx++, step = newChildren.next()
      ) {
        oldFiber.index > newIdx
          ? ((nextOldFiber = oldFiber), (oldFiber = null))
          : (nextOldFiber = oldFiber.sibling);
        var newFiber = updateSlot(returnFiber, oldFiber, step.value, lanes);
        if (null === newFiber) {
          null === oldFiber && (oldFiber = nextOldFiber);
          break;
        }
        shouldTrackSideEffects &&
          oldFiber &&
          null === newFiber.alternate &&
          deleteChild(returnFiber, oldFiber);
        currentFirstChild$asLastPlacedIndex = placeChild(newFiber, currentFirstChild$asLastPlacedIndex, newIdx);
        null === previousNewFiber
          ? (resultingFirstChild = newFiber)
          : (previousNewFiber.sibling = newFiber);
        previousNewFiber = newFiber;
        oldFiber = nextOldFiber;
      }
      if (step.done)
        return (
          deleteRemainingChildren(returnFiber, oldFiber),
          isHydrating && pushTreeFork(returnFiber, newIdx),
          resultingFirstChild
        );
      if (null === oldFiber) {
        for (; !step.done; newIdx++, step = newChildren.next())
          (step$asNewFiber = createChild(returnFiber, step.value, lanes)),
            null !== step$asNewFiber &&
              ((currentFirstChild$asLastPlacedIndex = placeChild(
                step$asNewFiber,
                currentFirstChild$asLastPlacedIndex,
                newIdx
              )),
              null === previousNewFiber
                ? (resultingFirstChild = step$asNewFiber)
                : (previousNewFiber.sibling = step$asNewFiber),
              (previousNewFiber = step$asNewFiber));
        isHydrating && pushTreeFork(returnFiber, newIdx);
        return resultingFirstChild;
      }
      for (
        oldFiber$asExisting = mapRemainingChildren(oldFiber);
        !step.done;
        newIdx++, step = newChildren.next()
      )
        (step$asNewFiber = updateFromMap(
          oldFiber$asExisting,
          returnFiber,
          newIdx,
          step.value,
          lanes
        )),
          null !== step$asNewFiber &&
            (shouldTrackSideEffects &&
              null !== step$asNewFiber.alternate &&
              oldFiber$asExisting.delete(null === step$asNewFiber.key ? newIdx : step$asNewFiber.key),
            (currentFirstChild$asLastPlacedIndex = placeChild(step$asNewFiber, currentFirstChild$asLastPlacedIndex, newIdx)),
            null === previousNewFiber
              ? (resultingFirstChild = step$asNewFiber)
              : (previousNewFiber.sibling = step$asNewFiber),
            (previousNewFiber = step$asNewFiber));
      shouldTrackSideEffects &&
        oldFiber$asExisting.forEach(function (child) {
          return deleteChild(returnFiber, child);
        });
      isHydrating && pushTreeFork(returnFiber, newIdx);
      return resultingFirstChild;
    }
    function reconcileChildFibersImpl(
      returnFiber: RR.Fiber,
      currentFirstChild: RR.Fiber | null,
      newChild: RR.ReactNode,
      lanes: RR.Lanes
    ): RR.Fiber | null { var lanes$asFiber: RR.Fiber, key$asType: RR.ReactElement["type"], key$asIteratorFn: RR.IteratorFn | null, newChild$asIterator: RR.ChildIterator | null | undefined, newChild$asText: string;
      "object" === typeof newChild &&
        null !== newChild &&
        newChild.type === REACT_FRAGMENT_TYPE &&
        null === newChild.key &&
        (newChild = newChild.props.children);
      if ("object" === typeof newChild && null !== newChild) {
        switch (newChild.$$typeof) {
          case REACT_ELEMENT_TYPE: var newChild$asElement: RR.ReactElement = newChild;
            a: {
              for (var key: string | null = newChild$asElement.key; null !== currentFirstChild; ) {
                if (currentFirstChild.key === key) {
                  key$asType = newChild$asElement.type;
                  if (key$asType === REACT_FRAGMENT_TYPE) {
                    if (7 === currentFirstChild.tag) {
                      deleteRemainingChildren(
                        returnFiber,
                        currentFirstChild.sibling
                      );
                      lanes$asFiber = useFiber(
                        currentFirstChild,
                        newChild$asElement.props.children
                      );
                      lanes$asFiber.return = returnFiber;
                      returnFiber = lanes$asFiber;
                      break a;
                    }
                  } else if (
                    currentFirstChild.elementType === key$asType ||
                    ("object" === typeof key$asType &&
                      null !== key$asType &&
                      key$asType.$$typeof === REACT_LAZY_TYPE &&
                      resolveLazy(key$asType) === currentFirstChild.type)
                  ) {
                    deleteRemainingChildren(
                      returnFiber,
                      currentFirstChild.sibling
                    );
                    lanes$asFiber = useFiber(currentFirstChild, newChild$asElement.props);
                    coerceRef(lanes$asFiber, newChild$asElement);
                    lanes$asFiber.return = returnFiber;
                    returnFiber = lanes$asFiber;
                    break a;
                  }
                  deleteRemainingChildren(returnFiber, currentFirstChild);
                  break;
                } else deleteChild(returnFiber, currentFirstChild);
                currentFirstChild = currentFirstChild.sibling;
              }
              newChild$asElement.type === REACT_FRAGMENT_TYPE
                ? ((lanes$asFiber = createFiberFromFragment(
                    newChild$asElement.props.children,
                    returnFiber.mode,
                    lanes,
                    newChild$asElement.key
                  )),
                  (lanes$asFiber.return = returnFiber),
                  (returnFiber = lanes$asFiber))
                : ((lanes$asFiber = createFiberFromTypeAndProps(
                    newChild$asElement.type,
                    newChild$asElement.key,
                    newChild$asElement.props,
                    null,
                    returnFiber.mode,
                    lanes
                  )),
                  coerceRef(lanes$asFiber, newChild$asElement),
                  (lanes$asFiber.return = returnFiber),
                  (returnFiber = lanes$asFiber));
            }
            return placeSingleChild(returnFiber);
          case REACT_PORTAL_TYPE:
            a: {
              for (key = newChild.key; null !== currentFirstChild; ) {
                if (currentFirstChild.key === key)
                  if (
                    4 === currentFirstChild.tag &&
                    (currentFirstChild.stateNode as RR.PortalState).containerInfo ===
                      newChild.containerInfo &&
                    (currentFirstChild.stateNode as RR.PortalState).implementation ===
                      newChild.implementation
                  ) {
                    deleteRemainingChildren(
                      returnFiber,
                      currentFirstChild.sibling
                    );
                    lanes$asFiber = useFiber(
                      currentFirstChild,
                      newChild.children || []
                    );
                    lanes$asFiber.return = returnFiber;
                    returnFiber = lanes$asFiber;
                    break a;
                  } else {
                    deleteRemainingChildren(returnFiber, currentFirstChild);
                    break;
                  }
                else deleteChild(returnFiber, currentFirstChild);
                currentFirstChild = currentFirstChild.sibling;
              }
              lanes$asFiber = createFiberFromPortal(newChild, returnFiber.mode, lanes);
              lanes$asFiber.return = returnFiber;
              returnFiber = lanes$asFiber;
            }
            return placeSingleChild(returnFiber);
          case REACT_LAZY_TYPE:
            return (
              (newChild = resolveLazy(newChild)),
              reconcileChildFibersImpl(
                returnFiber,
                currentFirstChild,
                newChild,
                lanes
              )
            );
        }
        if (isArrayImpl(newChild))
          return reconcileChildrenArray(
            returnFiber,
            currentFirstChild,
            newChild,
            lanes
          );
        if (getIteratorFn(newChild)) {
          key$asIteratorFn = getIteratorFn(newChild);
          if ("function" !== typeof key$asIteratorFn)
            throw Error(formatProdErrorMessage(150));
          newChild$asIterator = key$asIteratorFn.call(newChild);
          return reconcileChildrenIterator(
            returnFiber,
            currentFirstChild,
            newChild$asIterator,
            lanes
          );
        }
        if ("function" === typeof newChild.then)
          return reconcileChildFibersImpl(
            returnFiber,
            currentFirstChild,
            unwrapThenable(newChild),
            lanes
          );
        if (newChild.$$typeof === REACT_CONTEXT_TYPE)
          return reconcileChildFibersImpl(
            returnFiber,
            currentFirstChild,
            readContextDuringReconciliation(returnFiber, newChild),
            lanes
          );
        throwOnInvalidObjectTypeImpl(returnFiber, newChild);
      }
      return ("string" === typeof newChild && "" !== newChild) ||
        "number" === typeof newChild ||
        "bigint" === typeof newChild
        ? ((newChild$asText = "" + newChild),
          null !== currentFirstChild && 6 === currentFirstChild.tag
            ? (deleteRemainingChildren(returnFiber, currentFirstChild.sibling),
              (lanes$asFiber = useFiber(currentFirstChild, newChild$asText)),
              (lanes$asFiber.return = returnFiber),
              (returnFiber = lanes$asFiber))
            : (deleteRemainingChildren(returnFiber, currentFirstChild),
              (lanes$asFiber = createFiberFromText(newChild$asText, returnFiber.mode, lanes)),
              (lanes$asFiber.return = returnFiber),
              (returnFiber = lanes$asFiber)),
          placeSingleChild(returnFiber))
        : deleteRemainingChildren(returnFiber, currentFirstChild);
    }
    return function (returnFiber, currentFirstChild, newChild, lanes) {
      try {
        thenableIndexCounter$1 = 0;
        var firstChildFiber = reconcileChildFibersImpl(
          returnFiber,
          currentFirstChild,
          newChild,
          lanes as RR.Lanes
        );
        thenableState$1 = null;
        return firstChildFiber;
      } catch (x) {
        if (x === SuspenseException || x === SuspenseActionException) throw x;
        var fiber = createFiber(29, x, null, returnFiber.mode);
        fiber.lanes = lanes as RR.Lanes;
        fiber.return = returnFiber;
        return fiber;
      } finally {
      }
    };
  }
  function finishQueueingConcurrentUpdates(): void {
    for (
      var endIndex = concurrentQueuesIndex,
        i = (concurrentlyUpdatedLanes = concurrentQueuesIndex = 0);
      i < endIndex;

    ) {
      var fiber: RR.Fiber = concurrentQueues[i] as RR.Fiber;
      concurrentQueues[i++] = null;
      var queue: RR.ConcurrentQueue | null = concurrentQueues[i] as RR.ConcurrentQueue | null;
      concurrentQueues[i++] = null;
      var update: RR.ConcurrentUpdate | null = concurrentQueues[i] as RR.ConcurrentUpdate | null;
      concurrentQueues[i++] = null;
      var lane: RR.Lane = concurrentQueues[i] as RR.Lane;
      concurrentQueues[i++] = null;
      if (null !== queue && null !== update) {
        var pending = queue.pending;
        null === pending
          ? (update.next = update)
          : ((update.next = pending.next), (pending.next = update));
        queue.pending = update;
      }
      0 !== lane && markUpdateLaneFromFiberToRoot(fiber, update, lane);
    }
  }
  function enqueueUpdate$1(fiber: RR.Fiber, queue: RR.ConcurrentQueue | null, update: RR.ConcurrentUpdate | null, lane: RR.Lane): void { var fiber$asAlternate: RR.Fiber | null;
    concurrentQueues[concurrentQueuesIndex++] = fiber;
    concurrentQueues[concurrentQueuesIndex++] = queue;
    concurrentQueues[concurrentQueuesIndex++] = update;
    concurrentQueues[concurrentQueuesIndex++] = lane;
    concurrentlyUpdatedLanes |= lane;
    fiber.lanes |= lane;
    fiber$asAlternate = fiber.alternate;
    null !== fiber$asAlternate && (fiber$asAlternate.lanes |= lane);
  }
  function enqueueConcurrentHookUpdate(fiber: RR.Fiber, queue: RR.HookQueue, update: RR.HookUpdate, lane: RR.Lane): RR.FiberRoot | null {
    enqueueUpdate$1(fiber, queue, update, lane);
    return getRootForUpdatedFiber(fiber);
  }
  function enqueueConcurrentRenderForLane(fiber: RR.Fiber, lane: RR.Lane): RR.FiberRoot | null {
    enqueueUpdate$1(fiber, null, null, lane);
    return getRootForUpdatedFiber(fiber);
  }
  function markUpdateLaneFromFiberToRoot(sourceFiber: RR.Fiber, update: RR.ConcurrentUpdate | null, lane: RR.Lane): RR.FiberRoot | null { var sourceFiber$asInstance: RR.OffscreenInstance | null, sourceFiber$asUpdates: RR.FiberRoot["hiddenUpdates"], parent$asRoot: RR.FiberRoot, alternate$asList: RR.ConcurrentUpdate[] | null, isHidden$asIndex: number;
    sourceFiber.lanes |= lane;
    var alternate: RR.Fiber | null = sourceFiber.alternate;
    null !== alternate && (alternate.lanes |= lane);
    for (var isHidden: boolean = !1, parent: RR.Fiber | null = sourceFiber.return; null !== parent; )
      (parent.childLanes |= lane),
        (alternate = parent.alternate),
        null !== alternate && (alternate.childLanes |= lane),
        22 === parent.tag &&
          ((sourceFiber$asInstance = parent.stateNode as RR.OffscreenInstance | null),
          null === sourceFiber$asInstance ||
            sourceFiber$asInstance._visibility & 1 ||
            (isHidden = !0)),
        (sourceFiber = parent),
        (parent = parent.return);
    return 3 === sourceFiber.tag
      ? ((parent$asRoot = sourceFiber.stateNode as RR.FiberRoot),
        isHidden &&
          null !== update &&
          ((isHidden$asIndex = 31 - clz32(lane)),
          (sourceFiber$asUpdates = parent$asRoot.hiddenUpdates),
          (alternate$asList = sourceFiber$asUpdates[isHidden$asIndex]),
          null === alternate$asList
            ? (sourceFiber$asUpdates[isHidden$asIndex] = [update])
            : alternate$asList.push(update),
          (update.lane = lane | 536870912)),
        parent$asRoot)
      : null;
  }
  function getRootForUpdatedFiber(sourceFiber: RR.Fiber): RR.FiberRoot | null {
    if (50 < nestedUpdateCount)
      throw (
        ((nestedUpdateCount = 0),
        (rootWithNestedUpdates = null),
        Error(formatProdErrorMessage(185)))
      );
    for (var parent = sourceFiber.return; null !== parent; )
      (sourceFiber = parent), (parent = sourceFiber.return);
    return 3 === sourceFiber.tag ? sourceFiber.stateNode as RR.FiberRoot : null;
  }
  function initializeUpdateQueue(fiber: RR.Fiber): void {
    fiber.updateQueue = {
      baseState: fiber.memoizedState,
      firstBaseUpdate: null,
      lastBaseUpdate: null,
      shared: { pending: null, lanes: 0, hiddenCallbacks: null },
      callbacks: null
    } as RR.UpdateQueue;
  }
  function cloneUpdateQueue(current: RR.Fiber, workInProgress: RR.Fiber): void { var current$asQueue: RR.UpdateQueue;
    current$asQueue = current.updateQueue as RR.UpdateQueue;
    workInProgress.updateQueue === current$asQueue &&
      (workInProgress.updateQueue = {
        baseState: current$asQueue.baseState,
        firstBaseUpdate: current$asQueue.firstBaseUpdate,
        lastBaseUpdate: current$asQueue.lastBaseUpdate,
        shared: current$asQueue.shared,
        callbacks: null
      } as RR.UpdateQueue);
  }
  function createUpdate(lane: RR.Lane): RR.Update {
    return { lane: lane, tag: 0, payload: null, callback: null, next: null };
  }
  function enqueueUpdate(fiber: RR.Fiber, update: RR.Update, lane: RR.Lane): RR.FiberRoot | null { var update$asRoot: RR.FiberRoot | null, updateQueue$asShared: RR.SharedQueue;
    var updateQueue: RR.UpdateQueue | null = fiber.updateQueue as RR.UpdateQueue | null;
    if (null === updateQueue) return null;
    updateQueue$asShared = updateQueue.shared;
    if (0 !== (executionContext & 2)) {
      var pending = updateQueue$asShared.pending;
      null === pending
        ? (update.next = update)
        : ((update.next = pending.next), (pending.next = update));
      updateQueue$asShared.pending = update;
      update$asRoot = getRootForUpdatedFiber(fiber);
      markUpdateLaneFromFiberToRoot(fiber, null, lane);
      return update$asRoot;
    }
    enqueueUpdate$1(fiber, updateQueue$asShared, update, lane);
    return getRootForUpdatedFiber(fiber);
  }
  function entangleTransitions(root: RR.FiberRoot, fiber: RR.Fiber, lane: RR.Lane): void { var fiber$asQueue: RR.UpdateQueue | null, fiber$asShared: RR.SharedQueue;
    fiber$asQueue = fiber.updateQueue as RR.UpdateQueue | null;
    if (null !== fiber$asQueue && ((fiber$asShared = fiber$asQueue.shared), 0 !== (lane & 4194048))) {
      var queueLanes = fiber$asShared.lanes;
      queueLanes &= root.pendingLanes;
      lane |= queueLanes;
      fiber$asShared.lanes = lane;
      markRootEntangled(root, lane);
    }
  }
  function enqueueCapturedUpdate(workInProgress: RR.Fiber, capturedUpdate: RR.Update): void { var workInProgress$asLast: RR.Update | null, queue$asUpdate: RR.Update | null, queue$asClone: RR.UpdateQueue, current$asQueue: RR.FiberUpdateQueue;
    var queue: RR.UpdateQueue = workInProgress.updateQueue as RR.UpdateQueue,
      current: RR.Fiber | null = workInProgress.alternate;
    if (
      null !== current &&
      ((current$asQueue = current.updateQueue), queue === current$asQueue)
    ) {
      var newFirst: RR.Update | null = null,
        newLast: RR.Update | null = null as RR.Update | null;
      queue$asUpdate = queue.firstBaseUpdate;
      if (null !== queue$asUpdate) {
        do {
          var clone: RR.Update = {
            lane: queue$asUpdate.lane,
            tag: queue$asUpdate.tag,
            payload: queue$asUpdate.payload,
            callback: null,
            next: null
          };
          null === newLast
            ? (newFirst = newLast = clone)
            : (newLast = newLast.next = clone);
          queue$asUpdate = queue$asUpdate.next;
        } while (null !== queue$asUpdate);
        null === newLast
          ? (newFirst = newLast = capturedUpdate)
          : (newLast = newLast.next = capturedUpdate);
      } else newFirst = newLast = capturedUpdate;
      queue$asClone = {
        baseState: current$asQueue.baseState,
        firstBaseUpdate: newFirst,
        lastBaseUpdate: newLast,
        shared: current$asQueue.shared,
        callbacks: current$asQueue.callbacks
      } as RR.UpdateQueue;
      workInProgress.updateQueue = queue$asClone;
      return;
    }
    workInProgress$asLast = queue.lastBaseUpdate;
    null === workInProgress$asLast
      ? (queue.firstBaseUpdate = capturedUpdate)
      : (workInProgress$asLast.next = capturedUpdate);
    queue.lastBaseUpdate = capturedUpdate;
  }
  function suspendIfUpdateReadFromEntangledAsyncAction(): void {
    if (didReadFromEntangledAsyncAction) {
      var entangledActionThenable = currentEntangledActionThenable;
      if (null !== entangledActionThenable) throw entangledActionThenable;
    }
  }
  function processUpdateQueue(
    workInProgress$jscomp$0: RR.Fiber,
    props: RR.Props | null,
    instance$jscomp$0: RR.ClassInstance | null,
    renderLanes: RR.Lanes
  ): void { var lastBaseUpdate$asLanes: RR.Lanes, lastPendingUpdate$asState: RR.State, current$asQueue: RR.UpdateQueue, current$asLast: RR.Update | null, isHiddenUpdate$asCallbacks: RR.UpdateCallback[] | null, isHiddenUpdate$asClone: RR.Update, isHiddenUpdate$asPending: RR.Update, workInProgress$asReplacement: RR.StateUpdater | RR.Carried, workInProgress$asPayload: RR.StateUpdater | RR.Carried, updateLane$asProps: RR.Props | null, updateLane$asPartial: RR.Carried, updateLane$asCallback: RR.UpdateCallback | null;
    didReadFromEntangledAsyncAction = !1;
    var queue: RR.UpdateQueue = workInProgress$jscomp$0.updateQueue as RR.UpdateQueue;
    hasForceUpdate = !1;
    var firstBaseUpdate: RR.Update | null = queue.firstBaseUpdate,
      lastBaseUpdate: RR.Update | null = queue.lastBaseUpdate,
      pendingQueue: RR.Update | null = queue.shared.pending;
    if (null !== pendingQueue) {
      queue.shared.pending = null;
      var lastPendingUpdate: RR.Update = pendingQueue,
        firstPendingUpdate: RR.Update | null = lastPendingUpdate.next;
      lastPendingUpdate.next = null;
      null === lastBaseUpdate
        ? (firstBaseUpdate = firstPendingUpdate)
        : (lastBaseUpdate.next = firstPendingUpdate);
      lastBaseUpdate = lastPendingUpdate;
      var current: RR.Fiber | null = workInProgress$jscomp$0.alternate;
      null !== current &&
        ((current$asQueue = current.updateQueue as RR.UpdateQueue),
        (pendingQueue = current$asQueue.lastBaseUpdate),
        pendingQueue !== lastBaseUpdate &&
          (null === pendingQueue
            ? (current$asQueue.firstBaseUpdate = firstPendingUpdate)
            : (pendingQueue.next = firstPendingUpdate),
          (current$asQueue.lastBaseUpdate = lastPendingUpdate)));
    }
    if (null !== firstBaseUpdate) {
      var newState: RR.State = queue.baseState;
      lastBaseUpdate$asLanes = 0;
      current$asLast = (firstPendingUpdate = lastPendingUpdate$asState = null) as RR.Update | null;
      pendingQueue = firstBaseUpdate;
      do {
        var updateLane: RR.Lane = pendingQueue.lane & -536870913,
          isHiddenUpdate: boolean = updateLane !== pendingQueue.lane;
        if (
          isHiddenUpdate
            ? (workInProgressRootRenderLanes & updateLane) === updateLane
            : (renderLanes & updateLane) === updateLane
        ) {
          0 !== updateLane &&
            updateLane === currentEntangledLane &&
            (didReadFromEntangledAsyncAction = !0);
          null !== current$asLast &&
            (current$asLast = current$asLast.next =
              {
                lane: 0,
                tag: pendingQueue.tag,
                payload: pendingQueue.payload,
                callback: null,
                next: null
              });
          a: {
            var workInProgress: RR.Fiber = workInProgress$jscomp$0,
              update: RR.Update = pendingQueue;
            updateLane$asProps = props;
            var instance: RR.ClassInstance | null = instance$jscomp$0;
            switch (update.tag) {
              case 1:
                workInProgress$asReplacement = update.payload;
                if ("function" === typeof workInProgress$asReplacement) {
                  newState = workInProgress$asReplacement.call(
                    instance,
                    newState,
                    updateLane$asProps
                  );
                  break a;
                }
                newState = workInProgress$asReplacement as RR.State;
                break a;
              case 3:
                workInProgress.flags = (workInProgress.flags & -65537) | 128;
              case 0:
                workInProgress$asPayload = update.payload;
                updateLane$asPartial =
                  "function" === typeof workInProgress$asPayload
                    ? workInProgress$asPayload.call(instance, newState, updateLane$asProps)
                    : workInProgress$asPayload;
                if (null === updateLane$asPartial || void 0 === updateLane$asPartial) break a;
                newState = assign({}, newState, updateLane$asPartial);
                break a;
              case 2:
                hasForceUpdate = !0;
            }
          }
          updateLane$asCallback = pendingQueue.callback;
          null !== updateLane$asCallback &&
            ((workInProgress$jscomp$0.flags |= 64),
            isHiddenUpdate && (workInProgress$jscomp$0.flags |= 8192),
            (isHiddenUpdate$asCallbacks = queue.callbacks),
            null === isHiddenUpdate$asCallbacks
              ? (queue.callbacks = [updateLane$asCallback])
              : isHiddenUpdate$asCallbacks.push(updateLane$asCallback));
        } else
          (isHiddenUpdate$asClone = {
            lane: updateLane,
            tag: pendingQueue.tag,
            payload: pendingQueue.payload,
            callback: pendingQueue.callback,
            next: null
          } as RR.Update),
            null === current$asLast
              ? ((firstPendingUpdate = current$asLast = isHiddenUpdate$asClone),
                (lastPendingUpdate$asState = newState))
              : (current$asLast = current$asLast.next = isHiddenUpdate$asClone),
            (lastBaseUpdate$asLanes |= updateLane);
        pendingQueue = pendingQueue.next;
        if (null === pendingQueue)
          if (((pendingQueue = queue.shared.pending), null === pendingQueue))
            break;
          else
            (isHiddenUpdate$asPending = pendingQueue),
              (pendingQueue = isHiddenUpdate$asPending.next!),
              (isHiddenUpdate$asPending.next = null),
              (queue.lastBaseUpdate = isHiddenUpdate$asPending),
              (queue.shared.pending = null);
      } while (1);
      null === current$asLast && (lastPendingUpdate$asState = newState);
      queue.baseState = lastPendingUpdate$asState;
      queue.firstBaseUpdate = firstPendingUpdate;
      queue.lastBaseUpdate = current$asLast;
      null === firstBaseUpdate && (queue.shared.lanes = 0);
      workInProgressRootSkippedLanes |= lastBaseUpdate$asLanes;
      workInProgress$jscomp$0.lanes = lastBaseUpdate$asLanes;
      workInProgress$jscomp$0.memoizedState = newState;
    }
  }
  function callCallback(callback: RR.UpdateCallback, context: RR.StateNode): void {
    if ("function" !== typeof callback)
      throw Error(formatProdErrorMessage(191, callback));
    callback.call(context);
  }
  function commitCallbacks(updateQueue: RR.UpdateQueue, context: RR.StateNode): void { var updateQueue$asIndex: number;
    var callbacks = updateQueue.callbacks;
    if (null !== callbacks)
      for (
        updateQueue.callbacks = null, updateQueue$asIndex = 0;
        updateQueue$asIndex < callbacks.length;
        updateQueue$asIndex++
      )
        callCallback(callbacks[updateQueue$asIndex], context);
  }
  function pushHiddenContext(fiber: RR.Fiber, context: RR.HiddenContext): void { var fiber$asLanes: RR.Lanes;
    fiber$asLanes = entangledRenderLanes;
    push(prevEntangledRenderLanesCursor, fiber$asLanes);
    push(currentTreeHiddenStackCursor, context);
    entangledRenderLanes = fiber$asLanes | context.baseLanes;
  }
  function reuseHiddenContextOnStack(): void {
    push(prevEntangledRenderLanesCursor, entangledRenderLanes);
    push(currentTreeHiddenStackCursor, currentTreeHiddenStackCursor.current);
  }
  function popHiddenContext(): void {
    entangledRenderLanes = prevEntangledRenderLanesCursor.current as RR.Lanes;
    pop(currentTreeHiddenStackCursor);
    pop(prevEntangledRenderLanesCursor);
  }
  function pushPrimaryTreeSuspenseHandler(handler: RR.Fiber): void {
    var current = handler.alternate;
    push(suspenseStackCursor, suspenseStackCursor.current & 1);
    push(suspenseHandlerStackCursor, handler);
    null === shellBoundary &&
      (null === current || null !== currentTreeHiddenStackCursor.current
        ? (shellBoundary = handler)
        : null !== current.memoizedState && (shellBoundary = handler));
  }
  function pushDehydratedActivitySuspenseHandler(fiber: RR.Fiber): void {
    push(suspenseStackCursor, suspenseStackCursor.current);
    push(suspenseHandlerStackCursor, fiber);
    null === shellBoundary && (shellBoundary = fiber);
  }
  function pushOffscreenSuspenseHandler(fiber: RR.Fiber): void {
    22 === fiber.tag
      ? (push(suspenseStackCursor, suspenseStackCursor.current),
        push(suspenseHandlerStackCursor, fiber),
        null === shellBoundary && (shellBoundary = fiber))
      : reuseSuspenseHandlerOnStack(fiber);
  }
  function reuseSuspenseHandlerOnStack(fiber?: RR.Fiber): void; function reuseSuspenseHandlerOnStack(): void {
    push(suspenseStackCursor, suspenseStackCursor.current);
    push(suspenseHandlerStackCursor, suspenseHandlerStackCursor.current);
  }
  function popSuspenseHandler(fiber: RR.Fiber): void {
    pop(suspenseHandlerStackCursor);
    shellBoundary === fiber && (shellBoundary = null);
    pop(suspenseStackCursor);
  }
  function findFirstSuspended(row: RR.Fiber): RR.Fiber | null { var state$asInstance: RR.SuspenseInstance | null;
    for (var node = row; null !== node; ) {
      if (13 === node.tag) {
        var state: RR.SuspenseState | null = node.memoizedState as RR.SuspenseState | null;
        if (
          null !== state &&
          ((state$asInstance = state.dehydrated),
          null === state$asInstance ||
            isSuspenseInstancePending!(state$asInstance) ||
            isSuspenseInstanceFallback!(state$asInstance))
        )
          return node;
      } else if (
        19 === node.tag &&
        ("forwards" === node.memoizedProps.revealOrder ||
          "backwards" === node.memoizedProps.revealOrder ||
          "unstable_legacy-backwards" === node.memoizedProps.revealOrder ||
          "together" === node.memoizedProps.revealOrder)
      ) {
        if (0 !== (node.flags & 128)) return node;
      } else if (null !== node.child) {
        node.child.return = node;
        node = node.child;
        continue;
      }
      if (node === row) break;
      for (; null === node.sibling; ) {
        if (null === node.return || node.return === row) return null;
        node = node.return;
      }
      node.sibling.return = node.return;
      node = node.sibling;
    }
    return null;
  }
  function throwInvalidHookError(): never {
    throw Error(formatProdErrorMessage(321));
  }
  function areHookInputsEqual(nextDeps: RR.HookDeps, prevDeps: RR.HookDeps | null): boolean {
    if (null === prevDeps) return !1;
    for (var i = 0; i < prevDeps.length && i < nextDeps.length; i++)
      if (!objectIs(nextDeps[i], prevDeps[i])) return !1;
    return !0;
  }
  function renderWithHooks(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    Component: RR.FunctionComponent,
    props: RR.Props | null,
    secondArg: RR.Ref | undefined,
    nextRenderLanes: RR.Lanes
  ): RR.ReactNode { var nextRenderLanes$asChildren: RR.ReactNode;
    renderLanes = nextRenderLanes;
    currentlyRenderingFiber = workInProgress;
    workInProgress.memoizedState = null;
    workInProgress.updateQueue = null;
    workInProgress.lanes = 0;
    ReactSharedInternals.H =
      null === current || null === current.memoizedState
        ? HooksDispatcherOnMount
        : HooksDispatcherOnUpdate;
    shouldDoubleInvokeUserFnsInHooksDEV = !1;
    nextRenderLanes$asChildren = Component(props, secondArg);
    shouldDoubleInvokeUserFnsInHooksDEV = !1;
    didScheduleRenderPhaseUpdateDuringThisPass &&
      (nextRenderLanes$asChildren = renderWithHooksAgain(
        workInProgress,
        Component,
        props,
        secondArg
      ));
    finishRenderingHooks(current);
    return nextRenderLanes$asChildren;
  }
  function finishRenderingHooks(current: RR.Fiber | null): void { var current$asDependencies: RR.Dependencies | null;
    ReactSharedInternals.H = ContextOnlyDispatcher;
    var didRenderTooFewHooks =
      null !== currentHook && null !== currentHook.next;
    renderLanes = 0;
    workInProgressHook = currentHook = currentlyRenderingFiber = null;
    didScheduleRenderPhaseUpdate = !1;
    thenableIndexCounter = 0;
    thenableState = null;
    if (didRenderTooFewHooks) throw Error(formatProdErrorMessage(300));
    null === current ||
      didReceiveUpdate ||
      ((current$asDependencies = current.dependencies),
      null !== current$asDependencies &&
        checkIfContextChanged(current$asDependencies) &&
        (didReceiveUpdate = !0));
  }
  function renderWithHooksAgain(workInProgress: RR.Fiber, Component: RR.FunctionComponent, props: RR.Props | null, secondArg: RR.Ref | undefined): RR.ReactNode { var children$asNode: RR.ReactNode;
    currentlyRenderingFiber = workInProgress;
    var numberOfReRenders = 0;
    do {
      didScheduleRenderPhaseUpdateDuringThisPass && (thenableState = null);
      thenableIndexCounter = 0;
      didScheduleRenderPhaseUpdateDuringThisPass = !1;
      if (25 <= numberOfReRenders) throw Error(formatProdErrorMessage(301));
      numberOfReRenders += 1;
      workInProgressHook = currentHook = null;
      if (null != workInProgress.updateQueue) {
        var children: RR.FunctionComponentUpdateQueue = workInProgress.updateQueue as RR.FunctionComponentUpdateQueue;
        children.lastEffect = null;
        children.events = null;
        children.stores = null;
        null != children.memoCache && (children.memoCache.index = 0);
      }
      ReactSharedInternals.H = HooksDispatcherOnRerender;
      children$asNode = Component(props, secondArg);
    } while (didScheduleRenderPhaseUpdateDuringThisPass);
    return children$asNode;
  }
  function TransitionAwareHostComponent(): RR.TransitionStatus { var dispatcher$asState: RR.HookState;
    var dispatcher: RR.Dispatcher | null = ReactSharedInternals.H,
      maybeThenable = dispatcher!.useState()[0];
    maybeThenable =
      "function" === typeof maybeThenable.then
        ? useThenable(maybeThenable)
        : maybeThenable;
    dispatcher$asState = dispatcher!.useState()[0];
    (null !== currentHook ? currentHook.memoizedState : null) !== dispatcher$asState &&
      (currentlyRenderingFiber!.flags |= 1024);
    return maybeThenable;
  }
  function checkDidRenderIdHook(): boolean {
    var didRenderIdHook = 0 !== localIdCounter;
    localIdCounter = 0;
    return didRenderIdHook;
  }
  function bailoutHooks(current: RR.Fiber, workInProgress: RR.Fiber, lanes: RR.Lanes): void {
    workInProgress.updateQueue = current.updateQueue;
    workInProgress.flags &= -2053;
    current.lanes &= ~lanes;
  }
  function resetHooksOnUnwind(workInProgress: RR.Fiber): void { var workInProgress$asHook: RR.Hook | null;
    if (didScheduleRenderPhaseUpdate) {
      for (
        workInProgress$asHook = workInProgress.memoizedState as RR.Hook | null;
        null !== workInProgress$asHook;

      ) {
        var queue = workInProgress$asHook.queue;
        null !== queue && (queue.pending = null);
        workInProgress$asHook = workInProgress$asHook.next;
      }
      didScheduleRenderPhaseUpdate = !1;
    }
    renderLanes = 0;
    workInProgressHook = currentHook = currentlyRenderingFiber = null;
    didScheduleRenderPhaseUpdateDuringThisPass = !1;
    thenableIndexCounter = localIdCounter = 0;
    thenableState = null;
  }
  function mountWorkInProgressHook(): RR.Hook {
    var hook: RR.Hook = {
      memoizedState: null,
      baseState: null,
      baseQueue: null,
      queue: null,
      next: null
    };
    null === workInProgressHook
      ? (currentlyRenderingFiber!.memoizedState = workInProgressHook = hook)
      : (workInProgressHook = workInProgressHook.next = hook);
    return workInProgressHook;
  }
  function updateWorkInProgressHook(): RR.Hook { var nextCurrentHook$asHook: RR.Hook | null, nextCurrentHook$asNewHook: RR.Hook;
    if (null === currentHook) {
      var nextCurrentHook: RR.Fiber | null = currentlyRenderingFiber!.alternate;
      nextCurrentHook$asHook =
        null !== nextCurrentHook ? nextCurrentHook.memoizedState as RR.Hook | null : null;
    } else nextCurrentHook$asHook = currentHook.next;
    var nextWorkInProgressHook: RR.Hook | null =
      null === workInProgressHook
        ? currentlyRenderingFiber!.memoizedState as RR.Hook | null
        : workInProgressHook.next;
    if (null !== nextWorkInProgressHook)
      (workInProgressHook = nextWorkInProgressHook),
        (currentHook = nextCurrentHook$asHook);
    else {
      if (null === nextCurrentHook$asHook) {
        if (null === currentlyRenderingFiber!.alternate)
          throw Error(formatProdErrorMessage(467));
        throw Error(formatProdErrorMessage(310));
      }
      currentHook = nextCurrentHook$asHook;
      nextCurrentHook$asNewHook = {
        memoizedState: currentHook.memoizedState,
        baseState: currentHook.baseState,
        baseQueue: currentHook.baseQueue,
        queue: currentHook.queue,
        next: null
      };
      null === workInProgressHook
        ? (currentlyRenderingFiber!.memoizedState = workInProgressHook =
            nextCurrentHook$asNewHook)
        : (workInProgressHook = workInProgressHook.next = nextCurrentHook$asNewHook);
    }
    return workInProgressHook;
  }
  function createFunctionComponentUpdateQueue(): RR.FunctionComponentUpdateQueue {
    return { lastEffect: null, events: null, stores: null, memoCache: null };
  }
  function useThenable(thenable: RR.Thenable): RR.UsedValue { var thenable$asValue: RR.UsedValue, index$asFiber: RR.Fiber | null, index$asAlternate: RR.Fiber | null;
    var index: number = thenableIndexCounter;
    thenableIndexCounter += 1;
    null === thenableState && (thenableState = []);
    thenable$asValue = trackUsedThenable(thenableState, thenable, index);
    index$asFiber = currentlyRenderingFiber;
    null ===
      (null === workInProgressHook
        ? index$asFiber!.memoizedState
        : workInProgressHook.next) &&
      ((index$asAlternate = index$asFiber!.alternate),
      (ReactSharedInternals.H =
        null === index$asAlternate || null === index$asAlternate.memoizedState
          ? HooksDispatcherOnMount
          : HooksDispatcherOnUpdate));
    return thenable$asValue;
  }
  function use(usable: RR.UsableGiven): RR.UsedValue {
    if (null !== usable && "object" === typeof usable) {
      if ("function" === typeof usable.then) return useThenable(usable as RR.UsableThenable);
      if (usable.$$typeof === REACT_CONTEXT_TYPE) return readContext(usable as RR.UsableContext);
    }
    throw Error(formatProdErrorMessage(438, String(usable)));
  }
  function useMemoCache(size: number): any[] { var updateQueue$asData: any[] | undefined, current$asQueue: RR.FunctionComponentUpdateQueue | null, current$asCache: RR.MemoCache | null, current$asIndex: number;
    var memoCache: RR.MemoCache | null = null,
      updateQueue: RR.FunctionComponentUpdateQueue | null = currentlyRenderingFiber!.updateQueue as RR.FunctionComponentUpdateQueue | null;
    null !== updateQueue && (memoCache = updateQueue.memoCache);
    if (null == memoCache) {
      var current: RR.Fiber | null = currentlyRenderingFiber!.alternate;
      null !== current &&
        ((current$asQueue = current.updateQueue as RR.FunctionComponentUpdateQueue | null),
        null !== current$asQueue &&
          ((current$asCache = current$asQueue.memoCache),
          null != current$asCache &&
            (memoCache = {
              data: current$asCache.data.map(function (array) {
                return array.slice();
              }),
              index: 0
            })));
    }
    null == memoCache && (memoCache = { data: [], index: 0 });
    null === updateQueue &&
      ((updateQueue = createFunctionComponentUpdateQueue()),
      (currentlyRenderingFiber!.updateQueue = updateQueue));
    updateQueue.memoCache = memoCache;
    updateQueue$asData = memoCache.data[memoCache.index];
    if (void 0 === updateQueue$asData)
      for (
        updateQueue$asData = memoCache.data[memoCache.index] = Array(size),
          current$asIndex = 0;
        current$asIndex < size;
        current$asIndex++
      )
        updateQueue$asData[current$asIndex] = REACT_MEMO_CACHE_SENTINEL;
    memoCache.index++;
    return updateQueue$asData;
  }
  function basicStateReducer(state: RR.HookState, action: RR.HookState): RR.HookState {
    return "function" === typeof action ? action(state) : action;
  }
  function updateReducer(reducer: RR.Reducer): RR.DispatchTuple {
    var hook = updateWorkInProgressHook();
    return updateReducerImpl(hook, currentHook!, reducer);
  }
  function updateReducerImpl(hook: RR.Hook, current: RR.Hook, reducer$given: RR.Reducer): RR.DispatchTuple { var reducer; reducer = reducer$given; var current$asFirst: RR.HookUpdate, pendingQueue$asState: RR.HookState, baseFirst$asBaseState: RR.HookState, updateLane$asClone: RR.HookUpdate, updateLane$asAction: RR.HookState, revertLane$asClone: RR.HookUpdate;
    var queue = hook.queue as RR.HookQueue | null;
    if (null === queue) throw Error(formatProdErrorMessage(311));
    queue.lastRenderedReducer = reducer;
    var baseQueue = hook.baseQueue,
      pendingQueue: RR.HookUpdate | null = queue.pending;
    if (null !== pendingQueue) {
      if (null !== baseQueue) {
        var baseFirst: RR.HookUpdate | null = baseQueue.next;
        baseQueue.next = pendingQueue.next;
        pendingQueue.next = baseFirst;
      }
      current.baseQueue = baseQueue = pendingQueue;
      queue.pending = null;
    }
    pendingQueue$asState = hook.baseState;
    if (null === baseQueue) hook.memoizedState = pendingQueue$asState;
    else {
      current$asFirst = baseQueue.next!;
      var newBaseQueueFirst: RR.HookUpdate | null = (baseFirst$asBaseState = null),
        newBaseQueueLast: RR.HookUpdate | null = null as RR.HookUpdate | null,
        update: RR.HookUpdate | null = current$asFirst,
        didReadFromEntangledAsyncAction$51 = !1;
      do {
        var updateLane: RR.Lane = update.lane & -536870913;
        if (
          updateLane !== update.lane
            ? (workInProgressRootRenderLanes & updateLane) === updateLane
            : (renderLanes & updateLane) === updateLane
        ) {
          var revertLane: RR.Lane = update.revertLane;
          if (0 === revertLane)
            null !== newBaseQueueLast &&
              (newBaseQueueLast = newBaseQueueLast.next =
                {
                  lane: 0,
                  revertLane: 0,
                  gesture: null,
                  action: update.action,
                  hasEagerState: update.hasEagerState,
                  eagerState: update.eagerState,
                  next: null
                }),
              updateLane === currentEntangledLane &&
                (didReadFromEntangledAsyncAction$51 = !0);
          else if ((renderLanes & revertLane) === revertLane) {
            update = update.next;
            revertLane === currentEntangledLane &&
              (didReadFromEntangledAsyncAction$51 = !0);
            continue;
          } else
            (updateLane$asClone = {
              lane: 0,
              revertLane: update.revertLane,
              gesture: null,
              action: update.action,
              hasEagerState: update.hasEagerState,
              eagerState: update.eagerState,
              next: null
            } as RR.HookUpdate),
              null === newBaseQueueLast
                ? ((newBaseQueueFirst = newBaseQueueLast = updateLane$asClone),
                  (baseFirst$asBaseState = pendingQueue$asState))
                : (newBaseQueueLast = newBaseQueueLast.next = updateLane$asClone),
              (currentlyRenderingFiber!.lanes |= revertLane),
              (workInProgressRootSkippedLanes |= revertLane);
          updateLane$asAction = update.action;
          shouldDoubleInvokeUserFnsInHooksDEV &&
            reducer(pendingQueue$asState, updateLane$asAction);
          pendingQueue$asState = update.hasEagerState
            ? update.eagerState
            : reducer(pendingQueue$asState, updateLane$asAction);
        } else
          (revertLane$asClone = {
            lane: updateLane,
            revertLane: update.revertLane,
            gesture: update.gesture,
            action: update.action,
            hasEagerState: update.hasEagerState,
            eagerState: update.eagerState,
            next: null
          }),
            null === newBaseQueueLast
              ? ((newBaseQueueFirst = newBaseQueueLast = revertLane$asClone),
                (baseFirst$asBaseState = pendingQueue$asState))
              : (newBaseQueueLast = newBaseQueueLast.next = revertLane$asClone),
            (currentlyRenderingFiber!.lanes |= updateLane),
            (workInProgressRootSkippedLanes |= updateLane);
        update = update.next;
      } while (null !== update && update !== current$asFirst);
      null === newBaseQueueLast
        ? (baseFirst$asBaseState = pendingQueue$asState)
        : (newBaseQueueLast.next = newBaseQueueFirst);
      if (
        !objectIs(pendingQueue$asState, hook.memoizedState) &&
        ((didReceiveUpdate = !0),
        didReadFromEntangledAsyncAction$51 &&
          ((reducer = currentEntangledActionThenable), null !== reducer))
      )
        throw reducer;
      hook.memoizedState = pendingQueue$asState;
      hook.baseState = baseFirst$asBaseState;
      hook.baseQueue = newBaseQueueLast;
      queue.lastRenderedState = pendingQueue$asState;
    }
    null === baseQueue && (queue.lanes = 0);
    return [hook.memoizedState, queue.dispatch];
  }
  function rerenderReducer(reducer: RR.Reducer): RR.DispatchTuple {
    var hook = updateWorkInProgressHook(),
      queue = hook.queue as RR.HookQueue | null;
    if (null === queue) throw Error(formatProdErrorMessage(311));
    queue.lastRenderedReducer = reducer;
    var dispatch = queue.dispatch,
      lastRenderPhaseUpdate = queue.pending,
      newState = hook.memoizedState;
    if (null !== lastRenderPhaseUpdate) {
      queue.pending = null;
      var update = (lastRenderPhaseUpdate = lastRenderPhaseUpdate.next);
      do (newState = reducer(newState, update!.action)), (update = update!.next);
      while (update !== lastRenderPhaseUpdate);
      objectIs(newState, hook.memoizedState) || (didReceiveUpdate = !0);
      hook.memoizedState = newState;
      null === hook.baseQueue && (hook.baseState = newState);
      queue.lastRenderedState = newState;
    }
    return [newState, dispatch];
  }
  function updateSyncExternalStore(subscribe: RR.StoreSubscribe, getSnapshot: RR.GetSnapshot, getServerSnapshot?: RR.GetSnapshot): RR.HookState { var getServerSnapshot$asSnapshot: RR.HookState, hook$asInstance: RR.StoreInstance;
    var fiber = currentlyRenderingFiber!,
      hook: RR.Hook = updateWorkInProgressHook(),
      isHydrating$jscomp$0 = isHydrating;
    if (isHydrating$jscomp$0) {
      if (void 0 === getServerSnapshot)
        throw Error(formatProdErrorMessage(407));
      getServerSnapshot$asSnapshot = getServerSnapshot();
    } else getServerSnapshot$asSnapshot = getSnapshot();
    var snapshotChanged = !objectIs(
      (currentHook || hook).memoizedState,
      getServerSnapshot$asSnapshot
    );
    snapshotChanged &&
      ((hook.memoizedState = getServerSnapshot$asSnapshot), (didReceiveUpdate = !0));
    hook$asInstance = hook.queue as RR.StoreInstance;
    updateEffect(subscribeToStore.bind(null, fiber, hook$asInstance, subscribe), [
      subscribe
    ]);
    if (
      hook$asInstance.getSnapshot !== getSnapshot ||
      snapshotChanged ||
      (null !== workInProgressHook && workInProgressHook.memoizedState.tag & 1)
    ) {
      fiber.flags |= 2048;
      pushSimpleEffect(
        9,
        { destroy: void 0 },
        updateStoreInstance.bind(
          null,
          fiber,
          hook$asInstance,
          getServerSnapshot$asSnapshot,
          getSnapshot
        ),
        null
      );
      if (null === workInProgressRoot) throw Error(formatProdErrorMessage(349));
      isHydrating$jscomp$0 ||
        0 !== (renderLanes & 127) ||
        pushStoreConsistencyCheck(fiber, getSnapshot, getServerSnapshot$asSnapshot);
    }
    return getServerSnapshot$asSnapshot;
  }
  function pushStoreConsistencyCheck(fiber: RR.Fiber, getSnapshot: RR.GetSnapshot, renderedSnapshot: RR.HookState): void { var fiber$asCheck: RR.StoreConsistencyCheck, getSnapshot$asQueue: RR.FunctionComponentUpdateQueue | null, getSnapshot$asNewQueue: RR.FunctionComponentUpdateQueue, renderedSnapshot$asStores: RR.StoreConsistencyCheck[] | null;
    fiber.flags |= 16384;
    fiber$asCheck = { getSnapshot: getSnapshot, value: renderedSnapshot } as RR.StoreConsistencyCheck;
    getSnapshot$asQueue = currentlyRenderingFiber!.updateQueue as RR.FunctionComponentUpdateQueue | null;
    null === getSnapshot$asQueue
      ? ((getSnapshot$asNewQueue = createFunctionComponentUpdateQueue()),
        (currentlyRenderingFiber!.updateQueue = getSnapshot$asNewQueue),
        (getSnapshot$asNewQueue.stores = [fiber$asCheck]))
      : ((renderedSnapshot$asStores = getSnapshot$asQueue.stores),
        null === renderedSnapshot$asStores
          ? (getSnapshot$asQueue.stores = [fiber$asCheck])
          : renderedSnapshot$asStores.push(fiber$asCheck));
  }
  function updateStoreInstance(fiber: RR.Fiber, inst: RR.StoreInstance, nextSnapshot: RR.HookState, getSnapshot: RR.GetSnapshot): void {
    inst.value = nextSnapshot;
    inst.getSnapshot = getSnapshot;
    checkIfSnapshotChanged(inst) && forceStoreRerender(fiber);
  }
  function subscribeToStore(fiber: RR.Fiber, inst: RR.StoreInstance, subscribe: RR.StoreSubscribe): () => void {
    return subscribe(function () {
      checkIfSnapshotChanged(inst) && forceStoreRerender(fiber);
    });
  }
  function checkIfSnapshotChanged(inst: RR.StoreInstance): boolean { var inst$asValue: RR.HookState;
    var latestGetSnapshot = inst.getSnapshot;
    inst$asValue = inst.value;
    try {
      var nextValue = latestGetSnapshot();
      return !objectIs(inst$asValue, nextValue);
    } catch (error) {
      return !0;
    }
  }
  function forceStoreRerender(fiber: RR.Fiber): void {
    var root = enqueueConcurrentRenderForLane(fiber, 2);
    null !== root && scheduleUpdateOnFiber(root, fiber, 2);
  }
  function mountStateImpl(initialState: RR.HookState): RR.Hook {
    var hook = mountWorkInProgressHook();
    if ("function" === typeof initialState) {
      var initialStateInitializer = initialState;
      initialState = initialStateInitializer();
      if (shouldDoubleInvokeUserFnsInHooksDEV) {
        setIsStrictModeForDevtools(!0);
        try {
          initialStateInitializer();
        } finally {
          setIsStrictModeForDevtools(!1);
        }
      }
    }
    hook.memoizedState = hook.baseState = initialState;
    hook.queue = {
      pending: null,
      lanes: 0,
      dispatch: null,
      lastRenderedReducer: basicStateReducer,
      lastRenderedState: initialState
    } as RR.HookQueue;
    return hook;
  }
  function updateOptimisticImpl(hook: RR.Hook, current: RR.Hook | null, passthrough: RR.HookState, reducer: RR.Reducer | null | undefined): RR.DispatchTuple {
    hook.baseState = passthrough;
    return updateReducerImpl(
      hook,
      currentHook!,
      "function" === typeof reducer ? reducer : basicStateReducer
    );
  }
  function dispatchActionState(
    fiber: RR.Fiber,
    actionQueue: RR.ActionStateQueue,
    setPendingState: RR.Dispatch,
    setState: RR.Dispatch,
    payload: RR.ActionPayload
  ): void { var fiber$asAction: RR.ActionFn | null, setPendingState$asLast: RR.ActionStateQueueNode | null;
    if (isRenderPhaseUpdate(fiber)) throw Error(formatProdErrorMessage(485));
    fiber$asAction = actionQueue.action;
    if (null !== fiber$asAction) {
      var actionNode: RR.ActionStateQueueNode = {
        payload: payload,
        action: fiber$asAction,
        next: null,
        isTransition: !0,
        status: "pending",
        value: null,
        reason: null,
        listeners: [],
        then: function (listener) {
          actionNode.listeners.push(listener);
        }
      };
      null !== ReactSharedInternals.T
        ? setPendingState(!0)
        : (actionNode.isTransition = !1);
      setState(actionNode);
      setPendingState$asLast = actionQueue.pending;
      null === setPendingState$asLast
        ? ((actionNode.next = actionQueue.pending = actionNode),
          runActionStateAction(actionQueue, actionNode))
        : ((actionNode.next = setPendingState$asLast.next),
          (actionQueue.pending = setPendingState$asLast.next = actionNode));
    }
  }
  function runActionStateAction(actionQueue: RR.ActionStateQueue, node: RR.ActionStateQueueNode): void { var prevTransition$asReturnValue: RR.HookState;
    var action = node.action,
      payload = node.payload,
      prevState = actionQueue.state;
    if (node.isTransition) {
      var prevTransition: RR.Transition | null = ReactSharedInternals.T,
        currentTransition: RR.Transition = {};
      ReactSharedInternals.T = currentTransition;
      try {
        var returnValue = action(prevState, payload),
          onStartTransitionFinish = ReactSharedInternals.S;
        null !== onStartTransitionFinish &&
          onStartTransitionFinish(currentTransition, returnValue);
        handleActionReturnValue(actionQueue, node, returnValue);
      } catch (error) {
        onActionError(actionQueue, node, error);
      } finally {
        null !== prevTransition &&
          null !== currentTransition.types &&
          (prevTransition.types = currentTransition.types),
          (ReactSharedInternals.T = prevTransition);
      }
    } else
      try {
        (prevTransition$asReturnValue = action(prevState, payload)),
          handleActionReturnValue(actionQueue, node, prevTransition$asReturnValue);
      } catch (error$55) {
        onActionError(actionQueue, node, error$55);
      }
  }
  function handleActionReturnValue(actionQueue: RR.ActionStateQueue, node: RR.ActionStateQueueNode, returnValue: RR.HookState): void {
    null !== returnValue &&
    "object" === typeof returnValue &&
    "function" === typeof returnValue.then
      ? returnValue.then(
          function (nextState: RR.HookState) {
            onActionSuccess(actionQueue, node, nextState);
          },
          function (error: RR.Thrown) {
            return onActionError(actionQueue, node, error);
          }
        )
      : onActionSuccess(actionQueue, node, returnValue);
  }
  function onActionSuccess(actionQueue: RR.ActionStateQueue, actionNode: RR.ActionStateQueueNode, nextState: RR.HookState): void { var actionNode$asLast: RR.ActionStateQueueNode | null, nextState$asFirst: RR.ActionStateQueueNode | null, nextState$asNext: RR.ActionStateQueueNode | null;
    actionNode.status = "fulfilled";
    actionNode.value = nextState;
    notifyActionListeners(actionNode);
    actionQueue.state = nextState;
    actionNode$asLast = actionQueue.pending;
    null !== actionNode$asLast &&
      ((nextState$asFirst = actionNode$asLast.next),
      nextState$asFirst === actionNode$asLast
        ? (actionQueue.pending = null)
        : ((nextState$asNext = nextState$asFirst!.next),
          (actionNode$asLast.next = nextState$asNext),
          runActionStateAction(actionQueue, nextState$asNext!)));
  }
  function onActionError(actionQueue: RR.ActionStateQueue, actionNode: RR.ActionStateQueueNode, error: RR.Thrown): void {
    var last = actionQueue.pending;
    actionQueue.pending = null;
    if (null !== last) {
      last = last.next;
      do
        (actionNode.status = "rejected"),
          (actionNode.reason = error),
          notifyActionListeners(actionNode),
          (actionNode = actionNode.next!);
      while (actionNode !== last);
    }
    actionQueue.action = null;
  }
  function notifyActionListeners(actionNode: RR.ActionStateQueueNode): void { var actionNode$asListeners: RR.ActionStateQueueNode["listeners"];
    actionNode$asListeners = actionNode.listeners;
    for (var i = 0; i < actionNode$asListeners.length; i++) (0, actionNode$asListeners[i])();
  }
  function actionStateReducer<S>(oldState: S, newState: S): S {
    return newState;
  }
  function mountActionState(action: RR.ActionFn, initialStateProp: RR.HookState): RR.ActionStateTuple { var JSCompiler_inline_result$asMatches: boolean, JSCompiler_inline_result$asStateQueue: RR.HookQueue, JSCompiler_inline_result$asPendingHook: RR.Hook, JSCompiler_inline_result$asActionHook: RR.Hook, ssrFormState$asStateHook: RR.Hook, ssrFormState$asSetState: RR.Dispatch, ssrFormState$asDispatch: RR.Dispatch, markerInstance$asActionQueue: RR.ActionStateQueue;
    if (isHydrating) {
      var ssrFormState: RR.ReactFormState | null = workInProgressRoot!.formState;
      if (null !== ssrFormState) {
        a: {
          var JSCompiler_inline_result: RR.Fiber | null = currentlyRenderingFiber;
          if (isHydrating) {
            if (nextHydratableInstance) {
              var markerInstance: RR.HydratableInstance | null = canHydrateFormStateMarker!(
                nextHydratableInstance,
                rootOrSingletonContext
              );
              if (markerInstance) {
                nextHydratableInstance =
                  getNextHydratableSibling!(markerInstance);
                JSCompiler_inline_result$asMatches =
                  isFormStateMarkerMatching!(markerInstance);
                break a;
              }
            }
            throwOnHydrationMismatch(JSCompiler_inline_result!);
          }
          JSCompiler_inline_result$asMatches = !1;
        }
        JSCompiler_inline_result$asMatches && (initialStateProp = ssrFormState[0]);
      }
    }
    ssrFormState$asStateHook = mountWorkInProgressHook();
    ssrFormState$asStateHook.memoizedState = ssrFormState$asStateHook.baseState = initialStateProp;
    JSCompiler_inline_result$asStateQueue = {
      pending: null,
      lanes: 0,
      dispatch: null,
      lastRenderedReducer: actionStateReducer,
      lastRenderedState: initialStateProp
    };
    ssrFormState$asStateHook.queue = JSCompiler_inline_result$asStateQueue;
    ssrFormState$asSetState = dispatchSetState.bind(
      null,
      currentlyRenderingFiber!,
      JSCompiler_inline_result$asStateQueue
    );
    JSCompiler_inline_result$asStateQueue.dispatch = ssrFormState$asSetState;
    JSCompiler_inline_result$asPendingHook = mountStateImpl(!1);
    var setPendingState: RR.Dispatch = dispatchOptimisticSetState.bind(
      null,
      currentlyRenderingFiber!,
      !1,
      JSCompiler_inline_result$asPendingHook.queue as RR.HookQueue
    );
    JSCompiler_inline_result$asActionHook = mountWorkInProgressHook();
    markerInstance$asActionQueue = {
      state: initialStateProp,
      dispatch: null,
      action: action,
      pending: null
    } as RR.ActionStateQueue;
    JSCompiler_inline_result$asActionHook.queue = markerInstance$asActionQueue;
    ssrFormState$asDispatch = dispatchActionState.bind(
      null,
      currentlyRenderingFiber!,
      markerInstance$asActionQueue,
      setPendingState,
      ssrFormState$asSetState
    );
    markerInstance$asActionQueue.dispatch = ssrFormState$asDispatch;
    JSCompiler_inline_result$asActionHook.memoizedState = action;
    return [initialStateProp, ssrFormState$asDispatch, !1];
  }
  function updateActionState(action: RR.ActionFn): RR.ActionStateTuple {
    var stateHook: RR.Hook = updateWorkInProgressHook();
    return updateActionStateImpl(stateHook, currentHook!, action);
  }
  function updateActionStateImpl(stateHook: RR.Hook, currentStateHook: RR.Hook, action: RR.ActionFn): RR.ActionStateTuple { var stateHook$asIsPending: boolean, currentStateHook$asState: RR.HookState, currentStateHook$asActionHook: RR.Hook;
    currentStateHook$asState = updateReducerImpl(
      stateHook,
      currentStateHook,
      actionStateReducer
    )[0];
    stateHook$asIsPending = updateReducer(basicStateReducer)[0];
    if (
      "object" === typeof currentStateHook$asState &&
      null !== currentStateHook$asState &&
      "function" === typeof currentStateHook$asState.then
    )
      try {
        var state: RR.HookState = useThenable(currentStateHook$asState);
      } catch (x) {
        if (x === SuspenseException) throw SuspenseActionException;
        throw x;
      }
    else state = currentStateHook$asState;
    currentStateHook$asActionHook = updateWorkInProgressHook();
    var actionQueue: RR.ActionStateQueue = currentStateHook$asActionHook.queue as RR.ActionStateQueue,
      dispatch = actionQueue.dispatch;
    action !== currentStateHook$asActionHook.memoizedState &&
      ((currentlyRenderingFiber!.flags |= 2048),
      pushSimpleEffect(
        9,
        { destroy: void 0 },
        actionStateActionEffect.bind(null, actionQueue, action),
        null
      ));
    return [state, dispatch, stateHook$asIsPending as boolean];
  }
  function actionStateActionEffect(actionQueue: RR.ActionStateQueue, action: RR.ActionFn): void {
    actionQueue.action = action;
  }
  function rerenderActionState<S>(action: RR.ActionFn): RR.ActionStateTuple { var stateHook$asState: S, currentStateHook$asActionHook: RR.Hook;
    var stateHook: RR.Hook = updateWorkInProgressHook(),
      currentStateHook: RR.Hook | null = currentHook;
    if (null !== currentStateHook)
      return updateActionStateImpl(stateHook, currentStateHook, action);
    updateWorkInProgressHook();
    stateHook$asState = stateHook.memoizedState;
    currentStateHook$asActionHook = updateWorkInProgressHook();
    var dispatch: RR.Dispatch | null = (currentStateHook$asActionHook.queue as RR.ActionStateQueue).dispatch;
    currentStateHook$asActionHook.memoizedState = action;
    return [stateHook$asState, dispatch, !1];
  }
  function pushSimpleEffect(tag: RR.HookFlags, inst: RR.EffectInstance, create: RR.EffectCreate, deps: RR.HookDeps | null): RR.Effect { var tag$asEffect: RR.Effect, inst$asQueue: RR.FunctionComponentUpdateQueue | null, create$asLast: RR.Effect | null, deps$asFirst: RR.Effect | null;
    tag$asEffect = { tag: tag, create: create, deps: deps, inst: inst, next: null } as RR.Effect;
    inst$asQueue = currentlyRenderingFiber!.updateQueue as RR.FunctionComponentUpdateQueue | null;
    null === inst$asQueue &&
      ((inst$asQueue = createFunctionComponentUpdateQueue()),
      (currentlyRenderingFiber!.updateQueue = inst$asQueue));
    create$asLast = inst$asQueue.lastEffect;
    null === create$asLast
      ? (inst$asQueue.lastEffect = tag$asEffect.next = tag$asEffect)
      : ((deps$asFirst = create$asLast.next),
        (create$asLast.next = tag$asEffect),
        (tag$asEffect.next = deps$asFirst),
        (inst$asQueue.lastEffect = tag$asEffect));
    return tag$asEffect;
  }
  function updateRef(): RR.RefObject {
    return updateWorkInProgressHook().memoizedState;
  }
  function mountEffectImpl(fiberFlags: RR.Flags, hookFlags: RR.HookFlags, create: RR.EffectCreate, deps: RR.HookDeps | null | undefined): void {
    var hook: RR.Hook = mountWorkInProgressHook();
    currentlyRenderingFiber!.flags |= fiberFlags;
    hook.memoizedState = pushSimpleEffect(
      1 | hookFlags,
      { destroy: void 0 },
      create,
      void 0 === deps ? null : deps
    );
  }
  function updateEffectImpl(fiberFlags: RR.Flags, hookFlags: RR.HookFlags, create: RR.EffectCreate, deps: RR.HookDeps | null | undefined): void {
    var hook: RR.Hook = updateWorkInProgressHook();
    deps = void 0 === deps ? null : deps;
    var inst: RR.EffectInstance = (hook.memoizedState as RR.Effect).inst;
    null !== currentHook &&
    null !== deps &&
    areHookInputsEqual(deps, (currentHook.memoizedState as RR.Effect).deps)
      ? (hook.memoizedState = pushSimpleEffect(hookFlags, inst, create, deps))
      : ((currentlyRenderingFiber!.flags |= fiberFlags),
        (hook.memoizedState = pushSimpleEffect(
          1 | hookFlags,
          inst,
          create,
          deps
        )));
  }
  function mountEffect(create: RR.EffectCreate, deps: RR.HookDeps | null | undefined): void {
    mountEffectImpl(8390656, 8, create, deps);
  }
  function updateEffect(create: RR.EffectCreate, deps: RR.HookDeps | null | undefined): void {
    updateEffectImpl(2048, 8, create, deps);
  }
  function useEffectEventImpl(payload: RR.EventFunctionPayload): void {
    currentlyRenderingFiber!.flags |= 4;
    var componentUpdateQueue: RR.FunctionComponentUpdateQueue | null = currentlyRenderingFiber!.updateQueue as RR.FunctionComponentUpdateQueue | null;
    if (null === componentUpdateQueue)
      (componentUpdateQueue = createFunctionComponentUpdateQueue()),
        (currentlyRenderingFiber!.updateQueue = componentUpdateQueue),
        (componentUpdateQueue.events = [payload]);
    else {
      var events = componentUpdateQueue.events;
      null === events
        ? (componentUpdateQueue.events = [payload])
        : events.push(payload);
    }
  }
  function updateEvent(callback: RR.EventFunctionRef["impl"]): RR.EventFunctionRef["impl"] {
    var ref: RR.EventFunctionRef = updateWorkInProgressHook().memoizedState;
    useEffectEventImpl({ ref: ref, nextImpl: callback });
    return function () {
      if (0 !== (executionContext & 2))
        throw Error(formatProdErrorMessage(440));
      return ref.impl.apply(void 0, arguments as any);
    };
  }
  function updateInsertionEffect(create: RR.EffectCreate, deps: RR.HookDeps | null | undefined): void {
    return updateEffectImpl(4, 2, create, deps);
  }
  function updateLayoutEffect(create: RR.EffectCreate, deps: RR.HookDeps | null | undefined): void {
    return updateEffectImpl(4, 4, create, deps);
  }
  function imperativeHandleEffect<T>(create: () => T, ref: RR.Ref | undefined): void | (() => void) { var create$asHandleForCallback: T, create$asHandleForObject: T;
    if ("function" === typeof ref) {
      create$asHandleForCallback = create();
      var refCleanup = ref(create$asHandleForCallback);
      return function () {
        "function" === typeof refCleanup ? refCleanup() : ref(null);
      };
    }
    if (null !== ref && void 0 !== ref)
      return (
        (create$asHandleForObject = create()),
        (ref.current = create$asHandleForObject),
        function () {
          ref.current = null;
        }
      );
  }
  function updateImperativeHandle<T>(ref: RR.Ref | undefined, create: () => T, deps: RR.HookDeps | null | undefined): void {
    deps = null !== deps && void 0 !== deps ? deps.concat([ref]) : null;
    updateEffectImpl(
      4,
      4,
      imperativeHandleEffect.bind(null, create, ref),
      deps
    );
  }
  function mountDebugValue(): void {}
  function updateCallback<T>(callback: T, deps: RR.HookDeps | null | undefined): T {
    var hook: RR.Hook = updateWorkInProgressHook();
    deps = void 0 === deps ? null : deps;
    var prevState: RR.MemoizedPair<T> = hook.memoizedState;
    if (null !== deps && areHookInputsEqual(deps, prevState[1]))
      return prevState[0];
    hook.memoizedState = [callback, deps];
    return callback;
  }
  function updateMemo<T>(nextCreate: () => T, deps: RR.HookDeps | null | undefined): T { var prevState$asValue: T;
    var hook: RR.Hook = updateWorkInProgressHook();
    deps = void 0 === deps ? null : deps;
    var prevState: RR.MemoizedPair<T> = hook.memoizedState as RR.MemoizedPair<T>;
    if (null !== deps && areHookInputsEqual(deps, prevState[1]))
      return prevState[0];
    prevState$asValue = nextCreate();
    if (shouldDoubleInvokeUserFnsInHooksDEV) {
      setIsStrictModeForDevtools(!0);
      try {
        nextCreate();
      } finally {
        setIsStrictModeForDevtools(!1);
      }
    }
    hook.memoizedState = [prevState$asValue, deps];
    return prevState$asValue;
  }
  function mountDeferredValueImpl<T>(hook: RR.Hook, value: T, initialValue: T | undefined): T { var hook$asLane: RR.Lane;
    if (
      void 0 === initialValue ||
      (0 !== (renderLanes & 1073741824) &&
        0 === (workInProgressRootRenderLanes & 261930))
    )
      return (hook.memoizedState = value);
    hook.memoizedState = initialValue;
    hook$asLane = requestDeferredLane();
    currentlyRenderingFiber!.lanes |= hook$asLane;
    workInProgressRootSkippedLanes |= hook$asLane;
    return initialValue;
  }
  function updateDeferredValueImpl<T>(hook: RR.Hook, prevValue: T, value: T, initialValue: T | undefined): T { var hook$asValue: T, hook$asLane: RR.Lane;
    if (objectIs(value, prevValue)) return value;
    if (null !== currentTreeHiddenStackCursor.current)
      return (
        (hook$asValue = mountDeferredValueImpl(hook, value, initialValue)),
        objectIs(hook$asValue, prevValue) || (didReceiveUpdate = !0),
        hook$asValue
      );
    if (
      0 === (renderLanes & 42) ||
      (0 !== (renderLanes & 1073741824) &&
        0 === (workInProgressRootRenderLanes & 261930))
    )
      return (didReceiveUpdate = !0), (hook.memoizedState = value);
    hook$asLane = requestDeferredLane();
    currentlyRenderingFiber!.lanes |= hook$asLane;
    workInProgressRootSkippedLanes |= hook$asLane;
    return prevValue;
  }
  function startTransition(
    fiber: RR.Fiber,
    queue: RR.HookQueue,
    pendingState: RR.HookState,
    finishedState: RR.HookState,
    callback: () => unknown
  ): void {
    var previousPriority: RR.EventPriority = getCurrentUpdatePriority();
    setCurrentUpdatePriority(
      0 !== previousPriority && 8 > previousPriority ? previousPriority : 8
    );
    var prevTransition: RR.Transition | null = ReactSharedInternals.T,
      currentTransition: RR.Transition = {};
    ReactSharedInternals.T = currentTransition;
    dispatchOptimisticSetState(fiber, !1, queue, pendingState);
    try {
      var returnValue: any = callback(),
        onStartTransitionFinish: RR.SharedInternals["S"] = ReactSharedInternals.S;
      null !== onStartTransitionFinish &&
        onStartTransitionFinish(currentTransition, returnValue);
      if (
        null !== returnValue &&
        "object" === typeof returnValue &&
        "function" === typeof returnValue.then
      ) {
        var thenableForFinishedState: RR.ChainedThenable = chainThenableValue(
          returnValue,
          finishedState
        );
        dispatchSetStateInternal(
          fiber,
          queue,
          thenableForFinishedState,
          requestUpdateLane(fiber)
        );
      } else
        dispatchSetStateInternal(
          fiber,
          queue,
          finishedState,
          requestUpdateLane(fiber)
        );
    } catch (error) {
      dispatchSetStateInternal<RR.RejectedThenable>(
        fiber,
        queue,
        { then: function () {}, status: "rejected", reason: error },
        requestUpdateLane()
      );
    } finally {
      setCurrentUpdatePriority(previousPriority),
        null !== prevTransition &&
          null !== currentTransition.types &&
          (prevTransition.types = currentTransition.types),
        (ReactSharedInternals.T = prevTransition);
    }
  }
  function ensureFormComponentIsStateful(formFiber: RR.Fiber): RR.Hook { var formFiber$asAlternate: RR.Fiber | null, existingStateHook$asNewHook: RR.Hook;
    var existingStateHook: RR.Hook | null = formFiber.memoizedState as RR.Hook | null;
    if (null !== existingStateHook) return existingStateHook;
    existingStateHook$asNewHook = {
      memoizedState: NotPendingTransition,
      baseState: NotPendingTransition,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: basicStateReducer,
        lastRenderedState: NotPendingTransition
      } as RR.HookQueue,
      next: null
    };
    var initialResetState: RR.FormResetState = {};
    existingStateHook$asNewHook.next = {
      memoizedState: initialResetState,
      baseState: initialResetState,
      baseQueue: null,
      queue: {
        pending: null,
        lanes: 0,
        dispatch: null,
        lastRenderedReducer: basicStateReducer,
        lastRenderedState: initialResetState
      } as RR.HookQueue,
      next: null
    };
    formFiber.memoizedState = existingStateHook$asNewHook;
    formFiber$asAlternate = formFiber.alternate;
    null !== formFiber$asAlternate && (formFiber$asAlternate.memoizedState = existingStateHook$asNewHook);
    return existingStateHook$asNewHook;
  }
  function useHostTransitionStatus(): RR.TransitionStatus {
    return readContext(HostTransitionContext);
  }
  function updateId(): string {
    return updateWorkInProgressHook().memoizedState;
  }
  function updateRefresh(): () => void {
    return updateWorkInProgressHook().memoizedState;
  }
  function refreshCache(fiber: RR.Fiber): void { var fiber$asUpdate: RR.Update, provider$asPayload: RR.CacheUpdatePayload;
    for (var provider: RR.Fiber | null = fiber.return; null !== provider; ) {
      switch (provider.tag) {
        case 24:
        case 3:
          var lane: RR.Lane = requestUpdateLane();
          fiber$asUpdate = createUpdate(lane);
          var root: RR.FiberRoot | null = enqueueUpdate(provider, fiber$asUpdate, lane);
          null !== root &&
            (scheduleUpdateOnFiber(root, provider, lane),
            entangleTransitions(root, provider, lane));
          provider$asPayload = { cache: createCache() };
          fiber$asUpdate.payload = provider$asPayload;
          return;
      }
      provider = provider.return;
    }
  }
  function dispatchReducerAction<A>(fiber: RR.Fiber, queue: RR.HookQueue, action: A): void { var action$asUpdate: RR.HookUpdate, action$asRoot: RR.FiberRoot | null;
    var lane: RR.Lane = requestUpdateLane();
    action$asUpdate = {
      lane: lane,
      revertLane: 0,
      gesture: null,
      action: action,
      hasEagerState: !1,
      eagerState: null,
      next: null
    } as RR.HookUpdate;
    isRenderPhaseUpdate(fiber)
      ? enqueueRenderPhaseUpdate(queue, action$asUpdate)
      : ((action$asRoot = enqueueConcurrentHookUpdate(fiber, queue, action$asUpdate, lane)),
        null !== action$asRoot &&
          (scheduleUpdateOnFiber(action$asRoot, fiber, lane),
          entangleTransitionUpdate(action$asRoot, queue, lane)));
  }
  function dispatchSetState(fiber: RR.Fiber, queue: RR.HookQueue, action: RR.HookState): void {
    var lane: RR.Lane = requestUpdateLane();
    dispatchSetStateInternal(fiber, queue, action, lane);
  }
  function dispatchSetStateInternal<A>(fiber: RR.Fiber, queue: RR.HookQueue, action: A, lane: RR.Lane): boolean { var action$asRoot: RR.FiberRoot | null, alternate$asReducer: RR.Reducer | null;
    var update: RR.HookUpdate = {
      lane: lane,
      revertLane: 0,
      gesture: null,
      action: action,
      hasEagerState: !1,
      eagerState: null,
      next: null
    };
    if (isRenderPhaseUpdate(fiber)) enqueueRenderPhaseUpdate(queue, update);
    else {
      var alternate: RR.Fiber | null = fiber.alternate;
      if (
        0 === fiber.lanes &&
        (null === alternate || 0 === alternate.lanes) &&
        ((alternate$asReducer = queue.lastRenderedReducer), null !== alternate$asReducer)
      )
        try {
          var currentState: RR.HookState = queue.lastRenderedState,
            eagerState: RR.HookState = alternate$asReducer(currentState, action);
          update.hasEagerState = !0;
          update.eagerState = eagerState;
          if (objectIs(eagerState, currentState))
            return (
              enqueueUpdate$1(fiber, queue, update, 0),
              null === workInProgressRoot && finishQueueingConcurrentUpdates(),
              !1
            );
        } catch (error) {
        } finally {
        }
      action$asRoot = enqueueConcurrentHookUpdate(fiber, queue, update, lane);
      if (null !== action$asRoot)
        return (
          scheduleUpdateOnFiber(action$asRoot, fiber, lane),
          entangleTransitionUpdate(action$asRoot, queue, lane),
          !0
        );
    }
    return !1;
  }
  function dispatchOptimisticSetState<A>(
    fiber: RR.Fiber,
    throwIfDuringRender: boolean,
    queue: RR.HookQueue,
    action: A
  ): void { var throwIfDuringRender$asRoot: RR.FiberRoot | null, action$asUpdate: RR.HookUpdate;
    action$asUpdate = {
      lane: 2,
      revertLane: requestTransitionLane(),
      gesture: null,
      action: action,
      hasEagerState: !1,
      eagerState: null,
      next: null
    } as RR.HookUpdate;
    if (isRenderPhaseUpdate(fiber)) {
      if (throwIfDuringRender) throw Error(formatProdErrorMessage(479));
    } else
      (throwIfDuringRender$asRoot = enqueueConcurrentHookUpdate(
        fiber,
        queue,
        action$asUpdate,
        2
      )),
        null !== throwIfDuringRender$asRoot &&
          scheduleUpdateOnFiber(throwIfDuringRender$asRoot, fiber, 2);
  }
  function isRenderPhaseUpdate(fiber: RR.Fiber): boolean {
    var alternate = fiber.alternate;
    return (
      fiber === currentlyRenderingFiber ||
      (null !== alternate && alternate === currentlyRenderingFiber)
    );
  }
  function enqueueRenderPhaseUpdate(queue: RR.HookQueue, update: RR.HookUpdate): void {
    didScheduleRenderPhaseUpdateDuringThisPass = didScheduleRenderPhaseUpdate =
      !0;
    var pending = queue.pending;
    null === pending
      ? (update.next = update)
      : ((update.next = pending.next), (pending.next = update));
    queue.pending = update;
  }
  function entangleTransitionUpdate(root: RR.FiberRoot, queue: RR.HookQueue, lane: RR.Lanes): void {
    if (0 !== (lane & 4194048)) {
      var queueLanes = queue.lanes;
      queueLanes &= root.pendingLanes;
      lane |= queueLanes;
      queue.lanes = lane;
      markRootEntangled(root, lane);
    }
  }
  function applyDerivedStateFromProps(
    workInProgress: RR.Fiber,
    ctor: RR.ClassComponent,
    getDerivedStateFromProps: RR.DeriveStateFromProps,
    nextProps: RR.Props
  ): void { var ctor$asState: RR.State, getDerivedStateFromProps$asPartial: RR.ClassState | null | undefined, getDerivedStateFromProps$asState: RR.State;
    ctor$asState = workInProgress.memoizedState;
    getDerivedStateFromProps$asPartial = getDerivedStateFromProps(nextProps, ctor$asState);
    getDerivedStateFromProps$asState =
      null === getDerivedStateFromProps$asPartial || void 0 === getDerivedStateFromProps$asPartial
        ? ctor$asState
        : assign({}, ctor$asState, getDerivedStateFromProps$asPartial);
    workInProgress.memoizedState = getDerivedStateFromProps$asState;
    0 === workInProgress.lanes &&
      ((workInProgress.updateQueue as RR.UpdateQueue).baseState = getDerivedStateFromProps$asState);
  }
  function checkShouldComponentUpdate(
    workInProgress: RR.Fiber,
    ctor: RR.ClassComponent,
    oldProps: RR.Props,
    newProps: RR.Props,
    oldState: RR.State,
    newState: RR.State,
    nextContext: RR.ContextValue
  ): boolean { var workInProgress$asInstance: RR.ClassInstance;
    workInProgress$asInstance = workInProgress.stateNode as RR.ClassInstance;
    return "function" === typeof workInProgress$asInstance.shouldComponentUpdate
      ? workInProgress$asInstance.shouldComponentUpdate(newProps, newState, nextContext)
      : ctor.prototype && ctor.prototype.isPureReactComponent
        ? !shallowEqual(oldProps, newProps) || !shallowEqual(oldState, newState)
        : !0;
  }
  function callComponentWillReceiveProps(
    workInProgress: RR.Fiber,
    instance: RR.ClassInstance,
    newProps: RR.Props,
    nextContext: RR.ContextValue
  ): void { var workInProgress$asState: RR.ClassInstance["state"];
    workInProgress$asState = instance.state;
    "function" === typeof instance.componentWillReceiveProps &&
      instance.componentWillReceiveProps(newProps, nextContext);
    "function" === typeof instance.UNSAFE_componentWillReceiveProps &&
      instance.UNSAFE_componentWillReceiveProps(newProps, nextContext);
    instance.state !== workInProgress$asState &&
      classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
  function resolveClassComponentProps(Component: RR.ClassComponent, baseProps: RR.Props): RR.Props { var Component$asDefaults: RR.ClassComponent["defaultProps"];
    var newProps: RR.Props = baseProps;
    if ("ref" in baseProps) {
      newProps = {};
      for (var propName in baseProps)
        "ref" !== propName && (newProps[propName] = baseProps[propName]);
    }
    if ((Component$asDefaults = Component.defaultProps)) {
      newProps === baseProps && (newProps = assign({}, newProps));
      for (var propName$57 in Component$asDefaults)
        void 0 === newProps[propName$57] &&
          (newProps[propName$57] = Component$asDefaults[propName$57]);
    }
    return newProps;
  }
  function logUncaughtError(root: RR.FiberRoot, errorInfo: RR.CapturedValue): void {
    try {
      var onUncaughtError = root.onUncaughtError;
      onUncaughtError(errorInfo.value, { componentStack: errorInfo.stack });
    } catch (e) {
      setTimeout(function () {
        throw e;
      });
    }
  }
  function logCaughtError(root: RR.FiberRoot, boundary: RR.Fiber, errorInfo: RR.CapturedValue): void {
    try {
      var onCaughtError = root.onCaughtError;
      onCaughtError(errorInfo.value, {
        componentStack: errorInfo.stack,
        errorBoundary: 1 === boundary.tag ? boundary.stateNode : null
      });
    } catch (e) {
      setTimeout(function () {
        throw e;
      });
    }
  }
  function createRootErrorUpdate(root: RR.FiberRoot, errorInfo: RR.CapturedValue, lane: RR.Lane): RR.Update { var lane$asUpdate: RR.Update;
    lane$asUpdate = createUpdate(lane);
    lane$asUpdate.tag = 3;
    lane$asUpdate.payload = { element: null } as RR.RootUpdatePayload;
    lane$asUpdate.callback = function () {
      logUncaughtError(root, errorInfo);
    };
    return lane$asUpdate;
  }
  function createClassErrorUpdate(lane: RR.Lane): RR.Update { var lane$asUpdate: RR.Update;
    lane$asUpdate = createUpdate(lane);
    lane$asUpdate.tag = 3;
    return lane$asUpdate;
  }
  function initializeClassErrorUpdate(update: RR.Update, root: RR.FiberRoot, fiber: RR.Fiber, errorInfo: RR.CapturedValue): void {
    var getDerivedStateFromError = (fiber.type as RR.ClassComponent).getDerivedStateFromError;
    if ("function" === typeof getDerivedStateFromError) {
      var error = errorInfo.value;
      update.payload = function () {
        return getDerivedStateFromError!(error);
      };
      update.callback = function () {
        logCaughtError(root, fiber, errorInfo);
      };
    }
    var inst: RR.ClassInstance | null = fiber.stateNode as RR.ClassInstance | null;
    null !== inst &&
      "function" === typeof inst.componentDidCatch &&
      (update.callback = function (this: RR.ClassInstance) {
        logCaughtError(root, fiber, errorInfo);
        "function" !== typeof getDerivedStateFromError &&
          (null === legacyErrorBoundariesThatAlreadyFailed
            ? (legacyErrorBoundariesThatAlreadyFailed = new Set([this]))
            : legacyErrorBoundariesThatAlreadyFailed.add(this));
        var stack = errorInfo.stack;
        this.componentDidCatch!(errorInfo.value, {
          componentStack: null !== stack ? stack : ""
        });
      });
  }
  function throwException(
    root: RR.FiberRoot,
    returnFiber: RR.Fiber | null,
    sourceFiber: RR.Fiber,
    value: RR.Thrown,
    rootRenderLanes: RR.Lanes
  ): boolean { var sourceFiber$asHandler: RR.Fiber | null, sourceFiber$asRetryQueue: RR.RetryQueue | null, sourceFiber$asBoundary: RR.Fiber | null, returnFiber$asRetryQueue: RR.RetryQueue | null, returnFiber$asOffscreenQueue: RR.OffscreenQueue | null, returnFiber$asError: Error, returnFiber$asCtor: RR.ClassComponent, root$asError: Error, root$asFiber: RR.Fiber, root$asLane: RR.Lane, root$asUpdate: RR.Update, value$asCaptured: RR.CapturedValue, rootRenderLanes$asUpdate: RR.Update, wrapperError$asCaptured: RR.CapturedValue, wrapperError$asInstance: RR.ClassInstance | null;
    sourceFiber.flags |= 32768;
    if (
      null !== value &&
      "object" === typeof value &&
      "function" === typeof value.then
    ) {
      returnFiber = sourceFiber.alternate;
      null !== returnFiber &&
        propagateParentContextChanges(
          returnFiber,
          sourceFiber,
          rootRenderLanes,
          !0
        );
      sourceFiber$asHandler = suspenseHandlerStackCursor.current;
      if (null !== sourceFiber$asHandler) {
        switch (sourceFiber$asHandler.tag) {
          case 31:
          case 13:
            return (
              null === shellBoundary
                ? renderDidSuspendDelayIfPossible()
                : null === sourceFiber$asHandler.alternate &&
                  0 === workInProgressRootExitStatus &&
                  (workInProgressRootExitStatus = 3),
              (sourceFiber$asHandler.flags &= -257),
              (sourceFiber$asHandler.flags |= 65536),
              (sourceFiber$asHandler.lanes = rootRenderLanes),
              value === noopSuspenseyCommitThenable
                ? (sourceFiber$asHandler.flags |= 16384)
                : ((returnFiber$asRetryQueue = sourceFiber$asHandler.updateQueue as RR.RetryQueue | null),
                  null === returnFiber$asRetryQueue
                    ? (sourceFiber$asHandler.updateQueue = new Set([value]))
                    : returnFiber$asRetryQueue.add(value),
                  attachPingListener(root, value, rootRenderLanes)),
              !1
            );
          case 22:
            return (
              (sourceFiber$asHandler.flags |= 65536),
              value === noopSuspenseyCommitThenable
                ? (sourceFiber$asHandler.flags |= 16384)
                : ((returnFiber$asOffscreenQueue = sourceFiber$asHandler.updateQueue as RR.OffscreenQueue | null),
                  null === returnFiber$asOffscreenQueue
                    ? ((returnFiber$asOffscreenQueue = {
                        transitions: null,
                        markerInstances: null,
                        retryQueue: new Set([value])
                      } as RR.OffscreenQueue),
                      (sourceFiber$asHandler.updateQueue = returnFiber$asOffscreenQueue))
                    : ((sourceFiber$asRetryQueue = returnFiber$asOffscreenQueue.retryQueue),
                      null === sourceFiber$asRetryQueue
                        ? (returnFiber$asOffscreenQueue.retryQueue = new Set([value]))
                        : sourceFiber$asRetryQueue.add(value)),
                  attachPingListener(root, value, rootRenderLanes)),
              !1
            );
        }
        throw Error(formatProdErrorMessage(435, sourceFiber$asHandler.tag));
      }
      attachPingListener(root, value, rootRenderLanes);
      renderDidSuspendDelayIfPossible();
      return !1;
    }
    if (isHydrating)
      return (
        (returnFiber = suspenseHandlerStackCursor.current),
        null !== returnFiber
          ? (0 === (returnFiber.flags & 65536) && (returnFiber.flags |= 256),
            (returnFiber.flags |= 65536),
            (returnFiber.lanes = rootRenderLanes),
            value !== HydrationMismatchException &&
              ((root$asError = Error(formatProdErrorMessage(422), { cause: value })),
              queueHydrationError(
                createCapturedValueAtFiber(root$asError, sourceFiber)
              )))
          : (value !== HydrationMismatchException &&
              ((returnFiber$asError = Error(formatProdErrorMessage(423), {
                cause: value
              })),
              queueHydrationError(
                createCapturedValueAtFiber(returnFiber$asError, sourceFiber)
              )),
            (root$asFiber = root.current!.alternate!),
            (root$asFiber.flags |= 65536),
            (rootRenderLanes &= -rootRenderLanes),
            (root$asFiber.lanes |= rootRenderLanes),
            (value$asCaptured = createCapturedValueAtFiber(value, sourceFiber)),
            (rootRenderLanes$asUpdate = createRootErrorUpdate(
              root$asFiber.stateNode as RR.FiberRoot,
              value$asCaptured,
              rootRenderLanes
            )),
            enqueueCapturedUpdate(root$asFiber, rootRenderLanes$asUpdate),
            4 !== workInProgressRootExitStatus &&
              (workInProgressRootExitStatus = 2)),
        !1
      );
    var wrapperError: Error = Error(formatProdErrorMessage(520), { cause: value });
    wrapperError$asCaptured = createCapturedValueAtFiber(wrapperError, sourceFiber);
    null === workInProgressRootConcurrentErrors
      ? (workInProgressRootConcurrentErrors = [wrapperError$asCaptured])
      : workInProgressRootConcurrentErrors.push(wrapperError$asCaptured);
    4 !== workInProgressRootExitStatus && (workInProgressRootExitStatus = 2);
    if (null === returnFiber) return !0;
    value$asCaptured = createCapturedValueAtFiber(value, sourceFiber);
    sourceFiber$asBoundary = returnFiber;
    do {
      switch (sourceFiber$asBoundary.tag) {
        case 3:
          return (
            (sourceFiber$asBoundary.flags |= 65536),
            (root$asLane = rootRenderLanes & -rootRenderLanes),
            (sourceFiber$asBoundary.lanes |= root$asLane),
            (root$asUpdate = createRootErrorUpdate(sourceFiber$asBoundary.stateNode as RR.FiberRoot, value$asCaptured, root$asLane)),
            enqueueCapturedUpdate(sourceFiber$asBoundary, root$asUpdate),
            !1
          );
        case 1:
          if (
            ((returnFiber$asCtor = sourceFiber$asBoundary.type as RR.ClassComponent),
            (wrapperError$asInstance = sourceFiber$asBoundary.stateNode as RR.ClassInstance | null),
            0 === (sourceFiber$asBoundary.flags & 128) &&
              ("function" === typeof returnFiber$asCtor.getDerivedStateFromError ||
                (null !== wrapperError$asInstance &&
                  "function" === typeof wrapperError$asInstance.componentDidCatch &&
                  (null === legacyErrorBoundariesThatAlreadyFailed ||
                    !legacyErrorBoundariesThatAlreadyFailed.has(
                      wrapperError$asInstance
                    )))))
          )
            return (
              (sourceFiber$asBoundary.flags |= 65536),
              (rootRenderLanes &= -rootRenderLanes),
              (sourceFiber$asBoundary.lanes |= rootRenderLanes),
              (rootRenderLanes$asUpdate = createClassErrorUpdate(rootRenderLanes)),
              initializeClassErrorUpdate(
                rootRenderLanes$asUpdate,
                root,
                sourceFiber$asBoundary,
                value$asCaptured
              ),
              enqueueCapturedUpdate(sourceFiber$asBoundary, rootRenderLanes$asUpdate),
              !1
            );
      }
      sourceFiber$asBoundary = sourceFiber$asBoundary.return;
    } while (null !== sourceFiber$asBoundary);
    return !1;
  }
  function reconcileChildren(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    nextChildren: RR.ReactNode,
    renderLanes: RR.Lanes
  ): void {
    workInProgress.child =
      null === current
        ? mountChildFibers(workInProgress, null, nextChildren, renderLanes)
        : reconcileChildFibers(
            workInProgress,
            current.child,
            nextChildren,
            renderLanes
          );
  }
  function updateForwardRef(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    Component: RR.ForwardRefType,
    nextProps: RR.PropsWithRef,
    renderLanes: RR.Lanes
  ): RR.Fiber | null { var Component$asRender: RR.FunctionComponent, nextProps$asChildren: RR.ReactNode, key$asDidRenderId: boolean;
    Component$asRender = Component.render;
    var ref = workInProgress.ref;
    if ("ref" in nextProps) {
      var propsWithoutRef: RR.Props = {};
      for (var key in nextProps)
        "ref" !== key && (propsWithoutRef[key] = nextProps[key]);
    } else propsWithoutRef = nextProps;
    prepareToReadContext(workInProgress);
    nextProps$asChildren = renderWithHooks(
      current,
      workInProgress,
      Component$asRender,
      propsWithoutRef,
      ref,
      renderLanes
    );
    key$asDidRenderId = checkDidRenderIdHook();
    if (null !== current && !didReceiveUpdate)
      return (
        bailoutHooks(current, workInProgress, renderLanes),
        bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
      );
    isHydrating && key$asDidRenderId && pushMaterializedTreeId(workInProgress);
    workInProgress.flags |= 1;
    reconcileChildren(current, workInProgress, nextProps$asChildren, renderLanes);
    return workInProgress.child;
  }
  function updateMemoComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    Component: RR.MemoType,
    nextProps: RR.Props,
    renderLanes: RR.Lanes
  ): RR.Fiber | null { var Component$asCompare: RR.MemoCompare | null, Component$asEqual: RR.MemoCompare, type$asChild: RR.Fiber;
    if (null === current) {
      var type: RR.ElementType = Component.type;
      if (
        "function" === typeof type &&
        !shouldConstruct(type) &&
        void 0 === type.defaultProps &&
        null === Component.compare
      )
        return (
          (workInProgress.tag = 15),
          (workInProgress.type = type),
          updateSimpleMemoComponent(
            current,
            workInProgress,
            type as RR.FunctionComponent,
            nextProps,
            renderLanes
          )
        );
      current = createFiberFromTypeAndProps(
        Component.type,
        null,
        nextProps,
        workInProgress,
        workInProgress.mode,
        renderLanes
      );
      current.ref = workInProgress.ref;
      current.return = workInProgress;
      return (workInProgress.child = current);
    }
    type$asChild = current.child!;
    if (!checkScheduledUpdateOrContext(current, renderLanes)) {
      var prevProps = type$asChild.memoizedProps;
      Component$asCompare = Component.compare;
      Component$asEqual = null !== Component$asCompare ? Component$asCompare : shallowEqual;
      if (Component$asEqual(prevProps, nextProps) && current.ref === workInProgress.ref)
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderLanes
        );
    }
    workInProgress.flags |= 1;
    current = createWorkInProgress(type$asChild, nextProps);
    current.ref = workInProgress.ref;
    current.return = workInProgress;
    return (workInProgress.child = current);
  }
  function updateSimpleMemoComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    Component: RR.FunctionComponent,
    nextProps: RR.Props,
    renderLanes: RR.Lanes
  ): RR.Fiber | null {
    if (null !== current) {
      var prevProps = current.memoizedProps;
      if (
        shallowEqual(prevProps, nextProps) &&
        current.ref === workInProgress.ref
      )
        if (
          ((didReceiveUpdate = !1),
          (workInProgress.pendingProps = nextProps = prevProps),
          checkScheduledUpdateOrContext(current, renderLanes))
        )
          0 !== (current.flags & 131072) && (didReceiveUpdate = !0);
        else
          return (
            (workInProgress.lanes = current.lanes),
            bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
          );
    }
    return updateFunctionComponent(
      current,
      workInProgress,
      Component,
      nextProps,
      renderLanes
    );
  }
  function updateOffscreenComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    renderLanes: RR.Lanes,
    nextProps: RR.OffscreenProps
  ): RR.Fiber | null { var nextProps$asChild: RR.Fiber | null, nextProps$asLanes: RR.Lanes, nextChildren$asLanes: RR.Lanes, prevState$asLanes: RR.Lanes;
    var nextChildren: RR.Carried = nextProps.children,
      prevState: RR.OffscreenState | null = null !== current ? current.memoizedState as RR.OffscreenState | null : null;
    null === current &&
      null === workInProgress.stateNode &&
      (workInProgress.stateNode = {
        _visibility: 1,
        _pendingMarkers: null,
        _retryCache: null,
        _transitions: null
      } as RR.OffscreenInstance);
    if ("hidden" === nextProps.mode) {
      if (0 !== (workInProgress.flags & 128)) {
        prevState$asLanes =
          null !== prevState ? prevState.baseLanes | renderLanes : renderLanes;
        if (null !== current) {
          nextProps$asChild = workInProgress.child = current.child;
          for (nextChildren$asLanes = 0; null !== nextProps$asChild; )
            (nextChildren$asLanes =
              nextChildren$asLanes | nextProps$asChild.lanes | nextProps$asChild.childLanes),
              (nextProps$asChild = nextProps$asChild.sibling);
          nextProps$asLanes = nextChildren$asLanes & ~prevState$asLanes;
        } else (nextProps$asLanes = 0), (workInProgress.child = null);
        return deferHiddenOffscreenComponent(
          current,
          workInProgress,
          prevState$asLanes,
          renderLanes,
          nextProps$asLanes
        );
      }
      if (0 !== (renderLanes & 536870912))
        (workInProgress.memoizedState = { baseLanes: 0, cachePool: null } as RR.OffscreenState),
          null !== current &&
            pushTransition(
              workInProgress,
              null !== prevState ? prevState.cachePool : null
            ),
          null !== prevState
            ? pushHiddenContext(workInProgress, prevState)
            : reuseHiddenContextOnStack(),
          pushOffscreenSuspenseHandler(workInProgress);
      else
        return (
          (nextProps$asLanes = workInProgress.lanes = 536870912),
          deferHiddenOffscreenComponent(
            current,
            workInProgress,
            null !== prevState
              ? prevState.baseLanes | renderLanes
              : renderLanes,
            renderLanes,
            nextProps$asLanes
          )
        );
    } else
      null !== prevState
        ? (pushTransition(workInProgress, prevState.cachePool),
          pushHiddenContext(workInProgress, prevState),
          reuseSuspenseHandlerOnStack(workInProgress),
          (workInProgress.memoizedState = null))
        : (null !== current && pushTransition(workInProgress, null),
          reuseHiddenContextOnStack(),
          reuseSuspenseHandlerOnStack(workInProgress));
    reconcileChildren(current, workInProgress, nextChildren, renderLanes);
    return workInProgress.child;
  }
  function bailoutOffscreenComponent(current: RR.Fiber | null, workInProgress: RR.Fiber): RR.Fiber | null {
    (null !== current && 22 === current.tag) ||
      null !== workInProgress.stateNode ||
      (workInProgress.stateNode = {
        _visibility: 1,
        _pendingMarkers: null,
        _retryCache: null,
        _transitions: null
      } as RR.OffscreenInstance);
    return workInProgress.sibling;
  }
  function deferHiddenOffscreenComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    nextBaseLanes: RR.Lanes,
    renderLanes: RR.Lanes,
    remainingChildLanes: RR.Lanes
  ): null { var JSCompiler_inline_result$asPool: RR.SpawnedCachePool | null;
    var JSCompiler_inline_result: RR.Cache | null = peekCacheFromPool();
    JSCompiler_inline_result$asPool =
      null === JSCompiler_inline_result
        ? null
        : {
            parent: isPrimaryRenderer
              ? CacheContext._currentValue
              : CacheContext._currentValue2,
            pool: JSCompiler_inline_result
          };
    workInProgress.memoizedState = {
      baseLanes: nextBaseLanes,
      cachePool: JSCompiler_inline_result$asPool
    } as RR.OffscreenState;
    null !== current && pushTransition(workInProgress, null);
    reuseHiddenContextOnStack();
    pushOffscreenSuspenseHandler(workInProgress);
    null !== current &&
      propagateParentContextChanges(current, workInProgress, renderLanes, !0);
    workInProgress.childLanes = remainingChildLanes;
    return null;
  }
  function mountActivityChildren(workInProgress: RR.Fiber, nextProps: RR.Props): RR.Fiber { var nextProps$asChild: RR.Fiber;
    nextProps$asChild = mountWorkInProgressOffscreenFiber(
      { mode: nextProps.mode, children: nextProps.children },
      workInProgress.mode
    );
    nextProps$asChild.ref = workInProgress.ref;
    workInProgress.child = nextProps$asChild;
    nextProps$asChild.return = workInProgress;
    return nextProps$asChild;
  }
  function retryActivityComponentWithoutHydrating(
    current: RR.Fiber,
    workInProgress: RR.Fiber,
    renderLanes: RR.Lanes
  ): RR.Fiber {
    reconcileChildFibers(workInProgress, current.child, null, renderLanes);
    current = mountActivityChildren(
      workInProgress,
      workInProgress.pendingProps
    );
    current.flags |= 2;
    popSuspenseHandler(workInProgress);
    workInProgress.memoizedState = null;
    return current;
  }
  function updateActivityComponent(current: RR.Fiber | null, workInProgress: RR.Fiber, renderLanes: RR.Lanes): RR.Fiber | null { var current$asHiddenChild: RR.Fiber, current$asHydratable: RR.HydratableInstance | null, current$asInstance: RR.ActivityInstance | null, current$asTreeContext: RR.TreeContext | null, current$asChild: RR.Fiber, workInProgress$asResult: RR.Fiber | null, renderLanes$asFragment: RR.Fiber, nextProps$asRoot: RR.FiberRoot | null, dehydrated$asLane: RR.Lane;
    var nextProps: RR.Props = workInProgress.pendingProps as RR.Props,
      didSuspend = 0 !== (workInProgress.flags & 128);
    workInProgress.flags &= -129;
    if (null === current) {
      if (isHydrating) {
        if ("hidden" === nextProps.mode)
          return (
            (current$asHiddenChild = mountActivityChildren(workInProgress, nextProps)),
            (workInProgress.lanes = 536870912),
            bailoutOffscreenComponent(null, current$asHiddenChild)
          );
        pushDehydratedActivitySuspenseHandler(workInProgress);
        (current$asHydratable = nextHydratableInstance)
          ? ((current$asInstance = canHydrateActivityInstance!(
              current$asHydratable,
              rootOrSingletonContext
            )),
            null !== current$asInstance &&
              ((workInProgress.memoizedState = {
                dehydrated: current$asInstance,
                treeContext:
                  null !== treeContextProvider
                    ? { id: treeContextId, overflow: treeContextOverflow }
                    : null,
                retryLane: 536870912,
                hydrationErrors: null
              } as RR.SuspenseState),
              (renderLanes$asFragment = createFiberFromDehydratedFragment(current$asInstance)),
              (renderLanes$asFragment.return = workInProgress),
              (workInProgress.child = renderLanes$asFragment),
              (hydrationParentFiber = workInProgress),
              (nextHydratableInstance = null)))
          : (current$asInstance = null);
        if (null === current$asInstance) throw throwOnHydrationMismatch(workInProgress);
        workInProgress.lanes = 536870912;
        return null;
      }
      return mountActivityChildren(workInProgress, nextProps);
    }
    var prevState: RR.ActivityState | null = current.memoizedState as RR.ActivityState | null;
    if (null !== prevState) {
      var dehydrated: RR.ActivityInstance | null = prevState.dehydrated;
      pushDehydratedActivitySuspenseHandler(workInProgress);
      if (didSuspend)
        if (workInProgress.flags & 256)
          (workInProgress.flags &= -257),
            (workInProgress$asResult = retryActivityComponentWithoutHydrating(
              current,
              workInProgress,
              renderLanes
            ));
        else if (null !== workInProgress.memoizedState)
          (workInProgress.child = current.child),
            (workInProgress.flags |= 128),
            (workInProgress$asResult = null);
        else throw Error(formatProdErrorMessage(558));
      else if (
        (didReceiveUpdate ||
          propagateParentContextChanges(
            current,
            workInProgress,
            renderLanes,
            !1
          ),
        (didSuspend = 0 !== (renderLanes & current.childLanes)),
        didReceiveUpdate || didSuspend)
      ) {
        nextProps$asRoot = workInProgressRoot;
        if (
          null !== nextProps$asRoot &&
          ((dehydrated$asLane = getBumpedLaneForHydration(nextProps$asRoot, renderLanes)),
          0 !== dehydrated$asLane && dehydrated$asLane !== prevState.retryLane)
        )
          throw (
            ((prevState.retryLane = dehydrated$asLane),
            enqueueConcurrentRenderForLane(current, dehydrated$asLane),
            scheduleUpdateOnFiber(nextProps$asRoot, current, dehydrated$asLane),
            SelectiveHydrationException)
          );
        renderDidSuspendDelayIfPossible();
        workInProgress$asResult = retryActivityComponentWithoutHydrating(
          current,
          workInProgress,
          renderLanes
        );
      } else
        (current$asTreeContext = prevState.treeContext),
          supportsHydration &&
            ((nextHydratableInstance =
              getFirstHydratableChildWithinActivityInstance!(dehydrated)),
            (hydrationParentFiber = workInProgress),
            (isHydrating = !0),
            (hydrationErrors = null),
            (rootOrSingletonContext = !1),
            null !== current$asTreeContext &&
              restoreSuspendedTreeContext(workInProgress, current$asTreeContext)),
          (workInProgress$asResult = mountActivityChildren(workInProgress, nextProps)),
          (workInProgress$asResult.flags |= 4096);
      return workInProgress$asResult;
    }
    current$asChild = createWorkInProgress(current.child!, {
      mode: nextProps.mode,
      children: nextProps.children
    } as RR.OffscreenProps);
    current$asChild.ref = workInProgress.ref;
    workInProgress.child = current$asChild;
    current$asChild.return = workInProgress;
    return current$asChild;
  }
  function markRef(current: RR.Fiber | null, workInProgress: RR.Fiber): void {
    var ref = workInProgress.ref;
    if (null === ref)
      null !== current &&
        null !== current.ref &&
        (workInProgress.flags |= 4194816);
    else {
      if ("function" !== typeof ref && "object" !== typeof ref)
        throw Error(formatProdErrorMessage(284));
      if (null === current || current.ref !== ref)
        workInProgress.flags |= 4194816;
    }
  }
  function updateFunctionComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    Component: RR.FunctionComponent,
    nextProps: RR.Props,
    renderLanes: RR.Lanes
  ): RR.Fiber | null { var Component$asChildren: RR.ReactNode, nextProps$asHasId: boolean;
    prepareToReadContext(workInProgress);
    Component$asChildren = renderWithHooks(
      current,
      workInProgress,
      Component,
      nextProps,
      void 0,
      renderLanes
    );
    nextProps$asHasId = checkDidRenderIdHook();
    if (null !== current && !didReceiveUpdate)
      return (
        bailoutHooks(current, workInProgress, renderLanes),
        bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
      );
    isHydrating && nextProps$asHasId && pushMaterializedTreeId(workInProgress);
    workInProgress.flags |= 1;
    reconcileChildren(current, workInProgress, Component$asChildren, renderLanes);
    return workInProgress.child;
  }
  function replayFunctionComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    nextProps: RR.Props,
    Component: RR.FunctionComponent,
    secondArg: RR.Ref | undefined,
    renderLanes: RR.Lanes
  ): RR.Fiber | null { var nextProps$asChildren: RR.ReactNode, Component$asHasId: boolean;
    prepareToReadContext(workInProgress);
    workInProgress.updateQueue = null;
    nextProps$asChildren = renderWithHooksAgain(
      workInProgress,
      Component,
      nextProps,
      secondArg
    );
    finishRenderingHooks(current);
    Component$asHasId = checkDidRenderIdHook();
    if (null !== current && !didReceiveUpdate)
      return (
        bailoutHooks(current, workInProgress, renderLanes),
        bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
      );
    isHydrating && Component$asHasId && pushMaterializedTreeId(workInProgress);
    workInProgress.flags |= 1;
    reconcileChildren(current, workInProgress, nextProps$asChildren, renderLanes);
    return workInProgress.child;
  }
  function updateClassComponent(
    current: RR.Fiber | null,
    workInProgress: RR.Fiber,
    Component: RR.ClassComponent,
    nextProps: RR.Props,
    renderLanes: RR.Lanes
  ): RR.Fiber | null { var Component$asChildren: RR.ReactNode, nextProps$asShouldUpdate: boolean, nextProps$asDidCapture: boolean, context$asInstance: RR.ClassInstance, context$asShouldUpdate: boolean, contextType$asDerive: RR.GetDerivedStateFromProps | null | undefined, contextType$asOldState: RR.Carried, contextType$asNextContext: RR.LegacyContext | RR.Carried, contextType$asOldProps: RR.Props, unresolvedOldProps$asChanged: boolean, unresolvedOldProps$asDerive: RR.GetDerivedStateFromProps | null | undefined, oldProps$asShouldUpdate: boolean, oldProps$asNextContext: RR.LegacyContext | RR.Carried, oldContext$asNewState: RR.State, oldContext$asContextType: RR.ReactContext | null | undefined, oldContext$asHasNewLifecycles: boolean, contextType$jscomp$0$asHasNewLifecycles: boolean, contextType$jscomp$0$asOldProps: RR.Props, contextType$jscomp$0$asShouldUpdate: boolean, getDerivedStateFromProps$asNewProps: RR.Props, oldState$asOldContext: RR.Carried;
    prepareToReadContext(workInProgress);
    if (null === workInProgress.stateNode) {
      var context: RR.LegacyContext | RR.Carried = emptyContextObject,
        contextType: RR.ReactContext | null | undefined = Component.contextType;
      "object" === typeof contextType &&
        null !== contextType &&
        (context = readContext(contextType));
      context$asInstance = new Component(nextProps, context);
      workInProgress.memoizedState =
        null !== context$asInstance.state && void 0 !== context$asInstance.state
          ? context$asInstance.state
          : null;
      context$asInstance.updater = classComponentUpdater;
      workInProgress.stateNode = context$asInstance;
      context$asInstance._reactInternals = workInProgress;
      context$asInstance = workInProgress.stateNode;
      context$asInstance.props = nextProps;
      context$asInstance.state = workInProgress.memoizedState;
      context$asInstance.refs = {};
      initializeUpdateQueue(workInProgress);
      contextType = Component.contextType;
      context$asInstance.context =
        "object" === typeof contextType && null !== contextType
          ? readContext(contextType)
          : emptyContextObject;
      context$asInstance.state = workInProgress.memoizedState;
      contextType$asDerive = Component.getDerivedStateFromProps;
      "function" === typeof contextType$asDerive &&
        (applyDerivedStateFromProps(
          workInProgress,
          Component,
          contextType$asDerive,
          nextProps
        ),
        (context$asInstance.state = workInProgress.memoizedState));
      "function" === typeof Component.getDerivedStateFromProps ||
        "function" === typeof context$asInstance.getSnapshotBeforeUpdate ||
        ("function" !== typeof context$asInstance.UNSAFE_componentWillMount &&
          "function" !== typeof context$asInstance.componentWillMount) ||
        ((contextType$asOldState = context$asInstance.state),
        "function" === typeof context$asInstance.componentWillMount &&
          context$asInstance.componentWillMount(),
        "function" === typeof context$asInstance.UNSAFE_componentWillMount &&
          context$asInstance.UNSAFE_componentWillMount(),
        contextType$asOldState !== context$asInstance.state &&
          classComponentUpdater.enqueueReplaceState(
            context$asInstance,
            context$asInstance.state,
            null
          ),
        processUpdateQueue(workInProgress, nextProps, context$asInstance, renderLanes),
        suspendIfUpdateReadFromEntangledAsyncAction(),
        (context$asInstance.state = workInProgress.memoizedState));
      "function" === typeof context$asInstance.componentDidMount &&
        (workInProgress.flags |= 4194308);
      nextProps$asShouldUpdate = !0;
    } else if (null === current) {
      context$asInstance = workInProgress.stateNode as RR.ClassInstance;
      var unresolvedOldProps: RR.Props = workInProgress.memoizedProps as RR.Props,
        oldProps: RR.Props = resolveClassComponentProps(Component, unresolvedOldProps);
      context$asInstance.props = oldProps;
      var oldContext: RR.Carried = context$asInstance.context,
        contextType$jscomp$0: RR.ReactContext | null | undefined = Component.contextType;
      contextType$asNextContext = emptyContextObject;
      "object" === typeof contextType$jscomp$0 &&
        null !== contextType$jscomp$0 &&
        (contextType$asNextContext = readContext(contextType$jscomp$0));
      var getDerivedStateFromProps: RR.GetDerivedStateFromProps | null | undefined = Component.getDerivedStateFromProps;
      contextType$jscomp$0$asHasNewLifecycles =
        "function" === typeof getDerivedStateFromProps ||
        "function" === typeof context$asInstance.getSnapshotBeforeUpdate;
      unresolvedOldProps$asChanged = workInProgress.pendingProps !== unresolvedOldProps;
      contextType$jscomp$0$asHasNewLifecycles ||
        ("function" !== typeof context$asInstance.UNSAFE_componentWillReceiveProps &&
          "function" !== typeof context$asInstance.componentWillReceiveProps) ||
        ((unresolvedOldProps$asChanged || oldContext !== contextType$asNextContext) &&
          callComponentWillReceiveProps(
            workInProgress,
            context$asInstance,
            nextProps,
            contextType$asNextContext
          ));
      hasForceUpdate = !1;
      var oldState: RR.State = workInProgress.memoizedState;
      context$asInstance.state = oldState;
      processUpdateQueue(workInProgress, nextProps, context$asInstance, renderLanes);
      suspendIfUpdateReadFromEntangledAsyncAction();
      oldContext$asNewState = workInProgress.memoizedState;
      unresolvedOldProps$asChanged || oldState !== oldContext$asNewState || hasForceUpdate
        ? ("function" === typeof getDerivedStateFromProps &&
            (applyDerivedStateFromProps(
              workInProgress,
              Component,
              getDerivedStateFromProps,
              nextProps
            ),
            (oldContext$asNewState = workInProgress.memoizedState)),
          (oldProps$asShouldUpdate =
            hasForceUpdate ||
            checkShouldComponentUpdate(
              workInProgress,
              Component,
              oldProps,
              nextProps,
              oldState,
              oldContext$asNewState,
              contextType$asNextContext
            ))
            ? (contextType$jscomp$0$asHasNewLifecycles ||
                ("function" !== typeof context$asInstance.UNSAFE_componentWillMount &&
                  "function" !== typeof context$asInstance.componentWillMount) ||
                ("function" === typeof context$asInstance.componentWillMount &&
                  context$asInstance.componentWillMount(),
                "function" === typeof context$asInstance.UNSAFE_componentWillMount &&
                  context$asInstance.UNSAFE_componentWillMount()),
              "function" === typeof context$asInstance.componentDidMount &&
                (workInProgress.flags |= 4194308))
            : ("function" === typeof context$asInstance.componentDidMount &&
                (workInProgress.flags |= 4194308),
              (workInProgress.memoizedProps = nextProps),
              (workInProgress.memoizedState = oldContext$asNewState)),
          (context$asInstance.props = nextProps),
          (context$asInstance.state = oldContext$asNewState),
          (context$asInstance.context = contextType$asNextContext),
          (nextProps$asShouldUpdate = oldProps$asShouldUpdate))
        : ("function" === typeof context$asInstance.componentDidMount &&
            (workInProgress.flags |= 4194308),
          (nextProps$asShouldUpdate = !1));
    } else {
      context$asInstance = workInProgress.stateNode as RR.ClassInstance;
      cloneUpdateQueue(current, workInProgress);
      contextType$asOldProps = workInProgress.memoizedProps;
      contextType$jscomp$0$asOldProps = resolveClassComponentProps(Component, contextType$asOldProps);
      context$asInstance.props = contextType$jscomp$0$asOldProps;
      getDerivedStateFromProps$asNewProps = workInProgress.pendingProps;
      oldState$asOldContext = context$asInstance.context;
      oldContext$asContextType = Component.contextType;
      oldProps$asNextContext = emptyContextObject;
      "object" === typeof oldContext$asContextType &&
        null !== oldContext$asContextType &&
        (oldProps$asNextContext = readContext(oldContext$asContextType));
      unresolvedOldProps$asDerive = Component.getDerivedStateFromProps;
      (oldContext$asHasNewLifecycles =
        "function" === typeof unresolvedOldProps$asDerive ||
        "function" === typeof context$asInstance.getSnapshotBeforeUpdate) ||
        ("function" !== typeof context$asInstance.UNSAFE_componentWillReceiveProps &&
          "function" !== typeof context$asInstance.componentWillReceiveProps) ||
        ((contextType$asOldProps !== getDerivedStateFromProps$asNewProps || oldState$asOldContext !== oldProps$asNextContext) &&
          callComponentWillReceiveProps(
            workInProgress,
            context$asInstance,
            nextProps,
            oldProps$asNextContext
          ));
      hasForceUpdate = !1;
      oldState = workInProgress.memoizedState;
      context$asInstance.state = oldState;
      processUpdateQueue(workInProgress, nextProps, context$asInstance, renderLanes);
      suspendIfUpdateReadFromEntangledAsyncAction();
      var newState = workInProgress.memoizedState;
      contextType$asOldProps !== getDerivedStateFromProps$asNewProps ||
      oldState !== newState ||
      hasForceUpdate ||
      (null !== current &&
        null !== current.dependencies &&
        checkIfContextChanged(current.dependencies))
        ? ("function" === typeof unresolvedOldProps$asDerive &&
            (applyDerivedStateFromProps(
              workInProgress,
              Component,
              unresolvedOldProps$asDerive,
              nextProps
            ),
            (newState = workInProgress.memoizedState)),
          (contextType$jscomp$0$asShouldUpdate =
            hasForceUpdate ||
            checkShouldComponentUpdate(
              workInProgress,
              Component,
              contextType$jscomp$0$asOldProps,
              nextProps,
              oldState,
              newState,
              oldProps$asNextContext
            ) ||
            (null !== current &&
              null !== current.dependencies &&
              checkIfContextChanged(current.dependencies)))
            ? (oldContext$asHasNewLifecycles ||
                ("function" !== typeof context$asInstance.UNSAFE_componentWillUpdate &&
                  "function" !== typeof context$asInstance.componentWillUpdate) ||
                ("function" === typeof context$asInstance.componentWillUpdate &&
                  context$asInstance.componentWillUpdate(nextProps, newState, oldProps$asNextContext),
                "function" === typeof context$asInstance.UNSAFE_componentWillUpdate &&
                  context$asInstance.UNSAFE_componentWillUpdate(
                    nextProps,
                    newState,
                    oldProps$asNextContext
                  )),
              "function" === typeof context$asInstance.componentDidUpdate &&
                (workInProgress.flags |= 4),
              "function" === typeof context$asInstance.getSnapshotBeforeUpdate &&
                (workInProgress.flags |= 1024))
            : ("function" !== typeof context$asInstance.componentDidUpdate ||
                (contextType$asOldProps === current.memoizedProps &&
                  oldState === current.memoizedState) ||
                (workInProgress.flags |= 4),
              "function" !== typeof context$asInstance.getSnapshotBeforeUpdate ||
                (contextType$asOldProps === current.memoizedProps &&
                  oldState === current.memoizedState) ||
                (workInProgress.flags |= 1024),
              (workInProgress.memoizedProps = nextProps),
              (workInProgress.memoizedState = newState)),
          (context$asInstance.props = nextProps),
          (context$asInstance.state = newState),
          (context$asInstance.context = oldProps$asNextContext),
          (nextProps$asShouldUpdate = contextType$jscomp$0$asShouldUpdate))
        : ("function" !== typeof context$asInstance.componentDidUpdate ||
            (contextType$asOldProps === current.memoizedProps &&
              oldState === current.memoizedState) ||
            (workInProgress.flags |= 4),
          "function" !== typeof context$asInstance.getSnapshotBeforeUpdate ||
            (contextType$asOldProps === current.memoizedProps &&
              oldState === current.memoizedState) ||
            (workInProgress.flags |= 1024),
          (nextProps$asShouldUpdate = !1));
    }
    context$asShouldUpdate = nextProps$asShouldUpdate;
    markRef(current, workInProgress);
    nextProps$asDidCapture = 0 !== (workInProgress.flags & 128);
    context$asShouldUpdate || nextProps$asDidCapture
      ? ((context$asInstance = workInProgress.stateNode as RR.ClassInstance),
        (Component$asChildren =
          nextProps$asDidCapture && "function" !== typeof Component.getDerivedStateFromError
            ? null
            : context$asInstance.render()),
        (workInProgress.flags |= 1),
        null !== current && nextProps$asDidCapture
          ? ((workInProgress.child = reconcileChildFibers(
              workInProgress,
              current.child,
              null,
              renderLanes
            )),
            (workInProgress.child = reconcileChildFibers(
              workInProgress,
              null,
              Component$asChildren,
              renderLanes
            )))
          : reconcileChildren(current, workInProgress, Component$asChildren, renderLanes),
        (workInProgress.memoizedState = context$asInstance.state),
        (current = workInProgress.child))
      : (current = bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderLanes
        ));
    return current;
  }
  function mountHostRootWithoutHydrating(
    current: RR.Fiber,
    workInProgress: RR.Fiber,
    nextChildren: RR.ReactNode,
    renderLanes: RR.Lanes
  ): RR.Fiber | null {
    resetHydrationState();
    workInProgress.flags |= 256;
    reconcileChildren(current, workInProgress, nextChildren, renderLanes);
    return workInProgress.child;
  }
  function mountSuspenseOffscreenState(renderLanes: RR.Lanes): RR.OffscreenState {
    return { baseLanes: renderLanes, cachePool: getSuspendedCache() };
  }
  function getRemainingWorkInPrimaryTree(
    current: RR.Fiber | null,
    primaryTreeDidDefer: boolean,
    renderLanes: RR.Lanes
  ): RR.Lanes { var current$asLanes: RR.Lanes;
    current$asLanes = null !== current ? current.childLanes & ~renderLanes : 0;
    primaryTreeDidDefer && (current$asLanes |= workInProgressDeferredLane);
    return current$asLanes;
  }
  function updateSuspenseComponent(current: RR.Fiber | null, workInProgress: RR.Fiber, renderLanes: RR.Lanes): RR.Fiber | null { var current$asHydratable: RR.HydratableInstance | null, current$asInstance: RR.SuspenseInstance | null, current$asTreeContext: RR.TreeContext | null, current$asFallbackChild: RR.Fiber | null, workInProgress$asNext: RR.Fiber | null, renderLanes$asFragment: RR.Fiber, renderLanes$asCurrentPrimary: RR.Fiber, renderLanes$asPrimary: RR.Fiber, nextProps$asFallback: RR.ReactNode, nextProps$asFallbackFiber: RR.Fiber, nextProps$asPrimary: RR.Fiber, nextProps$asError: Error, nextProps$asLane: RR.Lane, showFallback$asMode: RR.TypeOfMode, showFallback$asPrevPool: RR.SpawnedCachePool | null, showFallback$asPool: RR.SpawnedCachePool | null, didSuspend$asFallbackChild: RR.Fiber | null, nextPrimaryChildren$asPrimary: RR.Fiber, nextPrimaryChildren$asDehydrated: RR.SuspenseInstance | null, nextPrimaryChildren$asFallback: RR.ReactNode, nextPrimaryChildren$asFallbackFiber: RR.Fiber, nextPrimaryChildren$asPrevOffscreen: RR.OffscreenState | null, nextPrimaryChildren$asOffscreen: RR.OffscreenState, prevState$asCurrentPrimary: RR.Fiber, prevState$asCache: RR.Cache, JSCompiler_temp$asDigest: string | null | undefined, JSCompiler_temp$asRoot: RR.FiberRoot | null, JSCompiler_temp$asDeletions: RR.Fiber[] | null;
    var nextProps: RR.SuspenseProps = workInProgress.pendingProps as RR.SuspenseProps,
      showFallback: boolean = !1,
      didSuspend: boolean = 0 !== (workInProgress.flags & 128),
      JSCompiler_temp: boolean;
    (JSCompiler_temp = didSuspend) ||
      (JSCompiler_temp =
        null !== current && null === current.memoizedState
          ? !1
          : 0 !== (suspenseStackCursor.current & 2));
    JSCompiler_temp && ((showFallback = !0), (workInProgress.flags &= -129));
    JSCompiler_temp = 0 !== (workInProgress.flags & 32);
    workInProgress.flags &= -33;
    if (null === current) {
      if (isHydrating) {
        showFallback
          ? pushPrimaryTreeSuspenseHandler(workInProgress)
          : reuseSuspenseHandlerOnStack(workInProgress);
        (current$asHydratable = nextHydratableInstance)
          ? ((current$asInstance = canHydrateSuspenseInstance!(
              current$asHydratable,
              rootOrSingletonContext
            )),
            null !== current$asInstance &&
              ((workInProgress.memoizedState = {
                dehydrated: current$asInstance,
                treeContext:
                  null !== treeContextProvider
                    ? { id: treeContextId, overflow: treeContextOverflow }
                    : null,
                retryLane: 536870912,
                hydrationErrors: null
              } as RR.SuspenseState),
              (renderLanes$asFragment = createFiberFromDehydratedFragment(current$asInstance)),
              (renderLanes$asFragment.return = workInProgress),
              (workInProgress.child = renderLanes$asFragment),
              (hydrationParentFiber = workInProgress),
              (nextHydratableInstance = null)))
          : (current$asInstance = null);
        if (null === current$asInstance) throw throwOnHydrationMismatch(workInProgress);
        isSuspenseInstanceFallback!(current$asInstance)
          ? (workInProgress.lanes = 32)
          : (workInProgress.lanes = 536870912);
        return null;
      }
      var nextPrimaryChildren: RR.ReactNode = nextProps.children;
      nextProps$asFallback = nextProps.fallback;
      if (showFallback)
        return (
          reuseSuspenseHandlerOnStack(workInProgress),
          (showFallback$asMode = workInProgress.mode),
          (nextPrimaryChildren$asPrimary = mountWorkInProgressOffscreenFiber(
            { mode: "hidden", children: nextPrimaryChildren },
            showFallback$asMode
          )),
          (nextProps$asFallbackFiber = createFiberFromFragment(
            nextProps$asFallback,
            showFallback$asMode,
            renderLanes,
            null
          )),
          (nextPrimaryChildren$asPrimary.return = workInProgress),
          (nextProps$asFallbackFiber.return = workInProgress),
          (nextPrimaryChildren$asPrimary.sibling = nextProps$asFallbackFiber),
          (workInProgress.child = nextPrimaryChildren$asPrimary),
          (nextProps$asPrimary = workInProgress.child),
          (nextProps$asPrimary.memoizedState = mountSuspenseOffscreenState(renderLanes)),
          (nextProps$asPrimary.childLanes = getRemainingWorkInPrimaryTree(
            current,
            JSCompiler_temp,
            renderLanes
          )),
          (workInProgress.memoizedState = SUSPENDED_MARKER),
          bailoutOffscreenComponent(null, nextProps$asPrimary)
        );
      pushPrimaryTreeSuspenseHandler(workInProgress);
      return mountSuspensePrimaryChildren(workInProgress, nextPrimaryChildren);
    }
    var prevState: RR.SuspenseState | null = current.memoizedState as RR.SuspenseState | null;
    if (
      null !== prevState &&
      ((nextPrimaryChildren$asDehydrated = prevState.dehydrated),
      null !== nextPrimaryChildren$asDehydrated)
    ) {
      if (didSuspend)
        workInProgress.flags & 256
          ? (pushPrimaryTreeSuspenseHandler(workInProgress),
            (workInProgress.flags &= -257),
            (workInProgress$asNext = retrySuspenseComponentWithoutHydrating(
              current,
              workInProgress,
              renderLanes
            )))
          : null !== workInProgress.memoizedState
            ? (reuseSuspenseHandlerOnStack(workInProgress),
              (workInProgress.child = current.child),
              (workInProgress.flags |= 128),
              (workInProgress$asNext = null))
            : (reuseSuspenseHandlerOnStack(workInProgress),
              (nextPrimaryChildren$asFallback = nextProps.fallback),
              (showFallback$asMode = workInProgress.mode),
              (nextProps$asPrimary = mountWorkInProgressOffscreenFiber(
                { mode: "visible", children: nextProps.children },
                showFallback$asMode
              )),
              (nextPrimaryChildren$asFallbackFiber = createFiberFromFragment(
                nextPrimaryChildren$asFallback,
                showFallback$asMode,
                renderLanes,
                null
              )),
              (nextPrimaryChildren$asFallbackFiber.flags |= 2),
              (nextProps$asPrimary.return = workInProgress),
              (nextPrimaryChildren$asFallbackFiber.return = workInProgress),
              (nextProps$asPrimary.sibling = nextPrimaryChildren$asFallbackFiber),
              (workInProgress.child = nextProps$asPrimary),
              reconcileChildFibers(
                workInProgress,
                current.child,
                null,
                renderLanes
              ),
              (nextProps$asPrimary = workInProgress.child),
              (nextProps$asPrimary.memoizedState =
                mountSuspenseOffscreenState(renderLanes)),
              (nextProps$asPrimary.childLanes = getRemainingWorkInPrimaryTree(
                current,
                JSCompiler_temp,
                renderLanes
              )),
              (workInProgress.memoizedState = SUSPENDED_MARKER),
              (workInProgress$asNext = bailoutOffscreenComponent(null, nextProps$asPrimary)));
      else if (
        (pushPrimaryTreeSuspenseHandler(workInProgress),
        isSuspenseInstanceFallback!(nextPrimaryChildren$asDehydrated))
      )
        (JSCompiler_temp$asDigest =
          getSuspenseInstanceFallbackErrorDetails!(nextPrimaryChildren$asDehydrated).digest),
          (nextProps$asError = Error(formatProdErrorMessage(419))),
          (nextProps$asError.stack = ""),
          ((nextProps$asError as any).digest = JSCompiler_temp$asDigest),
          queueHydrationError({ value: nextProps$asError, source: null, stack: null }),
          (workInProgress$asNext = retrySuspenseComponentWithoutHydrating(
            current,
            workInProgress,
            renderLanes
          ));
      else if (
        (didReceiveUpdate ||
          propagateParentContextChanges(
            current,
            workInProgress,
            renderLanes,
            !1
          ),
        (JSCompiler_temp = 0 !== (renderLanes & current.childLanes)),
        didReceiveUpdate || JSCompiler_temp)
      ) {
        JSCompiler_temp$asRoot = workInProgressRoot;
        if (
          null !== JSCompiler_temp$asRoot &&
          ((nextProps$asLane = getBumpedLaneForHydration(
            JSCompiler_temp$asRoot,
            renderLanes
          )),
          0 !== nextProps$asLane && nextProps$asLane !== prevState.retryLane)
        )
          throw (
            ((prevState.retryLane = nextProps$asLane),
            enqueueConcurrentRenderForLane(current, nextProps$asLane),
            scheduleUpdateOnFiber(JSCompiler_temp$asRoot, current, nextProps$asLane),
            SelectiveHydrationException)
          );
        isSuspenseInstancePending!(nextPrimaryChildren$asDehydrated) ||
          renderDidSuspendDelayIfPossible();
        workInProgress$asNext = retrySuspenseComponentWithoutHydrating(
          current,
          workInProgress,
          renderLanes
        );
      } else
        isSuspenseInstancePending!(nextPrimaryChildren$asDehydrated)
          ? ((workInProgress.flags |= 192),
            (workInProgress.child = current.child),
            (workInProgress$asNext = null))
          : ((current$asTreeContext = prevState.treeContext),
            supportsHydration &&
              ((nextHydratableInstance =
                getFirstHydratableChildWithinSuspenseInstance!(
                  nextPrimaryChildren$asDehydrated
                )),
              (hydrationParentFiber = workInProgress),
              (isHydrating = !0),
              (hydrationErrors = null),
              (rootOrSingletonContext = !1),
              null !== current$asTreeContext &&
                restoreSuspendedTreeContext(workInProgress, current$asTreeContext)),
            (workInProgress$asNext = mountSuspensePrimaryChildren(
              workInProgress,
              nextProps.children
            )),
            (workInProgress$asNext.flags |= 4096));
      return workInProgress$asNext;
    }
    if (showFallback)
      return (
        reuseSuspenseHandlerOnStack(workInProgress),
        (nextPrimaryChildren$asFallback = nextProps.fallback),
        (showFallback$asMode = workInProgress.mode),
        (prevState$asCurrentPrimary = current.child!),
        (didSuspend$asFallbackChild = prevState$asCurrentPrimary.sibling),
        (nextProps$asPrimary = createWorkInProgress(prevState$asCurrentPrimary, {
          mode: "hidden",
          children: nextProps.children
        } as RR.OffscreenProps)),
        (nextProps$asPrimary.subtreeFlags = prevState$asCurrentPrimary.subtreeFlags & 65011712),
        null !== didSuspend$asFallbackChild
          ? (nextPrimaryChildren$asFallbackFiber = createWorkInProgress(
              didSuspend$asFallbackChild,
              nextPrimaryChildren$asFallback
            ))
          : ((nextPrimaryChildren$asFallbackFiber = createFiberFromFragment(
              nextPrimaryChildren$asFallback,
              showFallback$asMode,
              renderLanes,
              null
            )),
            (nextPrimaryChildren$asFallbackFiber.flags |= 2)),
        (nextPrimaryChildren$asFallbackFiber.return = workInProgress),
        (nextProps$asPrimary.return = workInProgress),
        (nextProps$asPrimary.sibling = nextPrimaryChildren$asFallbackFiber),
        (workInProgress.child = nextProps$asPrimary),
        bailoutOffscreenComponent(null, nextProps$asPrimary),
        (nextProps$asPrimary = workInProgress.child),
        (nextPrimaryChildren$asPrevOffscreen = current.child!.memoizedState as RR.OffscreenState | null),
        null === nextPrimaryChildren$asPrevOffscreen
          ? (nextPrimaryChildren$asOffscreen = mountSuspenseOffscreenState(renderLanes))
          : ((showFallback$asPrevPool = nextPrimaryChildren$asPrevOffscreen.cachePool as RR.SpawnedCachePool | null),
            null !== showFallback$asPrevPool
              ? ((prevState$asCache = isPrimaryRenderer
                  ? CacheContext._currentValue as RR.Cache
                  : CacheContext._currentValue2 as RR.Cache),
                (showFallback$asPool =
                  showFallback$asPrevPool.parent !== prevState$asCache
                    ? { parent: prevState$asCache, pool: prevState$asCache } as RR.SpawnedCachePool
                    : showFallback$asPrevPool))
              : (showFallback$asPool = getSuspendedCache()),
            (nextPrimaryChildren$asOffscreen = {
              baseLanes: nextPrimaryChildren$asPrevOffscreen.baseLanes | renderLanes,
              cachePool: showFallback$asPool
            } as RR.OffscreenState)),
        (nextProps$asPrimary.memoizedState = nextPrimaryChildren$asOffscreen),
        (nextProps$asPrimary.childLanes = getRemainingWorkInPrimaryTree(
          current,
          JSCompiler_temp,
          renderLanes
        )),
        (workInProgress.memoizedState = SUSPENDED_MARKER),
        bailoutOffscreenComponent(current.child, nextProps$asPrimary)
      );
    pushPrimaryTreeSuspenseHandler(workInProgress);
    renderLanes$asCurrentPrimary = current.child!;
    current$asFallbackChild = renderLanes$asCurrentPrimary.sibling;
    renderLanes$asPrimary = createWorkInProgress(renderLanes$asCurrentPrimary, {
      mode: "visible",
      children: nextProps.children
    } as RR.OffscreenProps);
    renderLanes$asPrimary.return = workInProgress;
    renderLanes$asPrimary.sibling = null;
    null !== current$asFallbackChild &&
      ((JSCompiler_temp$asDeletions = workInProgress.deletions),
      null === JSCompiler_temp$asDeletions
        ? ((workInProgress.deletions = [current$asFallbackChild]), (workInProgress.flags |= 16))
        : JSCompiler_temp$asDeletions.push(current$asFallbackChild));
    workInProgress.child = renderLanes$asPrimary;
    workInProgress.memoizedState = null;
    return renderLanes$asPrimary;
  }
  function mountSuspensePrimaryChildren(workInProgress: RR.Fiber, primaryChildren: RR.ReactNode): RR.Fiber { var primaryChildren$asFiber: RR.Fiber;
    primaryChildren$asFiber = mountWorkInProgressOffscreenFiber(
      { mode: "visible", children: primaryChildren },
      workInProgress.mode
    );
    primaryChildren$asFiber.return = workInProgress;
    return (workInProgress.child = primaryChildren$asFiber);
  }
  function mountWorkInProgressOffscreenFiber(offscreenProps: RR.OffscreenProps, mode: RR.TypeOfMode): RR.Fiber { var offscreenProps$asFiber: RR.Fiber;
    offscreenProps$asFiber = createFiber(22, offscreenProps, null, mode);
    offscreenProps$asFiber.lanes = 0;
    return offscreenProps$asFiber;
  }
  function retrySuspenseComponentWithoutHydrating(
    current: RR.Fiber,
    workInProgress: RR.Fiber,
    renderLanes: RR.Lanes
  ): RR.Fiber {
    reconcileChildFibers(workInProgress, current.child, null, renderLanes);
    current = mountSuspensePrimaryChildren(
      workInProgress,
      workInProgress.pendingProps.children
    );
    current.flags |= 2;
    workInProgress.memoizedState = null;
    return current;
  }
  function scheduleSuspenseWorkOnFiber(fiber: RR.Fiber, renderLanes: RR.Lanes, propagationRoot: RR.Fiber): void {
    fiber.lanes |= renderLanes;
    var alternate = fiber.alternate;
    null !== alternate && (alternate.lanes |= renderLanes);
    scheduleContextWorkOnParentPath(fiber.return, renderLanes, propagationRoot);
  }
  function initSuspenseListRenderState(
    workInProgress: RR.Fiber,
    isBackwards: boolean,
    tail: RR.Fiber | null,
    lastContentRow: RR.Fiber | null,
    tailMode: RR.SuspenseListTailMode,
    treeForkCount: number
  ): void {
    var renderState: RR.SuspenseListRenderState | null = workInProgress.memoizedState as RR.SuspenseListRenderState | null;
    null === renderState
      ? (workInProgress.memoizedState = {
          isBackwards: isBackwards,
          rendering: null,
          renderingStartTime: 0,
          last: lastContentRow,
          tail: tail,
          tailMode: tailMode,
          treeForkCount: treeForkCount
        } as RR.SuspenseListRenderState)
      : ((renderState.isBackwards = isBackwards),
        (renderState.rendering = null),
        (renderState.renderingStartTime = 0),
        (renderState.last = lastContentRow),
        (renderState.tail = tail),
        (renderState.tailMode = tailMode),
        (renderState.treeForkCount = treeForkCount));
  }
  function updateSuspenseListComponent(current: RR.Fiber | null, workInProgress: RR.Fiber, renderLanes: RR.Lanes): RR.Fiber | null { var nextProps$asChildren: RR.ReactNode, nextProps$asForkCount: number, revealOrder$asLastContentRow: RR.Fiber | null, revealOrder$asTail: RR.Fiber | null, revealOrder$asRow: RR.Fiber | null, renderLanes$asRow: RR.Fiber | null, renderLanes$asLastContentRow: RR.Fiber | null, renderLanes$asTail: RR.Fiber | null;
    var nextProps: RR.SuspenseListProps = workInProgress.pendingProps as RR.SuspenseListProps,
      revealOrder = nextProps.revealOrder,
      tailMode = nextProps.tail;
    nextProps$asChildren = nextProps.children;
    var suspenseContext: RR.SuspenseContext = suspenseStackCursor.current as RR.SuspenseContext,
      shouldForceFallback = 0 !== (suspenseContext & 2);
    shouldForceFallback
      ? ((suspenseContext = (suspenseContext & 1) | 2),
        (workInProgress.flags |= 128))
      : (suspenseContext &= 1);
    push(suspenseStackCursor, suspenseContext);
    reconcileChildren(current, workInProgress, nextProps$asChildren, renderLanes);
    nextProps$asForkCount = isHydrating ? treeForkCount : 0;
    if (!shouldForceFallback && null !== current && 0 !== (current.flags & 128))
      a: for (current = workInProgress.child; null !== current; ) {
        if (13 === current.tag)
          null !== current.memoizedState &&
            scheduleSuspenseWorkOnFiber(current, renderLanes, workInProgress);
        else if (19 === current.tag)
          scheduleSuspenseWorkOnFiber(current, renderLanes, workInProgress);
        else if (null !== current.child) {
          current.child.return = current;
          current = current.child;
          continue;
        }
        if (current === workInProgress) break a;
        for (; null === current.sibling; ) {
          if (null === current.return || current.return === workInProgress)
            break a;
          current = current.return;
        }
        current.sibling.return = current.return;
        current = current.sibling;
      }
    switch (revealOrder) {
      case "forwards":
        renderLanes$asRow = workInProgress.child;
        for (revealOrder$asLastContentRow = null; null !== renderLanes$asRow; )
          (current = renderLanes$asRow.alternate),
            null !== current &&
              null === findFirstSuspended(current) &&
              (revealOrder$asLastContentRow = renderLanes$asRow),
            (renderLanes$asRow = renderLanes$asRow.sibling);
        renderLanes$asLastContentRow = revealOrder$asLastContentRow;
        null === renderLanes$asLastContentRow
          ? ((revealOrder$asTail = workInProgress.child),
            (workInProgress.child = null))
          : ((revealOrder$asTail = renderLanes$asLastContentRow.sibling), (renderLanes$asLastContentRow.sibling = null));
        initSuspenseListRenderState(
          workInProgress,
          !1,
          revealOrder$asTail,
          renderLanes$asLastContentRow,
          tailMode,
          nextProps$asForkCount
        );
        break;
      case "backwards":
      case "unstable_legacy-backwards":
        renderLanes$asTail = null;
        revealOrder$asRow = workInProgress.child;
        for (workInProgress.child = null; null !== revealOrder$asRow; ) {
          current = revealOrder$asRow.alternate;
          if (null !== current && null === findFirstSuspended(current)) {
            workInProgress.child = revealOrder$asRow;
            break;
          }
          current = revealOrder$asRow.sibling;
          revealOrder$asRow.sibling = renderLanes$asTail;
          renderLanes$asTail = revealOrder$asRow;
          revealOrder$asRow = current;
        }
        initSuspenseListRenderState(
          workInProgress,
          !0,
          renderLanes$asTail,
          null,
          tailMode,
          nextProps$asForkCount
        );
        break;
      case "together":
        initSuspenseListRenderState(
          workInProgress,
          !1,
          null,
          null,
          void 0,
          nextProps$asForkCount
        );
        break;
      default:
        workInProgress.memoizedState = null;
    }
    return workInProgress.child;
  }
  function bailoutOnAlreadyFinishedWork(current: RR.Fiber | null, workInProgress: RR.Fiber, renderLanes: RR.Lanes): RR.Fiber | null { var current$asChild: RR.Fiber, renderLanes$asNewChild: RR.Fiber;
    null !== current && (workInProgress.dependencies = current.dependencies);
    workInProgressRootSkippedLanes |= workInProgress.lanes;
    if (0 === (renderLanes & workInProgress.childLanes))
      if (null !== current) {
        if (
          (propagateParentContextChanges(
            current,
            workInProgress,
            renderLanes,
            !1
          ),
          0 === (renderLanes & workInProgress.childLanes))
        )
          return null;
      } else return null;
    if (null !== current && workInProgress.child !== current.child)
      throw Error(formatProdErrorMessage(153));
    if (null !== workInProgress.child) {
      current$asChild = workInProgress.child;
      renderLanes$asNewChild = createWorkInProgress(current$asChild, current$asChild.pendingProps);
      workInProgress.child = renderLanes$asNewChild;
      for (renderLanes$asNewChild.return = workInProgress; null !== current$asChild.sibling; )
        (current$asChild = current$asChild.sibling),
          (renderLanes$asNewChild = renderLanes$asNewChild.sibling =
            createWorkInProgress(current$asChild, current$asChild.pendingProps)),
          (renderLanes$asNewChild.return = workInProgress);
      renderLanes$asNewChild.sibling = null;
    }
    return workInProgress.child;
  }
  function checkScheduledUpdateOrContext(current: RR.Fiber, renderLanes: RR.Lanes): boolean { var current$asDependencies: RR.Dependencies | null;
    if (0 !== (current.lanes & renderLanes)) return !0;
    current$asDependencies = current.dependencies;
    return null !== current$asDependencies && checkIfContextChanged(current$asDependencies) ? !0 : !1;
  }
  function attemptEarlyBailoutIfNoScheduledUpdate(
    current: RR.Fiber,
    workInProgress: RR.Fiber,
    renderLanes: RR.Lanes
  ): RR.Fiber | null { var current$asChild: RR.Fiber | null, state$82$asHasChildWork: boolean, didSuspendBefore$asRenderState: RR.SuspenseListRenderState | null;
    switch (workInProgress.tag) {
      case 3:
        pushHostContainer(
          workInProgress,
          (workInProgress.stateNode as RR.FiberRoot).containerInfo
        );
        pushProvider(workInProgress, CacheContext, (current.memoizedState as RR.RootState).cache);
        resetHydrationState();
        break;
      case 27:
      case 5:
        pushHostContext(workInProgress);
        break;
      case 4:
        pushHostContainer(
          workInProgress,
          (workInProgress.stateNode as RR.PortalState).containerInfo
        );
        break;
      case 10:
        pushProvider(
          workInProgress,
          workInProgress.type as RR.ReactContext,
          workInProgress.memoizedProps.value
        );
        break;
      case 31:
        if (null !== workInProgress.memoizedState)
          return (
            (workInProgress.flags |= 128),
            pushDehydratedActivitySuspenseHandler(workInProgress),
            null
          );
        break;
      case 13:
        var state$82: RR.SuspenseState | null = workInProgress.memoizedState as RR.SuspenseState | null;
        if (null !== state$82) {
          if (null !== state$82.dehydrated)
            return (
              pushPrimaryTreeSuspenseHandler(workInProgress),
              (workInProgress.flags |= 128),
              null
            );
          if (0 !== (renderLanes & workInProgress.child!.childLanes))
            return updateSuspenseComponent(
              current,
              workInProgress,
              renderLanes
            );
          pushPrimaryTreeSuspenseHandler(workInProgress);
          current$asChild = bailoutOnAlreadyFinishedWork(
            current,
            workInProgress,
            renderLanes
          );
          return null !== current$asChild ? current$asChild.sibling : null;
        }
        pushPrimaryTreeSuspenseHandler(workInProgress);
        break;
      case 19:
        var didSuspendBefore: boolean = 0 !== (current.flags & 128);
        state$82$asHasChildWork = 0 !== (renderLanes & workInProgress.childLanes);
        state$82$asHasChildWork ||
          (propagateParentContextChanges(
            current,
            workInProgress,
            renderLanes,
            !1
          ),
          (state$82$asHasChildWork = 0 !== (renderLanes & workInProgress.childLanes)));
        if (didSuspendBefore) {
          if (state$82$asHasChildWork)
            return updateSuspenseListComponent(
              current,
              workInProgress,
              renderLanes
            );
          workInProgress.flags |= 128;
        }
        didSuspendBefore$asRenderState = workInProgress.memoizedState as RR.SuspenseListRenderState | null;
        null !== didSuspendBefore$asRenderState &&
          ((didSuspendBefore$asRenderState.rendering = null),
          (didSuspendBefore$asRenderState.tail = null),
          (didSuspendBefore$asRenderState.lastEffect = null));
        push(suspenseStackCursor, suspenseStackCursor.current);
        if (state$82$asHasChildWork) break;
        else return null;
      case 22:
        return (
          (workInProgress.lanes = 0),
          updateOffscreenComponent(
            current,
            workInProgress,
            renderLanes,
            workInProgress.pendingProps
          )
        );
      case 24:
        pushProvider(workInProgress, CacheContext, (current.memoizedState as RR.CacheComponentState).cache);
    }
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }
  function beginWork(current: RR.Fiber | null, workInProgress: RR.Fiber, renderLanes: RR.Lanes): RR.Fiber | null { var current$asComponent: RR.ResolvedLazy, current$asHydrated: RR.HydratableInstance | boolean | null, renderLanes$asChild: RR.Fiber | null, renderLanes$asResource: RR.Resource | null, renderLanes$asHydratable: RR.HydratableInstance | null, renderLanes$asTextInstance: RR.TextInstance | null, workInProgress$asLazyNext: RR.Fiber | null, workInProgress$asName: RR.ElementType, workInProgress$asRootNext: RR.Fiber | null, nextState$asPrevProps: RR.Props | null, nextProps$asCache: RR.Cache, nextProps$asFreshCache: RR.Cache, nextProps$asState: RR.MemoizedState;
    if (null !== current)
      if (current.memoizedProps !== workInProgress.pendingProps)
        didReceiveUpdate = !0;
      else {
        if (
          !checkScheduledUpdateOrContext(current, renderLanes) &&
          0 === (workInProgress.flags & 128)
        )
          return (
            (didReceiveUpdate = !1),
            attemptEarlyBailoutIfNoScheduledUpdate(
              current,
              workInProgress,
              renderLanes
            )
          );
        didReceiveUpdate = 0 !== (current.flags & 131072) ? !0 : !1;
      }
    else
      (didReceiveUpdate = !1),
        isHydrating &&
          0 !== (workInProgress.flags & 1048576) &&
          pushTreeId(workInProgress, treeForkCount, workInProgress.index);
    workInProgress.lanes = 0;
    switch (workInProgress.tag) {
      case 16:
        a: {
          var props: RR.PropsOrChildren = workInProgress.pendingProps;
          current$asComponent = resolveLazy(workInProgress.elementType) as RR.ResolvedLazy;
          workInProgress.type = current$asComponent;
          if ("function" === typeof current$asComponent)
            shouldConstruct(current$asComponent)
              ? ((props = resolveClassComponentProps(current$asComponent as RR.ClassComponent, props)),
                (workInProgress.tag = 1),
                (workInProgress$asLazyNext = updateClassComponent(
                  null,
                  workInProgress,
                  current$asComponent as RR.ClassComponent,
                  props,
                  renderLanes
                )))
              : ((workInProgress.tag = 0),
                (workInProgress$asLazyNext = updateFunctionComponent(
                  null,
                  workInProgress,
                  current$asComponent as RR.FunctionComponent,
                  props,
                  renderLanes
                )));
          else {
            if (void 0 !== current$asComponent && null !== current$asComponent) {
              var $$typeof: RR.Anything | RR.ElementType | RR.RootState | RR.CacheComponentState | RR.Cache | RR.FiberRoot | RR.HydratableInstance = current$asComponent.$$typeof;
              if ($$typeof === REACT_FORWARD_REF_TYPE) {
                workInProgress.tag = 11;
                workInProgress$asLazyNext = updateForwardRef(
                  null,
                  workInProgress,
                  current$asComponent as RR.ForwardRefType,
                  props,
                  renderLanes
                );
                break a;
              } else if ($$typeof === REACT_MEMO_TYPE) {
                workInProgress.tag = 14;
                workInProgress$asLazyNext = updateMemoComponent(
                  null,
                  workInProgress,
                  current$asComponent as RR.MemoType,
                  props,
                  renderLanes
                );
                break a;
              }
            }
            workInProgress$asName = getComponentNameFromType(current$asComponent) || current$asComponent;
            throw Error(formatProdErrorMessage(306, workInProgress$asName, ""));
          }
        }
        return workInProgress$asLazyNext;
      case 0:
        return updateFunctionComponent(
          current,
          workInProgress,
          workInProgress.type as RR.FunctionComponent,
          workInProgress.pendingProps,
          renderLanes
        );
      case 1:
        return (
          (props = workInProgress.type),
          ($$typeof = resolveClassComponentProps(
            props,
            workInProgress.pendingProps
          )),
          updateClassComponent(
            current,
            workInProgress,
            props,
            $$typeof as RR.Props,
            renderLanes
          )
        );
      case 3:
        a: {
          pushHostContainer(
            workInProgress,
            (workInProgress.stateNode as RR.FiberRoot).containerInfo
          );
          if (null === current) throw Error(formatProdErrorMessage(387));
          var nextProps: RR.PropsOrChildren = workInProgress.pendingProps;
          $$typeof = workInProgress.memoizedState as RR.RootState;
          props = $$typeof.element;
          cloneUpdateQueue(current, workInProgress);
          processUpdateQueue(workInProgress, nextProps, null, renderLanes);
          var nextState: RR.RootState = workInProgress.memoizedState as RR.RootState;
          nextProps$asCache = nextState.cache;
          pushProvider(workInProgress, CacheContext, nextProps$asCache);
          nextProps$asCache !== $$typeof.cache &&
            propagateContextChanges(
              workInProgress,
              [CacheContext],
              renderLanes,
              !0
            );
          suspendIfUpdateReadFromEntangledAsyncAction();
          nextProps = nextState.element;
          if (supportsHydration && $$typeof.isDehydrated)
            if (
              (($$typeof = {
                element: nextProps,
                isDehydrated: !1,
                cache: nextState.cache
              } as RR.RootState),
              ((workInProgress.updateQueue as RR.UpdateQueue).baseState = $$typeof),
              (workInProgress.memoizedState = $$typeof),
              workInProgress.flags & 256)
            ) {
              workInProgress$asRootNext = mountHostRootWithoutHydrating(
                current,
                workInProgress,
                nextProps,
                renderLanes
              );
              break a;
            } else if (nextProps !== props) {
              props = createCapturedValueAtFiber(
                Error(formatProdErrorMessage(424)),
                workInProgress
              );
              queueHydrationError(props);
              workInProgress$asRootNext = mountHostRootWithoutHydrating(
                current,
                workInProgress,
                nextProps,
                renderLanes
              );
              break a;
            } else
              for (
                supportsHydration &&
                  ((nextHydratableInstance =
                    getFirstHydratableChildWithinContainer!(
                      (workInProgress.stateNode as RR.FiberRoot).containerInfo
                    )),
                  (hydrationParentFiber = workInProgress),
                  (isHydrating = !0),
                  (hydrationErrors = null),
                  (rootOrSingletonContext = !0)),
                  renderLanes$asChild = mountChildFibers(
                    workInProgress,
                    null,
                    nextProps,
                    renderLanes
                  ),
                  workInProgress.child = renderLanes$asChild;
                renderLanes$asChild;

              )
                (renderLanes$asChild.flags = (renderLanes$asChild.flags & -3) | 4096),
                  (renderLanes$asChild = renderLanes$asChild.sibling);
          else {
            resetHydrationState();
            if (nextProps === props) {
              workInProgress$asRootNext = bailoutOnAlreadyFinishedWork(
                current,
                workInProgress,
                renderLanes
              );
              break a;
            }
            reconcileChildren(current, workInProgress, nextProps, renderLanes);
          }
          workInProgress$asRootNext = workInProgress.child;
        }
        return workInProgress$asRootNext;
      case 26:
        if (supportsResources)
          return (
            markRef(current, workInProgress),
            null === current
              ? (renderLanes$asResource = getResource!(
                  workInProgress.type,
                  null,
                  workInProgress.pendingProps,
                  null
                ))
                ? (workInProgress.memoizedState = renderLanes$asResource)
                : isHydrating ||
                  (workInProgress.stateNode = createHoistableInstance!(
                    workInProgress.type,
                    workInProgress.pendingProps,
                    rootInstanceStackCursor.current,
                    workInProgress
                  ))
              : (workInProgress.memoizedState = getResource!(
                  workInProgress.type,
                  current.memoizedProps,
                  workInProgress.pendingProps,
                  current.memoizedState
                )),
            null
          );
      case 27:
        if (supportsSingletons)
          return (
            pushHostContext(workInProgress),
            null === current &&
              supportsSingletons &&
              isHydrating &&
              ((props = workInProgress.stateNode =
                resolveSingletonInstance!(
                  workInProgress.type,
                  workInProgress.pendingProps,
                  rootInstanceStackCursor.current,
                  contextStackCursor.current,
                  !1
                )),
              (hydrationParentFiber = workInProgress),
              (rootOrSingletonContext = !0),
              (nextHydratableInstance = getFirstHydratableChildWithinSingleton!(
                workInProgress.type,
                props,
                nextHydratableInstance
              ))),
            reconcileChildren(
              current,
              workInProgress,
              workInProgress.pendingProps.children,
              renderLanes
            ),
            markRef(current, workInProgress),
            null === current && (workInProgress.flags |= 4194304),
            workInProgress.child
          );
      case 5:
        if (null === current && isHydrating) {
          validateHydratableInstance!(
            workInProgress.type,
            workInProgress.pendingProps,
            contextStackCursor.current
          );
          if (($$typeof = props = nextHydratableInstance))
            (props = canHydrateInstance!(
              props,
              workInProgress.type,
              workInProgress.pendingProps,
              rootOrSingletonContext
            )),
              null !== props
                ? ((workInProgress.stateNode = props),
                  (hydrationParentFiber = workInProgress),
                  (nextHydratableInstance = getFirstHydratableChild!(props)),
                  (rootOrSingletonContext = !1),
                  ($$typeof = !0))
                : ($$typeof = !1);
          $$typeof || throwOnHydrationMismatch(workInProgress);
        }
        pushHostContext(workInProgress);
        $$typeof = workInProgress.type;
        nextProps = workInProgress.pendingProps;
        nextState$asPrevProps = null !== current ? current.memoizedProps : null;
        props = nextProps.children;
        shouldSetTextContent($$typeof, nextProps)
          ? (props = null)
          : null !== nextState$asPrevProps &&
            shouldSetTextContent($$typeof, nextState$asPrevProps) &&
            (workInProgress.flags |= 32);
        null !== workInProgress.memoizedState &&
          (($$typeof = renderWithHooks(
            current,
            workInProgress,
            TransitionAwareHostComponent,
            null,
            null,
            renderLanes
          ) as RR.TransitionStatus),
          isPrimaryRenderer
            ? (HostTransitionContext._currentValue = $$typeof)
            : (HostTransitionContext._currentValue2 = $$typeof));
        markRef(current, workInProgress);
        reconcileChildren(current, workInProgress, props, renderLanes);
        return workInProgress.child;
      case 6:
        if (null === current && isHydrating) {
          validateHydratableTextInstance!(
            workInProgress.pendingProps,
            contextStackCursor.current
          );
          if ((current$asHydrated = renderLanes$asHydratable = nextHydratableInstance))
            (renderLanes$asTextInstance = canHydrateTextInstance!(
              renderLanes$asHydratable,
              workInProgress.pendingProps,
              rootOrSingletonContext
            )),
              null !== renderLanes$asTextInstance
                ? ((workInProgress.stateNode = renderLanes$asTextInstance),
                  (hydrationParentFiber = workInProgress),
                  (nextHydratableInstance = null),
                  (current$asHydrated = !0))
                : (current$asHydrated = !1);
          current$asHydrated || throwOnHydrationMismatch(workInProgress);
        }
        return null;
      case 13:
        return updateSuspenseComponent(current, workInProgress, renderLanes);
      case 4:
        return (
          pushHostContainer(
            workInProgress,
            (workInProgress.stateNode as RR.PortalState).containerInfo
          ),
          (props = workInProgress.pendingProps),
          null === current
            ? (workInProgress.child = reconcileChildFibers(
                workInProgress,
                null,
                props,
                renderLanes
              ))
            : reconcileChildren(current, workInProgress, props, renderLanes),
          workInProgress.child
        );
      case 11:
        return updateForwardRef(
          current,
          workInProgress,
          workInProgress.type as RR.ForwardRefType,
          workInProgress.pendingProps,
          renderLanes
        );
      case 7:
        return (
          reconcileChildren(
            current,
            workInProgress,
            workInProgress.pendingProps,
            renderLanes
          ),
          workInProgress.child
        );
      case 8:
        return (
          reconcileChildren(
            current,
            workInProgress,
            workInProgress.pendingProps.children,
            renderLanes
          ),
          workInProgress.child
        );
      case 12:
        return (
          reconcileChildren(
            current,
            workInProgress,
            workInProgress.pendingProps.children,
            renderLanes
          ),
          workInProgress.child
        );
      case 10:
        return (
          (props = workInProgress.pendingProps),
          pushProvider(workInProgress, workInProgress.type as RR.ReactContext, props.value),
          reconcileChildren(
            current,
            workInProgress,
            props.children,
            renderLanes
          ),
          workInProgress.child
        );
      case 9:
        return (
          ($$typeof = (workInProgress.type as RR.ConsumerType)._context),
          (props = workInProgress.pendingProps.children),
          prepareToReadContext(workInProgress),
          ($$typeof = readContext($$typeof)),
          (props = props($$typeof)),
          (workInProgress.flags |= 1),
          reconcileChildren(current, workInProgress, props, renderLanes),
          workInProgress.child
        );
      case 14:
        return updateMemoComponent(
          current,
          workInProgress,
          workInProgress.type as RR.MemoType,
          workInProgress.pendingProps,
          renderLanes
        );
      case 15:
        return updateSimpleMemoComponent(
          current,
          workInProgress,
          workInProgress.type as RR.FunctionComponent,
          workInProgress.pendingProps,
          renderLanes
        );
      case 19:
        return updateSuspenseListComponent(
          current,
          workInProgress,
          renderLanes
        );
      case 31:
        return updateActivityComponent(current, workInProgress, renderLanes);
      case 22:
        return updateOffscreenComponent(
          current,
          workInProgress,
          renderLanes,
          workInProgress.pendingProps
        );
      case 24:
        return (
          prepareToReadContext(workInProgress),
          (props = readContext(CacheContext)),
          null === current
            ? (($$typeof = peekCacheFromPool()),
              null === $$typeof &&
                (($$typeof = workInProgressRoot!),
                (nextProps$asFreshCache = createCache()),
                ($$typeof.pooledCache = nextProps$asFreshCache),
                nextProps$asFreshCache.refCount++,
                null !== nextProps$asFreshCache &&
                  ($$typeof.pooledCacheLanes |= renderLanes),
                ($$typeof = nextProps$asFreshCache)),
              (workInProgress.memoizedState = {
                parent: props,
                cache: $$typeof
              } as RR.CacheComponentState),
              initializeUpdateQueue(workInProgress),
              pushProvider(workInProgress, CacheContext, $$typeof))
            : (0 !== (current.lanes & renderLanes) &&
                (cloneUpdateQueue(current, workInProgress),
                processUpdateQueue(workInProgress, null, null, renderLanes),
                suspendIfUpdateReadFromEntangledAsyncAction()),
              ($$typeof = current.memoizedState as RR.CacheComponentState),
              (nextProps$asState = workInProgress.memoizedState),
              $$typeof.parent !== props
                ? (($$typeof = { parent: props, cache: props } as RR.CacheComponentState),
                  (workInProgress.memoizedState = $$typeof),
                  0 === workInProgress.lanes &&
                    (workInProgress.memoizedState =
                      (workInProgress.updateQueue as RR.UpdateQueue).baseState =
                        $$typeof),
                  pushProvider(workInProgress, CacheContext, props))
                : ((props = (nextProps$asState as RR.CacheComponentState).cache),
                  pushProvider(workInProgress, CacheContext, props),
                  props !== $$typeof.cache &&
                    propagateContextChanges(
                      workInProgress,
                      [CacheContext],
                      renderLanes,
                      !0
                    ))),
          reconcileChildren(
            current,
            workInProgress,
            workInProgress.pendingProps.children,
            renderLanes
          ),
          workInProgress.child
        );
      case 29:
        throw workInProgress.pendingProps;
    }
    throw Error(formatProdErrorMessage(156, workInProgress.tag));
  }
  function markUpdate(workInProgress: RR.Fiber): void {
    workInProgress.flags |= 4;
  }
  function markCloned(workInProgress: RR.Fiber): void {
    supportsPersistence && (workInProgress.flags |= 8);
  }
  function doesRequireClone(current: RR.Fiber | null, completedWork: RR.Fiber): boolean {
    if (null !== current && current.child === completedWork.child) return !1;
    if (0 !== (completedWork.flags & 16)) return !0;
    for (current = completedWork.child; null !== current; ) {
      if (0 !== (current.flags & 8218) || 0 !== (current.subtreeFlags & 8218))
        return !0;
      current = current.sibling;
    }
    return !1;
  }
  function appendAllChildren(
    parent: RR.Instance,
    workInProgress: RR.Fiber,
    needsVisibilityToggle: boolean,
    isHidden: boolean
  ): void { var needsVisibilityToggle$asNode: RR.Fiber | null, instance$asChild: RR.Fiber | null;
    if (supportsMutation)
      for (
        needsVisibilityToggle$asNode = workInProgress.child;
        null !== needsVisibilityToggle$asNode;

      ) {
        if (5 === needsVisibilityToggle$asNode.tag || 6 === needsVisibilityToggle$asNode.tag)
          appendInitialChild(parent, needsVisibilityToggle$asNode.stateNode);
        else if (
          !(
            4 === needsVisibilityToggle$asNode.tag ||
            (supportsSingletons && 27 === needsVisibilityToggle$asNode.tag)
          ) &&
          null !== needsVisibilityToggle$asNode.child
        ) {
          needsVisibilityToggle$asNode.child.return = needsVisibilityToggle$asNode;
          needsVisibilityToggle$asNode = needsVisibilityToggle$asNode.child;
          continue;
        }
        if (needsVisibilityToggle$asNode === workInProgress) break;
        for (; null === needsVisibilityToggle$asNode.sibling; ) {
          if (
            null === needsVisibilityToggle$asNode.return ||
            needsVisibilityToggle$asNode.return === workInProgress
          )
            return;
          needsVisibilityToggle$asNode = needsVisibilityToggle$asNode.return;
        }
        needsVisibilityToggle$asNode.sibling.return = needsVisibilityToggle$asNode.return;
        needsVisibilityToggle$asNode = needsVisibilityToggle$asNode.sibling;
      }
    else if (supportsPersistence)
      for (var node$85 = workInProgress.child; null !== node$85; ) {
        if (5 === node$85.tag) {
          var instance: RR.StateNode = node$85.stateNode;
          needsVisibilityToggle &&
            isHidden &&
            (instance = cloneHiddenInstance!(
              instance,
              node$85.type,
              node$85.memoizedProps
            ));
          appendInitialChild(parent, instance);
        } else if (6 === node$85.tag)
          (instance = node$85.stateNode),
            needsVisibilityToggle &&
              isHidden &&
              (instance = cloneHiddenTextInstance!(
                instance,
                node$85.memoizedProps
              )),
            appendInitialChild(parent, instance);
        else if (4 !== node$85.tag)
          if (22 === node$85.tag && null !== node$85.memoizedState)
            (instance$asChild = node$85.child),
              null !== instance$asChild && (instance$asChild.return = node$85),
              appendAllChildren(parent, node$85, !0, !0);
          else if (null !== node$85.child) {
            node$85.child.return = node$85;
            node$85 = node$85.child;
            continue;
          }
        if (node$85 === workInProgress) break;
        for (; null === node$85.sibling; ) {
          if (null === node$85.return || node$85.return === workInProgress)
            return;
          node$85 = node$85.return;
        }
        node$85.sibling.return = node$85.return;
        node$85 = node$85.sibling;
      }
  }
  function appendAllChildrenToContainer(
    containerChildSet: RR.ChildSet,
    workInProgress: RR.Fiber,
    needsVisibilityToggle: boolean,
    isHidden: boolean
  ): boolean { var hasOffscreenComponentChild$asChild: RR.Fiber | null;
    var hasOffscreenComponentChild: boolean = !1;
    if (supportsPersistence)
      for (var node = workInProgress.child; null !== node; ) {
        if (5 === node.tag) {
          var instance: RR.StateNode = node.stateNode;
          needsVisibilityToggle &&
            isHidden &&
            (instance = cloneHiddenInstance!(
              instance,
              node.type,
              node.memoizedProps
            ));
          appendChildToContainerChildSet!(containerChildSet, instance);
        } else if (6 === node.tag)
          (instance = node.stateNode),
            needsVisibilityToggle &&
              isHidden &&
              (instance = cloneHiddenTextInstance!(
                instance,
                node.memoizedProps
              )),
            appendChildToContainerChildSet!(containerChildSet, instance);
        else if (4 !== node.tag)
          if (22 === node.tag && null !== node.memoizedState)
            (hasOffscreenComponentChild$asChild = node.child),
              null !== hasOffscreenComponentChild$asChild &&
                (hasOffscreenComponentChild$asChild.return = node),
              appendAllChildrenToContainer(containerChildSet, node, !0, !0),
              (hasOffscreenComponentChild = !0);
          else if (null !== node.child) {
            node.child.return = node;
            node = node.child;
            continue;
          }
        if (node === workInProgress) break;
        for (; null === node.sibling; ) {
          if (null === node.return || node.return === workInProgress)
            return hasOffscreenComponentChild;
          node = node.return;
        }
        node.sibling.return = node.return;
        node = node.sibling;
      }
    return hasOffscreenComponentChild;
  }
  function updateHostContainer(current: RR.Fiber | null, workInProgress: RR.Fiber): void { var current$asHolder: RR.FiberRoot | RR.PortalState;
    if (supportsPersistence && doesRequireClone(current, workInProgress)) {
      current$asHolder = workInProgress.stateNode as RR.FiberRoot | RR.PortalState;
      var container = current$asHolder.containerInfo,
        newChildSet = createContainerChildSet!();
      appendAllChildrenToContainer(newChildSet, workInProgress, !1, !1);
      current$asHolder.pendingChildren = newChildSet;
      markUpdate(workInProgress);
      finalizeContainerChildren!(container, newChildSet);
    }
  }
  function updateHostComponent(current: RR.Fiber, workInProgress: RR.Fiber, type: RR.HostType, newProps: RR.PropsArg): void { var current$asRequiresClone: boolean, oldProps$88$asInstance: RR.Instance;
    if (supportsMutation)
      current.memoizedProps !== newProps && markUpdate(workInProgress);
    else if (supportsPersistence) {
      var currentInstance = current.stateNode,
        oldProps$88: RR.Props = current.memoizedProps;
      if (
        (current$asRequiresClone = doesRequireClone(current, workInProgress)) ||
        oldProps$88 !== newProps
      ) {
        var currentHostContext = contextStackCursor.current;
        oldProps$88$asInstance = cloneInstance!(
          currentInstance,
          type,
          oldProps$88,
          newProps,
          !current$asRequiresClone,
          null
        );
        oldProps$88$asInstance === currentInstance
          ? (workInProgress.stateNode = currentInstance)
          : (markCloned(workInProgress),
            finalizeInitialChildren(
              oldProps$88$asInstance,
              type,
              newProps,
              currentHostContext
            ) && markUpdate(workInProgress),
            (workInProgress.stateNode = oldProps$88$asInstance),
            current$asRequiresClone && appendAllChildren(oldProps$88$asInstance, workInProgress, !1, !1));
      } else workInProgress.stateNode = currentInstance;
    }
  }
  function preloadInstanceAndSuspendIfNeeded(
    workInProgress: RR.Fiber,
    type: RR.HostType,
    oldProps: RR.PropsArg,
    newProps: RR.PropsArg,
    renderLanes: RR.Lanes
  ): void {
    if (
      0 !== (workInProgress.mode & 32) &&
      (null === oldProps
        ? maySuspendCommit(type, newProps)
        : maySuspendCommitOnUpdate!(type, oldProps, newProps))
    ) {
      if (
        ((workInProgress.flags |= 16777216),
        (renderLanes & 335544128) === renderLanes ||
          maySuspendCommitInSyncRender!(type, newProps))
      )
        if (preloadInstance(workInProgress.stateNode, type, newProps))
          workInProgress.flags |= 8192;
        else if (shouldRemainOnPreviousScreen()) workInProgress.flags |= 8192;
        else
          throw (
            ((suspendedThenable = noopSuspenseyCommitThenable),
            SuspenseyCommitException)
          );
    } else workInProgress.flags &= -16777217;
  }
  function preloadResourceAndSuspendIfNeeded(workInProgress: RR.Fiber, resource: RR.ResourceArg): void {
    if (mayResourceSuspendCommit!(resource)) {
      if (((workInProgress.flags |= 16777216), !preloadResource!(resource)))
        if (shouldRemainOnPreviousScreen()) workInProgress.flags |= 8192;
        else
          throw (
            ((suspendedThenable = noopSuspenseyCommitThenable),
            SuspenseyCommitException)
          );
    } else workInProgress.flags &= -16777217;
  }
  function scheduleRetryEffect(workInProgress: RR.Fiber, retryQueue: RR.FiberUpdateQueue): void { var retryQueue$asLane: RR.Lane;
    null !== retryQueue && (workInProgress.flags |= 4);
    workInProgress.flags & 16384 &&
      ((retryQueue$asLane =
        22 !== workInProgress.tag ? claimNextRetryLane() : 536870912),
      (workInProgress.lanes |= retryQueue$asLane),
      (workInProgressSuspendedRetryLanes |= retryQueue$asLane));
  }
  function cutOffTailIfNeeded(renderState: RR.SuspenseListRenderState, hasRenderedATailFallback: boolean): void { var hasRenderedATailFallback$asTailNode: RR.Fiber | null;
    if (!isHydrating)
      switch (renderState.tailMode) {
        case "hidden":
          hasRenderedATailFallback$asTailNode = renderState.tail;
          for (var lastTailNode: RR.Fiber | null = null; null !== hasRenderedATailFallback$asTailNode; )
            null !== hasRenderedATailFallback$asTailNode.alternate &&
              (lastTailNode = hasRenderedATailFallback$asTailNode),
              (hasRenderedATailFallback$asTailNode = hasRenderedATailFallback$asTailNode.sibling);
          null === lastTailNode
            ? (renderState.tail = null)
            : (lastTailNode.sibling = null);
          break;
        case "collapsed":
          lastTailNode = renderState.tail;
          for (var lastTailNode$90: RR.Fiber | null = null; null !== lastTailNode; )
            null !== lastTailNode.alternate && (lastTailNode$90 = lastTailNode),
              (lastTailNode = lastTailNode.sibling);
          null === lastTailNode$90
            ? hasRenderedATailFallback || null === renderState.tail
              ? (renderState.tail = null)
              : (renderState.tail.sibling = null)
            : (lastTailNode$90.sibling = null);
      }
  }
  function bubbleProperties(completedWork: RR.Fiber): boolean {
    var didBailout =
        null !== completedWork.alternate &&
        completedWork.alternate.child === completedWork.child,
      newChildLanes: RR.Lanes = 0,
      subtreeFlags: RR.Flags = 0;
    if (didBailout)
      for (var child$91 = completedWork.child; null !== child$91; )
        (newChildLanes |= child$91.lanes | child$91.childLanes),
          (subtreeFlags |= child$91.subtreeFlags & 65011712),
          (subtreeFlags |= child$91.flags & 65011712),
          (child$91.return = completedWork),
          (child$91 = child$91.sibling);
    else
      for (child$91 = completedWork.child; null !== child$91; )
        (newChildLanes |= child$91.lanes | child$91.childLanes),
          (subtreeFlags |= child$91.subtreeFlags),
          (subtreeFlags |= child$91.flags),
          (child$91.return = completedWork),
          (child$91 = child$91.sibling);
    completedWork.subtreeFlags |= subtreeFlags;
    completedWork.childLanes = newChildLanes;
    return didBailout;
  }
  function completeWork(current$given: RR.Fiber | null, workInProgress: RR.Fiber, renderLanes$given: RR.Lanes): RR.Fiber | null { var current, renderLanes; current = current$given; renderLanes = renderLanes$given; var nextResource$asOldProps: RR.Props, nextResource$asHostContext: RR.HostContext, nextResource$asCache: RR.Cache | null, nextResource$asRendered: RR.Fiber | null, nextResource$asSuspended: RR.Fiber | null, newProps$asCache: RR.Cache | null, newProps$asHydrated: boolean, newProps$asState: RR.SuspenseState | null, newProps$asChild: RR.Fiber, newProps$asRenderState: RR.SuspenseListRenderState | null, newProps$asHidden: boolean, type$asParent: RR.Fiber | null, type$asFlag: boolean, type$asState: RR.SuspenseState | null, type$asDehydrated: RR.SuspenseInstance | null, type$asErrors: RR.CapturedValue[] | null, type$asCache: RR.Cache | null;
    var newProps: RR.PropsInUnion = workInProgress.pendingProps;
    popTreeContext(workInProgress);
    switch (workInProgress.tag) {
      case 16:
      case 15:
      case 0:
      case 11:
      case 7:
      case 8:
      case 12:
      case 9:
      case 14:
        return bubbleProperties(workInProgress), null;
      case 1:
        return bubbleProperties(workInProgress), null;
      case 3:
        renderLanes = workInProgress.stateNode as RR.FiberRoot;
        newProps$asCache = null;
        null !== current && (newProps$asCache = (current.memoizedState as RR.RootState).cache);
        (workInProgress.memoizedState as RR.RootState).cache !== newProps$asCache &&
          (workInProgress.flags |= 2048);
        popProvider(CacheContext);
        popHostContainer();
        renderLanes.pendingContext &&
          ((renderLanes.context = renderLanes.pendingContext),
          (renderLanes.pendingContext = null));
        if (null === current || null === current.child)
          popHydrationState(workInProgress)
            ? markUpdate(workInProgress)
            : null === current ||
              ((current.memoizedState as RR.RootState).isDehydrated &&
                0 === (workInProgress.flags & 256)) ||
              ((workInProgress.flags |= 1024),
              upgradeHydrationErrorsToRecoverable());
        updateHostContainer(current, workInProgress);
        bubbleProperties(workInProgress);
        return null;
      case 26:
        if (supportsResources) {
          var type: RR.ElementType = workInProgress.type,
            nextResource: RR.MemoizedState = workInProgress.memoizedState;
          null === current
            ? (markUpdate(workInProgress),
              null !== nextResource
                ? (bubbleProperties(workInProgress),
                  preloadResourceAndSuspendIfNeeded(
                    workInProgress,
                    nextResource
                  ))
                : (bubbleProperties(workInProgress),
                  preloadInstanceAndSuspendIfNeeded(
                    workInProgress,
                    type,
                    null,
                    newProps,
                    renderLanes as RR.Lanes
                  )))
            : nextResource
              ? nextResource !== current.memoizedState
                ? (markUpdate(workInProgress),
                  bubbleProperties(workInProgress),
                  preloadResourceAndSuspendIfNeeded(
                    workInProgress,
                    nextResource
                  ))
                : (bubbleProperties(workInProgress),
                  (workInProgress.flags &= -16777217))
              : ((nextResource$asOldProps = current.memoizedProps),
                supportsMutation
                  ? nextResource$asOldProps !== newProps && markUpdate(workInProgress)
                  : updateHostComponent(
                      current,
                      workInProgress,
                      type,
                      newProps
                    ),
                bubbleProperties(workInProgress),
                preloadInstanceAndSuspendIfNeeded(
                  workInProgress,
                  type,
                  nextResource$asOldProps,
                  newProps,
                  renderLanes as RR.Lanes
                ));
          return null;
        }
      case 27:
        if (supportsSingletons) {
          popHostContext(workInProgress);
          renderLanes = rootInstanceStackCursor.current;
          type = workInProgress.type;
          if (null !== current && null != workInProgress.stateNode)
            supportsMutation
              ? current.memoizedProps !== newProps && markUpdate(workInProgress)
              : updateHostComponent(current, workInProgress, type, newProps);
          else {
            if (!newProps) {
              if (null === workInProgress.stateNode)
                throw Error(formatProdErrorMessage(166));
              bubbleProperties(workInProgress);
              return null;
            }
            current = contextStackCursor.current;
            popHydrationState(workInProgress)
              ? prepareToHydrateHostInstance(workInProgress, current)
              : ((current = resolveSingletonInstance!(
                  type,
                  newProps,
                  renderLanes,
                  current,
                  !0
                )),
                (workInProgress.stateNode = current),
                markUpdate(workInProgress));
          }
          bubbleProperties(workInProgress);
          return null;
        }
      case 5:
        popHostContext(workInProgress);
        type = workInProgress.type;
        if (null !== current && null != workInProgress.stateNode)
          updateHostComponent(current, workInProgress, type, newProps);
        else {
          if (!newProps) {
            if (null === workInProgress.stateNode)
              throw Error(formatProdErrorMessage(166));
            bubbleProperties(workInProgress);
            return null;
          }
          nextResource$asHostContext = contextStackCursor.current;
          if (popHydrationState(workInProgress))
            prepareToHydrateHostInstance(workInProgress, nextResource$asHostContext),
              finalizeHydratedChildren!(
                workInProgress.stateNode,
                type,
                newProps,
                nextResource$asHostContext
              ) && (workInProgress.flags |= 64);
          else {
            var instance$101 = createInstance(
              type,
              newProps,
              rootInstanceStackCursor.current,
              nextResource$asHostContext,
              workInProgress
            );
            markCloned(workInProgress);
            appendAllChildren(instance$101, workInProgress, !1, !1);
            workInProgress.stateNode = instance$101;
            finalizeInitialChildren(
              instance$101,
              type,
              newProps,
              nextResource$asHostContext
            ) && markUpdate(workInProgress);
          }
        }
        bubbleProperties(workInProgress);
        preloadInstanceAndSuspendIfNeeded(
          workInProgress,
          workInProgress.type,
          null === current ? null : current.memoizedProps,
          workInProgress.pendingProps,
          renderLanes as RR.Lanes
        );
        return null;
      case 6:
        if (current && null != workInProgress.stateNode)
          (renderLanes = current.memoizedProps),
            supportsMutation
              ? renderLanes !== newProps && markUpdate(workInProgress)
              : supportsPersistence &&
                (renderLanes !== newProps
                  ? ((current = rootInstanceStackCursor.current),
                    (renderLanes = contextStackCursor.current),
                    markCloned(workInProgress),
                    (workInProgress.stateNode = createTextInstance(
                      newProps as string,
                      current,
                      renderLanes,
                      workInProgress
                    )))
                  : (workInProgress.stateNode = current.stateNode));
        else {
          if ("string" !== typeof newProps && null === workInProgress.stateNode)
            throw Error(formatProdErrorMessage(166));
          current = rootInstanceStackCursor.current;
          renderLanes = contextStackCursor.current;
          if (popHydrationState(workInProgress)) {
            if (!supportsHydration) throw Error(formatProdErrorMessage(176));
            current = workInProgress.stateNode as RR.TextInstance;
            renderLanes = workInProgress.memoizedProps as string;
            newProps = null;
            type$asParent = hydrationParentFiber;
            if (null !== type$asParent)
              switch (type$asParent.tag) {
                case 27:
                case 5:
                  newProps = type$asParent.memoizedProps;
              }
            hydrateTextInstance!(
              current,
              renderLanes,
              workInProgress,
              newProps
            ) || throwOnHydrationMismatch(workInProgress, !0);
          } else
            markCloned(workInProgress),
              (workInProgress.stateNode = createTextInstance(
                newProps as string,
                current,
                renderLanes,
                workInProgress
              ));
        }
        bubbleProperties(workInProgress);
        return null;
      case 31:
        renderLanes = workInProgress.memoizedState;
        if (null === current || null !== current.memoizedState) {
          newProps$asHydrated = popHydrationState(workInProgress);
          if (null !== renderLanes) {
            if (null === current) {
              if (!newProps$asHydrated) throw Error(formatProdErrorMessage(318));
              if (!supportsHydration) throw Error(formatProdErrorMessage(556));
              current = workInProgress.memoizedState as RR.ActivityState | null;
              current = null !== current ? current.dehydrated : null;
              if (!current) throw Error(formatProdErrorMessage(557));
              hydrateActivityInstance!(current, workInProgress);
            } else
              resetHydrationState(),
                0 === (workInProgress.flags & 128) &&
                  (workInProgress.memoizedState = null),
                (workInProgress.flags |= 4);
            bubbleProperties(workInProgress);
            current = !1;
          } else
            (renderLanes = upgradeHydrationErrorsToRecoverable()),
              null !== current &&
                null !== current.memoizedState &&
                ((current.memoizedState as RR.ActivityState).hydrationErrors = renderLanes),
              (current = !0);
          if (!current) {
            if (workInProgress.flags & 256)
              return popSuspenseHandler(workInProgress), workInProgress;
            popSuspenseHandler(workInProgress);
            return null;
          }
          if (0 !== (workInProgress.flags & 128))
            throw Error(formatProdErrorMessage(558));
        }
        bubbleProperties(workInProgress);
        return null;
      case 13:
        newProps$asState = workInProgress.memoizedState as RR.SuspenseState | null;
        if (
          null === current ||
          (null !== current.memoizedState &&
            null !== (current.memoizedState as RR.SuspenseState).dehydrated)
        ) {
          type$asFlag = popHydrationState(workInProgress);
          if (null !== newProps$asState && null !== newProps$asState.dehydrated) {
            if (null === current) {
              if (!type$asFlag) throw Error(formatProdErrorMessage(318));
              if (!supportsHydration) throw Error(formatProdErrorMessage(344));
              type$asState = workInProgress.memoizedState as RR.SuspenseState | null;
              type$asDehydrated = null !== type$asState ? type$asState.dehydrated : null;
              if (!type$asDehydrated) throw Error(formatProdErrorMessage(317));
              hydrateSuspenseInstance!(type$asDehydrated, workInProgress);
            } else
              resetHydrationState(),
                0 === (workInProgress.flags & 128) &&
                  (workInProgress.memoizedState = null),
                (workInProgress.flags |= 4);
            bubbleProperties(workInProgress);
            type$asFlag = !1;
          } else
            (type$asErrors = upgradeHydrationErrorsToRecoverable()),
              null !== current &&
                null !== current.memoizedState &&
                ((current.memoizedState as RR.SuspenseState).hydrationErrors = type$asErrors),
              (type$asFlag = !0);
          if (!type$asFlag) {
            if (workInProgress.flags & 256)
              return popSuspenseHandler(workInProgress), workInProgress;
            popSuspenseHandler(workInProgress);
            return null;
          }
        }
        popSuspenseHandler(workInProgress);
        if (0 !== (workInProgress.flags & 128))
          return (workInProgress.lanes = renderLanes as RR.Lanes), workInProgress;
        renderLanes = null !== newProps$asState;
        current = null !== current && null !== current.memoizedState;
        renderLanes &&
          ((newProps$asChild = workInProgress.child!),
          (type$asCache = null),
          null !== newProps$asChild.alternate &&
            null !== newProps$asChild.alternate.memoizedState &&
            null !== (newProps$asChild.alternate.memoizedState as RR.OffscreenState).cachePool &&
            (type$asCache = (newProps$asChild.alternate.memoizedState as RR.OffscreenState).cachePool!.pool),
          (nextResource$asCache = null),
          null !== newProps$asChild.memoizedState &&
            null !== (newProps$asChild.memoizedState as RR.OffscreenState).cachePool &&
            (nextResource$asCache = (newProps$asChild.memoizedState as RR.OffscreenState).cachePool!.pool),
          nextResource$asCache !== type$asCache && (newProps$asChild.flags |= 2048));
        renderLanes !== current &&
          renderLanes &&
          (workInProgress.child!.flags |= 8192);
        scheduleRetryEffect(workInProgress, workInProgress.updateQueue);
        bubbleProperties(workInProgress);
        return null;
      case 4:
        return (
          popHostContainer(),
          updateHostContainer(current, workInProgress),
          null === current &&
            preparePortalMount((workInProgress.stateNode as RR.PortalState).containerInfo),
          bubbleProperties(workInProgress),
          null
        );
      case 10:
        return (
          popProvider(workInProgress.type as RR.ReactContext),
          bubbleProperties(workInProgress),
          null
        );
      case 19:
        pop(suspenseStackCursor);
        newProps$asRenderState = workInProgress.memoizedState as RR.SuspenseListRenderState | null;
        if (null === newProps$asRenderState) return bubbleProperties(workInProgress), null;
        type$asFlag = 0 !== (workInProgress.flags & 128);
        nextResource$asRendered = newProps$asRenderState.rendering;
        if (null === nextResource$asRendered)
          if (type$asFlag) cutOffTailIfNeeded(newProps$asRenderState, !1);
          else {
            if (
              0 !== workInProgressRootExitStatus ||
              (null !== current && 0 !== (current.flags & 128))
            )
              for (current = workInProgress.child; null !== current; ) {
                nextResource$asSuspended = findFirstSuspended(current);
                if (null !== nextResource$asSuspended) {
                  workInProgress.flags |= 128;
                  cutOffTailIfNeeded(newProps$asRenderState, !1);
                  current = nextResource$asSuspended.updateQueue;
                  workInProgress.updateQueue = current;
                  scheduleRetryEffect(workInProgress, current);
                  workInProgress.subtreeFlags = 0;
                  current = renderLanes;
                  for (
                    renderLanes = workInProgress.child;
                    null !== renderLanes;

                  )
                    resetWorkInProgress(renderLanes, current as RR.Lanes),
                      (renderLanes = renderLanes.sibling);
                  push(
                    suspenseStackCursor,
                    (suspenseStackCursor.current & 1) | 2
                  );
                  isHydrating &&
                    pushTreeFork(workInProgress, newProps$asRenderState.treeForkCount);
                  return workInProgress.child;
                }
                current = current.sibling;
              }
            null !== newProps$asRenderState.tail &&
              now() > workInProgressRootRenderTargetTime &&
              ((workInProgress.flags |= 128),
              (type$asFlag = !0),
              cutOffTailIfNeeded(newProps$asRenderState, !1),
              (workInProgress.lanes = 4194304));
          }
        else {
          if (!type$asFlag)
            if (
              ((current = findFirstSuspended(nextResource$asRendered)), null !== current)
            ) {
              if (
                ((workInProgress.flags |= 128),
                (type$asFlag = !0),
                (current = current.updateQueue),
                (workInProgress.updateQueue = current),
                scheduleRetryEffect(workInProgress, current),
                cutOffTailIfNeeded(newProps$asRenderState, !0),
                null === newProps$asRenderState.tail &&
                  "hidden" === newProps$asRenderState.tailMode &&
                  !nextResource$asRendered.alternate &&
                  !isHydrating)
              )
                return bubbleProperties(workInProgress), null;
            } else
              2 * now() - newProps$asRenderState.renderingStartTime >
                workInProgressRootRenderTargetTime &&
                536870912 !== renderLanes &&
                ((workInProgress.flags |= 128),
                (type$asFlag = !0),
                cutOffTailIfNeeded(newProps$asRenderState, !1),
                (workInProgress.lanes = 4194304));
          newProps$asRenderState.isBackwards
            ? ((nextResource$asRendered.sibling = workInProgress.child),
              (workInProgress.child = nextResource$asRendered))
            : ((current = newProps$asRenderState.last),
              null !== current
                ? (current.sibling = nextResource$asRendered)
                : (workInProgress.child = nextResource$asRendered),
              (newProps$asRenderState.last = nextResource$asRendered));
        }
        if (null !== newProps$asRenderState.tail)
          return (
            (current = newProps$asRenderState.tail),
            (newProps$asRenderState.rendering = current),
            (newProps$asRenderState.tail = current.sibling),
            (newProps$asRenderState.renderingStartTime = now()),
            (current.sibling = null),
            (renderLanes = suspenseStackCursor.current),
            push(
              suspenseStackCursor,
              type$asFlag ? (renderLanes & 1) | 2 : renderLanes & 1
            ),
            isHydrating && pushTreeFork(workInProgress, newProps$asRenderState.treeForkCount),
            current
          );
        bubbleProperties(workInProgress);
        return null;
      case 22:
      case 23:
        return (
          popSuspenseHandler(workInProgress),
          popHiddenContext(),
          (newProps$asHidden = null !== workInProgress.memoizedState),
          null !== current
            ? (null !== current.memoizedState) !== newProps$asHidden &&
              (workInProgress.flags |= 8192)
            : newProps$asHidden && (workInProgress.flags |= 8192),
          newProps$asHidden
            ? 0 !== (renderLanes & 536870912) &&
              0 === (workInProgress.flags & 128) &&
              (bubbleProperties(workInProgress),
              workInProgress.subtreeFlags & 6 && (workInProgress.flags |= 8192))
            : bubbleProperties(workInProgress),
          (renderLanes = workInProgress.updateQueue as RR.OffscreenQueue | null),
          null !== renderLanes &&
            scheduleRetryEffect(workInProgress, renderLanes.retryQueue),
          (renderLanes = null),
          null !== current &&
            null !== current.memoizedState &&
            null !== (current.memoizedState as RR.OffscreenState).cachePool &&
            (renderLanes = (current.memoizedState as RR.OffscreenState).cachePool!.pool),
          (newProps$asCache = null),
          null !== workInProgress.memoizedState &&
            null !== (workInProgress.memoizedState as RR.OffscreenState).cachePool &&
            (newProps$asCache = (workInProgress.memoizedState as RR.OffscreenState).cachePool!.pool),
          newProps$asCache !== renderLanes && (workInProgress.flags |= 2048),
          null !== current && pop(resumedCache),
          null
        );
      case 24:
        return (
          (renderLanes = null),
          null !== current && (renderLanes = (current.memoizedState as RR.CacheComponentState).cache),
          (workInProgress.memoizedState as RR.CacheComponentState).cache !== renderLanes &&
            (workInProgress.flags |= 2048),
          popProvider(CacheContext),
          bubbleProperties(workInProgress),
          null
        );
      case 25:
        return null;
      case 30:
        return null;
    }
    throw Error(formatProdErrorMessage(156, workInProgress.tag));
  }
  function unwindWork(current: RR.Fiber | null, workInProgress: RR.Fiber): RR.Fiber | null { var current$asFlags: RR.Flags, current$asState: RR.SuspenseState | null;
    popTreeContext(workInProgress);
    switch (workInProgress.tag) {
      case 1:
        return (
          (current$asFlags = workInProgress.flags),
          current$asFlags & 65536
            ? ((workInProgress.flags = (current$asFlags & -65537) | 128),
              workInProgress)
            : null
        );
      case 3:
        return (
          popProvider(CacheContext),
          popHostContainer(),
          (current$asFlags = workInProgress.flags),
          0 !== (current$asFlags & 65536) && 0 === (current$asFlags & 128)
            ? ((workInProgress.flags = (current$asFlags & -65537) | 128),
              workInProgress)
            : null
        );
      case 26:
      case 27:
      case 5:
        return popHostContext(workInProgress), null;
      case 31:
        if (null !== workInProgress.memoizedState) {
          popSuspenseHandler(workInProgress);
          if (null === workInProgress.alternate)
            throw Error(formatProdErrorMessage(340));
          resetHydrationState();
        }
        current$asFlags = workInProgress.flags;
        return current$asFlags & 65536
          ? ((workInProgress.flags = (current$asFlags & -65537) | 128), workInProgress)
          : null;
      case 13:
        popSuspenseHandler(workInProgress);
        current$asState = workInProgress.memoizedState as RR.SuspenseState | null;
        if (null !== current$asState && null !== current$asState.dehydrated) {
          if (null === workInProgress.alternate)
            throw Error(formatProdErrorMessage(340));
          resetHydrationState();
        }
        current$asFlags = workInProgress.flags;
        return current$asFlags & 65536
          ? ((workInProgress.flags = (current$asFlags & -65537) | 128), workInProgress)
          : null;
      case 19:
        return pop(suspenseStackCursor), null;
      case 4:
        return popHostContainer(), null;
      case 10:
        return popProvider(workInProgress.type as RR.ReactContext), null;
      case 22:
      case 23:
        return (
          popSuspenseHandler(workInProgress),
          popHiddenContext(),
          null !== current && pop(resumedCache),
          (current$asFlags = workInProgress.flags),
          current$asFlags & 65536
            ? ((workInProgress.flags = (current$asFlags & -65537) | 128),
              workInProgress)
            : null
        );
      case 24:
        return popProvider(CacheContext), null;
      case 25:
        return null;
      default:
        return null;
    }
  }
  function unwindInterruptedWork(current: RR.Fiber | null, interruptedWork: RR.Fiber): void {
    popTreeContext(interruptedWork);
    switch (interruptedWork.tag) {
      case 3:
        popProvider(CacheContext);
        popHostContainer();
        break;
      case 26:
      case 27:
      case 5:
        popHostContext(interruptedWork);
        break;
      case 4:
        popHostContainer();
        break;
      case 31:
        null !== interruptedWork.memoizedState &&
          popSuspenseHandler(interruptedWork);
        break;
      case 13:
        popSuspenseHandler(interruptedWork);
        break;
      case 19:
        pop(suspenseStackCursor);
        break;
      case 10:
        popProvider(interruptedWork.type as RR.ReactContext);
        break;
      case 22:
      case 23:
        popSuspenseHandler(interruptedWork);
        popHiddenContext();
        null !== current && pop(resumedCache);
        break;
      case 24:
        popProvider(CacheContext);
    }
  }
  function commitHookEffectListMount(flags: RR.HookFlags, finishedWork: RR.Fiber): void { var updateQueue$asEffect: RR.Effect | null, lastEffect$asDestroy: RR.EffectDestroy | void;
    try {
      var updateQueue: RR.FunctionComponentUpdateQueue | null = finishedWork.updateQueue as RR.FunctionComponentUpdateQueue | null,
        lastEffect: RR.Effect | null = null !== updateQueue ? updateQueue.lastEffect : null;
      if (null !== lastEffect) {
        var firstEffect = lastEffect.next;
        updateQueue$asEffect = firstEffect;
        do {
          if ((updateQueue$asEffect!.tag & flags) === flags) {
            lastEffect$asDestroy = void 0;
            var create = updateQueue$asEffect!.create,
              inst = updateQueue$asEffect!.inst;
            lastEffect$asDestroy = create();
            inst.destroy = lastEffect$asDestroy;
          }
          updateQueue$asEffect = updateQueue$asEffect!.next;
        } while (updateQueue$asEffect !== firstEffect);
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
  function commitHookEffectListUnmount(
    flags: RR.HookFlags,
    finishedWork: RR.Fiber,
    nearestMountedAncestor$jscomp$0: RR.Fiber | null
  ): void { var updateQueue$asEffect: RR.Effect | null, lastEffect$asFiber: RR.Fiber;
    try {
      var updateQueue: RR.FunctionComponentUpdateQueue | null = finishedWork.updateQueue as RR.FunctionComponentUpdateQueue | null,
        lastEffect: RR.Effect | null = null !== updateQueue ? updateQueue.lastEffect : null;
      if (null !== lastEffect) {
        var firstEffect = lastEffect.next;
        updateQueue$asEffect = firstEffect;
        do {
          if ((updateQueue$asEffect!.tag & flags) === flags) {
            var inst = updateQueue$asEffect!.inst,
              destroy = inst.destroy;
            if (void 0 !== destroy) {
              inst.destroy = void 0;
              lastEffect$asFiber = finishedWork;
              var nearestMountedAncestor = nearestMountedAncestor$jscomp$0,
                destroy_ = destroy as RR.EffectDestroy;
              try {
                destroy_();
              } catch (error) {
                captureCommitPhaseError(
                  lastEffect$asFiber,
                  nearestMountedAncestor,
                  error
                );
              }
            }
          }
          updateQueue$asEffect = updateQueue$asEffect!.next;
        } while (updateQueue$asEffect !== firstEffect);
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
  function commitClassCallbacks(finishedWork: RR.Fiber): void {
    var updateQueue: RR.UpdateQueue | null = finishedWork.updateQueue as RR.UpdateQueue | null;
    if (null !== updateQueue) {
      var instance = finishedWork.stateNode;
      try {
        commitCallbacks(updateQueue, instance);
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
    }
  }
  function safelyCallComponentWillUnmount(
    current: RR.Fiber,
    nearestMountedAncestor: RR.Fiber | null,
    instance: RR.ClassInstance
  ): void {
    instance.props = resolveClassComponentProps(
      current.type as RR.ClassComponent,
      current.memoizedProps
    );
    instance.state = current.memoizedState;
    try {
      instance.componentWillUnmount!();
    } catch (error) {
      captureCommitPhaseError(current, nearestMountedAncestor, error);
    }
  }
  function safelyAttachRef(current: RR.Fiber, nearestMountedAncestor: RR.Fiber | null): void {
    try {
      var ref = current.ref;
      if (null !== ref) {
        switch (current.tag) {
          case 26:
          case 27:
          case 5:
            var instanceToUse: RR.StateNode = getPublicInstance(current.stateNode);
            break;
          case 30:
            instanceToUse = current.stateNode;
            break;
          default:
            instanceToUse = current.stateNode;
        }
        "function" === typeof ref
          ? (current.refCleanup = ref(instanceToUse))
          : (ref.current = instanceToUse);
      }
    } catch (error) {
      captureCommitPhaseError(current, nearestMountedAncestor, error);
    }
  }
  function safelyDetachRef(current: RR.Fiber, nearestMountedAncestor: RR.Fiber | null): void { var current$asAlternate: RR.Fiber | null;
    var ref = current.ref,
      refCleanup = current.refCleanup;
    if (null !== ref)
      if ("function" === typeof refCleanup)
        try {
          refCleanup();
        } catch (error) {
          captureCommitPhaseError(current, nearestMountedAncestor, error);
        } finally {
          (current.refCleanup = null),
            (current$asAlternate = current.alternate),
            null != current$asAlternate && (current$asAlternate.refCleanup = null);
        }
      else if ("function" === typeof ref)
        try {
          ref(null);
        } catch (error$124) {
          captureCommitPhaseError(current, nearestMountedAncestor, error$124);
        }
      else ref.current = null;
  }
  function commitHostMount(finishedWork: RR.Fiber): void {
    var type = finishedWork.type,
      props: RR.Props = finishedWork.memoizedProps,
      instance = finishedWork.stateNode;
    try {
      commitMount!(instance, type, props, finishedWork);
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
  function commitHostUpdate(finishedWork: RR.Fiber, newProps: RR.Props, oldProps: RR.Props): void {
    try {
      commitUpdate!(
        finishedWork.stateNode,
        finishedWork.type,
        oldProps,
        newProps,
        finishedWork
      );
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
  function isHostParent(fiber: RR.Fiber): boolean {
    return (
      5 === fiber.tag ||
      3 === fiber.tag ||
      (supportsResources ? 26 === fiber.tag : !1) ||
      (supportsSingletons
        ? 27 === fiber.tag && isSingletonScope!(fiber.type)
        : !1) ||
      4 === fiber.tag
    );
  }
  function getHostSibling(fiber: RR.Fiber): RR.StateNode {
    a: for (;;) {
      for (; null === fiber.sibling; ) {
        if (null === fiber.return || isHostParent(fiber.return)) return null;
        fiber = fiber.return;
      }
      fiber.sibling.return = fiber.return;
      for (
        fiber = fiber.sibling;
        5 !== fiber.tag && 6 !== fiber.tag && 18 !== fiber.tag;

      ) {
        if (
          supportsSingletons &&
          27 === fiber.tag &&
          isSingletonScope!(fiber.type)
        )
          continue a;
        if (fiber.flags & 2) continue a;
        if (null === fiber.child || 4 === fiber.tag) continue a;
        else (fiber.child.return = fiber), (fiber = fiber.child);
      }
      if (!(fiber.flags & 2)) return fiber.stateNode;
    }
  }
  function insertOrAppendPlacementNodeIntoContainer(node: RR.Fiber, before: RR.StateNode, parent: RR.StateNode): void { var node$asInstance: RR.StateNode, node$asChild: RR.Fiber | null;
    var tag = node.tag;
    if (5 === tag || 6 === tag)
      (node$asInstance = node.stateNode),
        before
          ? insertInContainerBefore!(parent, node$asInstance, before)
          : appendChildToContainer!(parent, node$asInstance);
    else if (
      4 !== tag &&
      (supportsSingletons &&
        27 === tag &&
        isSingletonScope!(node.type) &&
        ((parent = node.stateNode), (before = null)),
      (node$asChild = node.child),
      null !== node$asChild)
    )
      for (
        insertOrAppendPlacementNodeIntoContainer(node$asChild, before, parent),
          node$asChild = node$asChild.sibling;
        null !== node$asChild;

      )
        insertOrAppendPlacementNodeIntoContainer(node$asChild, before, parent),
          (node$asChild = node$asChild.sibling);
  }
  function insertOrAppendPlacementNode(node: RR.Fiber, before: RR.StateNode, parent: RR.StateNode): void { var node$asInstance: RR.StateNode, node$asChild: RR.Fiber | null;
    var tag = node.tag;
    if (5 === tag || 6 === tag)
      (node$asInstance = node.stateNode),
        before ? insertBefore!(parent, node$asInstance, before) : appendChild!(parent, node$asInstance);
    else if (
      4 !== tag &&
      (supportsSingletons &&
        27 === tag &&
        isSingletonScope!(node.type) &&
        (parent = node.stateNode),
      (node$asChild = node.child),
      null !== node$asChild)
    )
      for (
        insertOrAppendPlacementNode(node$asChild, before, parent), node$asChild = node$asChild.sibling;
        null !== node$asChild;

      )
        insertOrAppendPlacementNode(node$asChild, before, parent),
          (node$asChild = node$asChild.sibling);
  }
  function commitHostPortalContainerChildren(
    portal: RR.PortalState,
    finishedWork: RR.Fiber,
    pendingChildren: RR.ChildSet | null
  ): void { var portal$asContainer: RR.Container;
    portal$asContainer = portal.containerInfo;
    try {
      replaceContainerChildren!(portal$asContainer, pendingChildren);
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
  function commitHostSingletonAcquisition(finishedWork: RR.Fiber): void {
    var singleton = finishedWork.stateNode,
      props: RR.Props = finishedWork.memoizedProps;
    try {
      acquireSingletonInstance!(
        finishedWork.type,
        props,
        singleton,
        finishedWork
      );
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
  function commitBeforeMutationEffects(root: RR.FiberRoot, firstChild: RR.Fiber, committedLanes: RR.Lanes): void; function commitBeforeMutationEffects(root: RR.FiberRoot, firstChild: RR.Fiber): void { var root$asFiber: RR.Fiber, firstChild$asChild: RR.Fiber | null, firstChild$asFlags: RR.Flags, firstChild$asQueue: RR.FunctionComponentUpdateQueue | null, firstChild$asEvents: RR.EventFunctionPayload[] | null, firstChild$asSnapshot: RR.ClassInstance["__reactInternalSnapshotBeforeUpdate"], firstChild$asSibling: RR.Fiber | null, current$asState: RR.MemoizedState, ii$asFiber: RR.Fiber, _eventPayloads$ii$asProps: RR.Props;
    prepareForCommit(root.containerInfo);
    for (nextEffect = firstChild; null !== nextEffect; )
      if (
        ((root$asFiber = nextEffect),
        (firstChild$asChild = root$asFiber.child),
        0 !== (root$asFiber.subtreeFlags & 1028) && null !== firstChild$asChild)
      )
        (firstChild$asChild!.return = root$asFiber), (nextEffect = firstChild$asChild);
      else
        for (; null !== nextEffect; ) {
          root$asFiber = nextEffect;
          var current: RR.Fiber | null = root$asFiber.alternate;
          firstChild$asFlags = root$asFiber.flags;
          switch (root$asFiber.tag) {
            case 0:
              if (
                0 !== (firstChild$asFlags & 4) &&
                ((firstChild$asQueue = root$asFiber.updateQueue as RR.FunctionComponentUpdateQueue | null),
                (firstChild$asEvents = null !== firstChild$asQueue ? firstChild$asQueue.events : null),
                null !== firstChild$asEvents)
              )
                for (var ii: number = 0; ii < firstChild$asEvents.length; ii++) {
                  var _eventPayloads$ii: RR.EventFunctionPayload = firstChild$asEvents[ii];
                  _eventPayloads$ii.ref.impl = _eventPayloads$ii.nextImpl;
                }
              break;
            case 11:
            case 15:
              break;
            case 1:
              if (0 !== (firstChild$asFlags & 1024) && null !== current) {
                firstChild$asSnapshot = void 0;
                ii$asFiber = root$asFiber;
                _eventPayloads$ii$asProps = current.memoizedProps as RR.Props;
                current$asState = current.memoizedState;
                var instance: RR.ClassInstance = ii$asFiber.stateNode as RR.ClassInstance;
                try {
                  var resolvedPrevProps = resolveClassComponentProps(
                    ii$asFiber.type as RR.ClassComponent,
                    _eventPayloads$ii$asProps
                  );
                  firstChild$asSnapshot = instance.getSnapshotBeforeUpdate!(
                    resolvedPrevProps,
                    current$asState
                  );
                  instance.__reactInternalSnapshotBeforeUpdate = firstChild$asSnapshot;
                } catch (error) {
                  captureCommitPhaseError(ii$asFiber, ii$asFiber.return, error);
                }
              }
              break;
            case 3:
              0 !== (firstChild$asFlags & 1024) &&
                supportsMutation &&
                clearContainer!((root$asFiber.stateNode as RR.FiberRoot).containerInfo);
              break;
            case 5:
            case 26:
            case 27:
            case 6:
            case 4:
            case 17:
              break;
            default:
              if (0 !== (firstChild$asFlags & 1024))
                throw Error(formatProdErrorMessage(163));
          }
          firstChild$asSibling = root$asFiber.sibling;
          if (null !== firstChild$asSibling) {
            firstChild$asSibling.return = root$asFiber.return;
            nextEffect = firstChild$asSibling;
            break;
          }
          nextEffect = root$asFiber.return;
        }
  }
  function commitLayoutEffectOnFiber(finishedRoot: RR.FiberRoot, current: RR.Fiber | null, finishedWork: RR.Fiber): void { var finishedRoot$asInstance: RR.ClassInstance, finishedRoot$asChildInstance: RR.StateNode, finishedRoot$asType: RR.ElementType, current$asState: RR.MemoizedState, current$asProps: RR.Props, current$asWasHidden: boolean, finishedWork$asRetry: () => void, flags$asQueue: RR.UpdateQueue | null, flags$asState: RR.SuspenseState | null, flags$asDehydrated: RR.SuspenseInstance | null, flags$asIsHidden: boolean, prevProps$asInstance: RR.StateNode, prevProps$asPrevIsHidden: boolean;
    var flags: RR.Flags = finishedWork.flags;
    switch (finishedWork.tag) {
      case 0:
      case 11:
      case 15:
        recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
        flags & 4 && commitHookEffectListMount(5, finishedWork);
        break;
      case 1:
        recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
        if (flags & 4)
          if (((finishedRoot$asInstance = finishedWork.stateNode as RR.ClassInstance), null === current))
            try {
              finishedRoot$asInstance.componentDidMount!();
            } catch (error) {
              captureCommitPhaseError(finishedWork, finishedWork.return, error);
            }
          else {
            var prevProps: RR.Props = resolveClassComponentProps(
              finishedWork.type as RR.ClassComponent,
              current.memoizedProps
            );
            current$asState = current.memoizedState;
            try {
              finishedRoot$asInstance.componentDidUpdate!(
                prevProps,
                current$asState,
                finishedRoot$asInstance.__reactInternalSnapshotBeforeUpdate
              );
            } catch (error$123) {
              captureCommitPhaseError(
                finishedWork,
                finishedWork.return,
                error$123
              );
            }
          }
        flags & 64 && commitClassCallbacks(finishedWork);
        flags & 512 && safelyAttachRef(finishedWork, finishedWork.return);
        break;
      case 3:
        recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
        if (
          flags & 64 &&
          ((flags$asQueue = finishedWork.updateQueue as RR.UpdateQueue | null), null !== flags$asQueue)
        ) {
          finishedRoot$asChildInstance = null;
          if (null !== finishedWork.child)
            switch (finishedWork.child.tag) {
              case 27:
              case 5:
                finishedRoot$asChildInstance = getPublicInstance(finishedWork.child.stateNode);
                break;
              case 1:
                finishedRoot$asChildInstance = finishedWork.child.stateNode;
            }
          try {
            commitCallbacks(flags$asQueue, finishedRoot$asChildInstance);
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }
        break;
      case 27:
        supportsSingletons &&
          null === current &&
          flags & 4 &&
          commitHostSingletonAcquisition(finishedWork);
      case 26:
      case 5:
        recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
        if (null === current)
          if (flags & 4) commitHostMount(finishedWork);
          else if (flags & 64) {
            finishedRoot$asType = finishedWork.type;
            current$asProps = finishedWork.memoizedProps;
            prevProps$asInstance = finishedWork.stateNode;
            try {
              commitHydratedInstance!(
                prevProps$asInstance,
                finishedRoot$asType,
                current$asProps,
                finishedWork
              );
            } catch (error) {
              captureCommitPhaseError(finishedWork, finishedWork.return, error);
            }
          }
        flags & 512 && safelyAttachRef(finishedWork, finishedWork.return);
        break;
      case 12:
        recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
        break;
      case 31:
        recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
        flags & 4 &&
          commitActivityHydrationCallbacks(finishedRoot, finishedWork);
        break;
      case 13:
        recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
        flags & 4 &&
          commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
        flags & 64 &&
          ((flags$asState = finishedWork.memoizedState as RR.SuspenseState | null),
          null !== flags$asState &&
            ((flags$asDehydrated = flags$asState.dehydrated),
            null !== flags$asDehydrated &&
              ((finishedWork$asRetry = retryDehydratedSuspenseBoundary.bind(
                null,
                finishedWork
              )),
              registerSuspenseInstanceRetry!(flags$asDehydrated, finishedWork$asRetry))));
        break;
      case 22:
        flags$asIsHidden = null !== finishedWork.memoizedState || offscreenSubtreeIsHidden;
        if (!flags$asIsHidden) {
          current$asWasHidden =
            (null !== current && null !== current.memoizedState) ||
            offscreenSubtreeWasHidden;
          prevProps$asPrevIsHidden = offscreenSubtreeIsHidden;
          var prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
          offscreenSubtreeIsHidden = flags$asIsHidden;
          (offscreenSubtreeWasHidden = current$asWasHidden) &&
          !prevOffscreenSubtreeWasHidden
            ? recursivelyTraverseReappearLayoutEffects(
                finishedRoot,
                finishedWork,
                0 !== (finishedWork.subtreeFlags & 8772)
              )
            : recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
          offscreenSubtreeIsHidden = prevProps$asPrevIsHidden;
          offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
        }
        break;
      case 30:
        break;
      default:
        recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
    }
  }
  function detachFiberAfterEffects(fiber: RR.Fiber): void { var alternate$asInstance: RR.StateNode;
    var alternate: RR.Fiber | null = fiber.alternate;
    null !== alternate &&
      ((fiber.alternate = null), detachFiberAfterEffects(alternate));
    fiber.child = null;
    fiber.deletions = null;
    fiber.sibling = null;
    5 === fiber.tag &&
      ((alternate$asInstance = fiber.stateNode),
      null !== alternate$asInstance && detachDeletedInstance(alternate$asInstance));
    fiber.stateNode = null;
    fiber.return = null;
    fiber.dependencies = null;
    fiber.memoizedProps = null;
    fiber.memoizedState = null;
    fiber.pendingProps = null;
    fiber.stateNode = null;
    fiber.updateQueue = null;
  }
  function recursivelyTraverseDeletionEffects(
    finishedRoot: RR.FiberRoot,
    nearestMountedAncestor: RR.Fiber,
    parent: RR.Fiber
  ): void { var parent$asChild: RR.Fiber | null;
    for (parent$asChild = parent.child; null !== parent$asChild; )
      commitDeletionEffectsOnFiber(
        finishedRoot,
        nearestMountedAncestor,
        parent$asChild
      ),
        (parent$asChild = parent$asChild.sibling);
  }
  function commitDeletionEffectsOnFiber(
    finishedRoot: RR.FiberRoot,
    nearestMountedAncestor: RR.Fiber,
    deletedFiber: RR.Fiber
  ): void { var prevHostParent$asInstance: RR.ClassInstance, prevHostParent$asWasHidden: boolean;
    if (injectedHook && "function" === typeof injectedHook.onCommitFiberUnmount)
      try {
        injectedHook.onCommitFiberUnmount(rendererID, deletedFiber);
      } catch (err) {}
    switch (deletedFiber.tag) {
      case 26:
        if (supportsResources) {
          offscreenSubtreeWasHidden ||
            safelyDetachRef(deletedFiber, nearestMountedAncestor);
          recursivelyTraverseDeletionEffects(
            finishedRoot,
            nearestMountedAncestor,
            deletedFiber
          );
          deletedFiber.memoizedState
            ? releaseResource!(deletedFiber.memoizedState)
            : deletedFiber.stateNode &&
              unmountHoistable!(deletedFiber.stateNode);
          break;
        }
      case 27:
        if (supportsSingletons) {
          offscreenSubtreeWasHidden ||
            safelyDetachRef(deletedFiber, nearestMountedAncestor);
          var prevHostParent: RR.StateNode = hostParent,
            prevHostParentIsContainer: boolean = hostParentIsContainer;
          isSingletonScope!(deletedFiber.type) &&
            ((hostParent = deletedFiber.stateNode),
            (hostParentIsContainer = !1));
          recursivelyTraverseDeletionEffects(
            finishedRoot,
            nearestMountedAncestor,
            deletedFiber
          );
          releaseSingletonInstance!(deletedFiber.stateNode);
          hostParent = prevHostParent;
          hostParentIsContainer = prevHostParentIsContainer;
          break;
        }
      case 5:
        offscreenSubtreeWasHidden ||
          safelyDetachRef(deletedFiber, nearestMountedAncestor);
      case 6:
        if (supportsMutation) {
          if (
            ((prevHostParent = hostParent),
            (prevHostParentIsContainer = hostParentIsContainer),
            (hostParent = null),
            recursivelyTraverseDeletionEffects(
              finishedRoot,
              nearestMountedAncestor,
              deletedFiber
            ),
            (hostParent = prevHostParent),
            (hostParentIsContainer = prevHostParentIsContainer),
            null !== hostParent)
          )
            if (hostParentIsContainer)
              try {
                removeChildFromContainer!(hostParent, deletedFiber.stateNode);
              } catch (error) {
                captureCommitPhaseError(
                  deletedFiber,
                  nearestMountedAncestor,
                  error
                );
              }
            else
              try {
                removeChild!(hostParent, deletedFiber.stateNode);
              } catch (error) {
                captureCommitPhaseError(
                  deletedFiber,
                  nearestMountedAncestor,
                  error
                );
              }
        } else
          recursivelyTraverseDeletionEffects(
            finishedRoot,
            nearestMountedAncestor,
            deletedFiber
          );
        break;
      case 18:
        supportsMutation &&
          null !== hostParent &&
          (hostParentIsContainer
            ? clearSuspenseBoundaryFromContainer!(
                hostParent,
                deletedFiber.stateNode
              )
            : clearSuspenseBoundary!(hostParent, deletedFiber.stateNode));
        break;
      case 4:
        supportsMutation
          ? ((prevHostParent = hostParent),
            (prevHostParentIsContainer = hostParentIsContainer),
            (hostParent = (deletedFiber.stateNode as RR.PortalState).containerInfo),
            (hostParentIsContainer = !0),
            recursivelyTraverseDeletionEffects(
              finishedRoot,
              nearestMountedAncestor,
              deletedFiber
            ),
            (hostParent = prevHostParent),
            (hostParentIsContainer = prevHostParentIsContainer))
          : (supportsPersistence &&
              commitHostPortalContainerChildren(
                deletedFiber.stateNode as RR.PortalState,
                deletedFiber,
                createContainerChildSet!()
              ),
            recursivelyTraverseDeletionEffects(
              finishedRoot,
              nearestMountedAncestor,
              deletedFiber
            ));
        break;
      case 0:
      case 11:
      case 14:
      case 15:
        commitHookEffectListUnmount(2, deletedFiber, nearestMountedAncestor);
        offscreenSubtreeWasHidden ||
          commitHookEffectListUnmount(4, deletedFiber, nearestMountedAncestor);
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber
        );
        break;
      case 1:
        offscreenSubtreeWasHidden ||
          (safelyDetachRef(deletedFiber, nearestMountedAncestor),
          (prevHostParent$asInstance = deletedFiber.stateNode as RR.ClassInstance),
          "function" === typeof prevHostParent$asInstance.componentWillUnmount &&
            safelyCallComponentWillUnmount(
              deletedFiber,
              nearestMountedAncestor,
              prevHostParent$asInstance
            ));
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber
        );
        break;
      case 21:
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber
        );
        break;
      case 22:
        offscreenSubtreeWasHidden =
          (prevHostParent$asWasHidden = offscreenSubtreeWasHidden) ||
          null !== deletedFiber.memoizedState;
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber
        );
        offscreenSubtreeWasHidden = prevHostParent$asWasHidden;
        break;
      default:
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber
        );
    }
  }
  function commitActivityHydrationCallbacks(finishedRoot$given: RR.FiberRoot, finishedWork: RR.Fiber): void { var finishedRoot; finishedRoot = finishedRoot$given; var finishedRoot$asInstance: RR.ActivityInstance | null;
    if (
      supportsHydration &&
      null === finishedWork.memoizedState &&
      ((finishedRoot = finishedWork.alternate),
      null !== finishedRoot &&
        ((finishedRoot = finishedRoot.memoizedState as RR.ActivityState | null), null !== finishedRoot))
    ) {
      finishedRoot$asInstance = (finishedRoot as RR.ActivityState).dehydrated;
      try {
        commitHydratedActivityInstance!(finishedRoot$asInstance);
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
    }
  }
  function commitSuspenseHydrationCallbacks(finishedRoot$given: RR.FiberRoot, finishedWork: RR.Fiber): void { var finishedRoot; finishedRoot = finishedRoot$given;
    if (
      supportsHydration &&
      null === finishedWork.memoizedState &&
      ((finishedRoot = finishedWork.alternate),
      null !== finishedRoot &&
        ((finishedRoot = finishedRoot.memoizedState as RR.SuspenseState | null),
        null !== finishedRoot &&
          ((finishedRoot = finishedRoot.dehydrated), null !== finishedRoot)))
    )
      try {
        commitHydratedSuspenseInstance!(finishedRoot as RR.SuspenseInstance);
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
  }
  function getRetryCache(finishedWork: RR.Fiber): RR.RetryCache { var finishedWork$asInstance: RR.OffscreenInstance;
    switch (finishedWork.tag) {
      case 31:
      case 13:
      case 19:
        var retryCache: RR.RetryCache | null = finishedWork.stateNode as RR.RetryCache | null;
        null === retryCache &&
          (retryCache = finishedWork.stateNode = new PossiblyWeakSet());
        return retryCache!;
      case 22:
        return (
          (finishedWork$asInstance = finishedWork.stateNode as RR.OffscreenInstance),
          (retryCache = finishedWork$asInstance._retryCache),
          null === retryCache &&
            (retryCache = finishedWork$asInstance._retryCache = new PossiblyWeakSet()),
          retryCache!
        );
      default:
        throw Error(formatProdErrorMessage(435, finishedWork.tag));
    }
  }
  function attachSuspenseRetryListeners(finishedWork: RR.Fiber, wakeables: RR.RetryQueue): void {
    var retryCache = getRetryCache(finishedWork);
    wakeables.forEach(function (wakeable) {
      if (!retryCache.has(wakeable)) {
        retryCache.add(wakeable);
        var retry: () => void = resolveRetryWakeable.bind(null, finishedWork, wakeable);
        wakeable.then(retry, retry);
      }
    });
  }
  function recursivelyTraverseMutationEffects(root$jscomp$0: RR.FiberRoot, parentFiber: RR.Fiber): void { var root$asAlternate: RR.Fiber | null, parentFiber$asChild: RR.Fiber | null;
    var deletions = parentFiber.deletions;
    if (null !== deletions)
      for (var i = 0; i < deletions.length; i++) {
        var childToDelete: RR.Fiber = deletions[i],
          root: RR.FiberRoot = root$jscomp$0,
          returnFiber: RR.Fiber = parentFiber;
        if (supportsMutation) {
          var parent: RR.Fiber | null = returnFiber;
          a: for (; null !== parent; ) {
            switch (parent.tag) {
              case 27:
                if (supportsSingletons) {
                  if (isSingletonScope!(parent.type)) {
                    hostParent = parent.stateNode;
                    hostParentIsContainer = !1;
                    break a;
                  }
                  break;
                }
              case 5:
                hostParent = parent.stateNode;
                hostParentIsContainer = !1;
                break a;
              case 3:
              case 4:
                hostParent = (parent.stateNode as RR.FiberRoot | RR.PortalState).containerInfo;
                hostParentIsContainer = !0;
                break a;
            }
            parent = parent.return;
          }
          if (null === hostParent) throw Error(formatProdErrorMessage(160));
          commitDeletionEffectsOnFiber(root, returnFiber, childToDelete);
          hostParent = null;
          hostParentIsContainer = !1;
        } else commitDeletionEffectsOnFiber(root, returnFiber, childToDelete);
        root$asAlternate = childToDelete.alternate;
        null !== root$asAlternate && (root$asAlternate.return = null);
        childToDelete.return = null;
      }
    if (parentFiber.subtreeFlags & 13886)
      for (parentFiber$asChild = parentFiber.child; null !== parentFiber$asChild; )
        commitMutationEffectsOnFiber(parentFiber$asChild, root$jscomp$0),
          (parentFiber$asChild = parentFiber$asChild.sibling);
  }
  function commitMutationEffectsOnFiber(finishedWork: RR.Fiber, root: RR.FiberRoot): void { var finishedWork$asQueue: RR.UpdateQueue | null, root$asInstance: RR.OffscreenInstance, root$asFiber: RR.Fiber, wasHidden$asFiber: RR.Fiber, newResource$asInstance: RR.StateNode, hoistableRoot$asInstance: RR.StateNode, hoistableRoot$asProps: RR.Props, hoistableRoot$asTextInstance: RR.StateNode, hoistableRoot$asIsHidden: boolean, flags$asCallbacks: RR.UpdateCallback[] | null, flags$asResource: RR.MemoizedState, flags$asText: string, flags$asContainer: RR.Container, flags$asRetryQueue: RR.RetryQueue | null, flags$asOffscreenQueue: RR.OffscreenQueue | null, current$asHidden: RR.UpdateCallback[] | null, current$asOldText: string, current$asChildren: RR.ChildSet | null, current$asHoistableRoot: RR.HoistableRoot | null, current$asSubtreeRoot: RR.Fiber | null, current$asRetryQueue: RR.RetryQueue | null;
    var current: RR.Fiber | null = finishedWork.alternate,
      flags: RR.Flags = finishedWork.flags;
    switch (finishedWork.tag) {
      case 0:
      case 11:
      case 14:
      case 15:
        recursivelyTraverseMutationEffects(root, finishedWork);
        commitReconciliationEffects(finishedWork);
        flags & 4 &&
          (commitHookEffectListUnmount(3, finishedWork, finishedWork.return),
          commitHookEffectListMount(3, finishedWork),
          commitHookEffectListUnmount(5, finishedWork, finishedWork.return));
        break;
      case 1:
        recursivelyTraverseMutationEffects(root, finishedWork);
        commitReconciliationEffects(finishedWork);
        flags & 512 &&
          (offscreenSubtreeWasHidden ||
            null === current ||
            safelyDetachRef(current, current.return));
        flags & 64 &&
          offscreenSubtreeIsHidden &&
          ((finishedWork$asQueue = finishedWork.updateQueue as RR.UpdateQueue | null),
          null !== finishedWork$asQueue &&
            ((flags$asCallbacks = finishedWork$asQueue.callbacks),
            null !== flags$asCallbacks &&
              ((current$asHidden = finishedWork$asQueue.shared.hiddenCallbacks),
              (finishedWork$asQueue.shared.hiddenCallbacks =
                null === current$asHidden ? flags$asCallbacks : current$asHidden.concat(flags$asCallbacks)))));
        break;
      case 26:
        if (supportsResources) {
          var hoistableRoot: RR.HoistableRoot | null = currentHoistableRoot;
          recursivelyTraverseMutationEffects(root, finishedWork);
          commitReconciliationEffects(finishedWork);
          flags & 512 &&
            (offscreenSubtreeWasHidden ||
              null === current ||
              safelyDetachRef(current, current.return));
          if (flags & 4) {
            flags$asResource = null !== current ? current.memoizedState : null;
            var newResource: RR.MemoizedState = finishedWork.memoizedState;
            null === current
              ? null === newResource
                ? null === finishedWork.stateNode
                  ? (finishedWork.stateNode = hydrateHoistable!(
                      hoistableRoot,
                      finishedWork.type,
                      finishedWork.memoizedProps,
                      finishedWork
                    ))
                  : mountHoistable!(
                      hoistableRoot,
                      finishedWork.type,
                      finishedWork.stateNode
                    )
                : (finishedWork.stateNode = acquireResource!(
                    hoistableRoot,
                    newResource,
                    finishedWork.memoizedProps
                  ))
              : flags$asResource !== newResource
                ? (null === flags$asResource
                    ? null !== current.stateNode &&
                      unmountHoistable!(current.stateNode)
                    : releaseResource!(flags$asResource),
                  null === newResource
                    ? mountHoistable!(
                        hoistableRoot,
                        finishedWork.type,
                        finishedWork.stateNode
                      )
                    : acquireResource!(
                        hoistableRoot,
                        newResource,
                        finishedWork.memoizedProps
                      ))
                : null === newResource &&
                  null !== finishedWork.stateNode &&
                  commitHostUpdate(
                    finishedWork,
                    finishedWork.memoizedProps,
                    current.memoizedProps
                  );
          }
          break;
        }
      case 27:
        if (supportsSingletons) {
          recursivelyTraverseMutationEffects(root, finishedWork);
          commitReconciliationEffects(finishedWork);
          flags & 512 &&
            (offscreenSubtreeWasHidden ||
              null === current ||
              safelyDetachRef(current, current.return));
          null !== current &&
            flags & 4 &&
            commitHostUpdate(
              finishedWork,
              finishedWork.memoizedProps,
              current.memoizedProps
            );
          break;
        }
      case 5:
        recursivelyTraverseMutationEffects(root, finishedWork);
        commitReconciliationEffects(finishedWork);
        flags & 512 &&
          (offscreenSubtreeWasHidden ||
            null === current ||
            safelyDetachRef(current, current.return));
        if (supportsMutation) {
          if (finishedWork.flags & 32) {
            hoistableRoot$asInstance = finishedWork.stateNode;
            try {
              resetTextContent!(hoistableRoot$asInstance);
            } catch (error) {
              captureCommitPhaseError(finishedWork, finishedWork.return, error);
            }
          }
          flags & 4 &&
            null != finishedWork.stateNode &&
            ((hoistableRoot$asProps = finishedWork.memoizedProps),
            commitHostUpdate(
              finishedWork,
              hoistableRoot$asProps,
              null !== current ? current.memoizedProps : hoistableRoot$asProps
            ));
          flags & 1024 && (needsFormReset = !0);
        } else
          supportsPersistence &&
            null !== finishedWork.alternate &&
            (finishedWork.alternate.stateNode = finishedWork.stateNode);
        break;
      case 6:
        recursivelyTraverseMutationEffects(root, finishedWork);
        commitReconciliationEffects(finishedWork);
        if (flags & 4 && supportsMutation) {
          if (null === finishedWork.stateNode)
            throw Error(formatProdErrorMessage(162));
          flags$asText = finishedWork.memoizedProps as string;
          current$asOldText = (null !== current ? current.memoizedProps : flags$asText) as string;
          hoistableRoot$asTextInstance = finishedWork.stateNode;
          try {
            commitTextUpdate!(hoistableRoot$asTextInstance, current$asOldText, flags$asText);
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }
        break;
      case 3:
        supportsResources
          ? (prepareToCommitHoistables!(),
            (hoistableRoot = currentHoistableRoot),
            (currentHoistableRoot = getHoistableRoot!(root.containerInfo)),
            recursivelyTraverseMutationEffects(root, finishedWork),
            (currentHoistableRoot = hoistableRoot))
          : recursivelyTraverseMutationEffects(root, finishedWork);
        commitReconciliationEffects(finishedWork);
        if (flags & 4) {
          if (
            supportsMutation &&
            supportsHydration &&
            null !== current &&
            (current.memoizedState as RR.RootState).isDehydrated
          )
            try {
              commitHydratedContainer!(root.containerInfo);
            } catch (error) {
              captureCommitPhaseError(finishedWork, finishedWork.return, error);
            }
          if (supportsPersistence) {
            flags$asContainer = root.containerInfo;
            current$asChildren = root.pendingChildren;
            try {
              replaceContainerChildren!(flags$asContainer, current$asChildren);
            } catch (error) {
              captureCommitPhaseError(finishedWork, finishedWork.return, error);
            }
          }
        }
        needsFormReset &&
          ((needsFormReset = !1), recursivelyResetForms(finishedWork));
        break;
      case 4:
        supportsResources
          ? ((current$asHoistableRoot = currentHoistableRoot),
            (currentHoistableRoot = getHoistableRoot!(
              (finishedWork.stateNode as RR.PortalState).containerInfo
            )),
            recursivelyTraverseMutationEffects(root, finishedWork),
            commitReconciliationEffects(finishedWork),
            (currentHoistableRoot = current$asHoistableRoot))
          : (recursivelyTraverseMutationEffects(root, finishedWork),
            commitReconciliationEffects(finishedWork));
        flags & 4 &&
          supportsPersistence &&
          commitHostPortalContainerChildren(
            finishedWork.stateNode as RR.PortalState,
            finishedWork,
            (finishedWork.stateNode as RR.PortalState).pendingChildren
          );
        break;
      case 12:
        recursivelyTraverseMutationEffects(root, finishedWork);
        commitReconciliationEffects(finishedWork);
        break;
      case 31:
        recursivelyTraverseMutationEffects(root, finishedWork);
        commitReconciliationEffects(finishedWork);
        flags & 4 &&
          ((flags$asRetryQueue = finishedWork.updateQueue as RR.RetryQueue | null),
          null !== flags$asRetryQueue &&
            ((finishedWork.updateQueue = null),
            attachSuspenseRetryListeners(finishedWork, flags$asRetryQueue)));
        break;
      case 13:
        recursivelyTraverseMutationEffects(root, finishedWork);
        commitReconciliationEffects(finishedWork);
        finishedWork.child!.flags & 8192 &&
          (null !== finishedWork.memoizedState) !==
            (null !== current && null !== current.memoizedState) &&
          (globalMostRecentFallbackTime = now());
        flags & 4 &&
          ((flags$asRetryQueue = finishedWork.updateQueue as RR.RetryQueue | null),
          null !== flags$asRetryQueue &&
            ((finishedWork.updateQueue = null),
            attachSuspenseRetryListeners(finishedWork, flags$asRetryQueue)));
        break;
      case 22:
        hoistableRoot$asIsHidden = null !== finishedWork.memoizedState;
        var wasHidden: boolean = null !== current && null !== current.memoizedState,
          prevOffscreenSubtreeIsHidden = offscreenSubtreeIsHidden,
          prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
        offscreenSubtreeIsHidden =
          prevOffscreenSubtreeIsHidden || hoistableRoot$asIsHidden;
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden || wasHidden;
        recursivelyTraverseMutationEffects(root, finishedWork);
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
        offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden;
        commitReconciliationEffects(finishedWork);
        if (
          flags & 8192 &&
          ((root$asInstance = finishedWork.stateNode as RR.OffscreenInstance),
          (root$asInstance._visibility = hoistableRoot$asIsHidden
            ? root$asInstance._visibility & -2
            : root$asInstance._visibility | 1),
          hoistableRoot$asIsHidden &&
            (null === current ||
              wasHidden ||
              offscreenSubtreeIsHidden ||
              offscreenSubtreeWasHidden ||
              recursivelyTraverseDisappearLayoutEffects(finishedWork)),
          supportsMutation)
        )
          a: if (((current$asSubtreeRoot = null), supportsMutation))
            for (root$asFiber = finishedWork; ; ) {
              if (5 === root$asFiber.tag || (supportsResources && 26 === root$asFiber.tag)) {
                if (null === current$asSubtreeRoot) {
                  wasHidden$asFiber = current$asSubtreeRoot = root$asFiber;
                  try {
                    (newResource$asInstance = wasHidden$asFiber.stateNode),
                      hoistableRoot$asIsHidden
                        ? hideInstance!(newResource$asInstance)
                        : unhideInstance!(
                            wasHidden$asFiber.stateNode,
                            wasHidden$asFiber.memoizedProps
                          );
                  } catch (error) {
                    captureCommitPhaseError(wasHidden$asFiber, wasHidden$asFiber.return, error);
                  }
                }
              } else if (6 === root$asFiber.tag) {
                if (null === current$asSubtreeRoot) {
                  wasHidden$asFiber = root$asFiber;
                  try {
                    var instance = wasHidden$asFiber.stateNode;
                    hoistableRoot$asIsHidden
                      ? hideTextInstance!(instance)
                      : unhideTextInstance!(instance, wasHidden$asFiber.memoizedProps);
                  } catch (error) {
                    captureCommitPhaseError(wasHidden$asFiber, wasHidden$asFiber.return, error);
                  }
                }
              } else if (18 === root$asFiber.tag) {
                if (null === current$asSubtreeRoot) {
                  wasHidden$asFiber = root$asFiber;
                  try {
                    var instance$jscomp$0 = wasHidden$asFiber.stateNode;
                    hoistableRoot$asIsHidden
                      ? hideDehydratedBoundary!(instance$jscomp$0)
                      : unhideDehydratedBoundary!(wasHidden$asFiber.stateNode);
                  } catch (error) {
                    captureCommitPhaseError(wasHidden$asFiber, wasHidden$asFiber.return, error);
                  }
                }
              } else if (
                ((22 !== root$asFiber.tag && 23 !== root$asFiber.tag) ||
                  null === root$asFiber.memoizedState ||
                  root$asFiber === finishedWork) &&
                null !== root$asFiber.child
              ) {
                root$asFiber.child.return = root$asFiber;
                root$asFiber = root$asFiber.child;
                continue;
              }
              if (root$asFiber === finishedWork) break a;
              for (; null === root$asFiber.sibling; ) {
                if (null === root$asFiber.return || root$asFiber.return === finishedWork)
                  break a;
                current$asSubtreeRoot === root$asFiber && (current$asSubtreeRoot = null);
                root$asFiber = root$asFiber.return;
              }
              current$asSubtreeRoot === root$asFiber && (current$asSubtreeRoot = null);
              root$asFiber.sibling.return = root$asFiber.return;
              root$asFiber = root$asFiber.sibling;
            }
        flags & 4 &&
          ((flags$asOffscreenQueue = finishedWork.updateQueue as RR.OffscreenQueue | null),
          null !== flags$asOffscreenQueue &&
            ((current$asRetryQueue = flags$asOffscreenQueue.retryQueue),
            null !== current$asRetryQueue &&
              ((flags$asOffscreenQueue.retryQueue = null),
              attachSuspenseRetryListeners(finishedWork, current$asRetryQueue))));
        break;
      case 19:
        recursivelyTraverseMutationEffects(root, finishedWork);
        commitReconciliationEffects(finishedWork);
        flags & 4 &&
          ((flags$asRetryQueue = finishedWork.updateQueue as RR.RetryQueue | null),
          null !== flags$asRetryQueue &&
            ((finishedWork.updateQueue = null),
            attachSuspenseRetryListeners(finishedWork, flags$asRetryQueue)));
        break;
      case 30:
        break;
      case 21:
        break;
      default:
        recursivelyTraverseMutationEffects(root, finishedWork),
          commitReconciliationEffects(finishedWork);
    }
  }
  function commitReconciliationEffects(finishedWork: RR.Fiber): void {
    var flags = finishedWork.flags;
    if (flags & 2) {
      try {
        for (
          var hostParentFiber: RR.Fiber | undefined, parentFiber = finishedWork.return;
          null !== parentFiber;

        ) {
          if (isHostParent(parentFiber)) {
            hostParentFiber = parentFiber;
            break;
          }
          parentFiber = parentFiber.return;
        }
        if (supportsMutation) {
          if (null == hostParentFiber) throw Error(formatProdErrorMessage(160));
          switch (hostParentFiber.tag) {
            case 27:
              if (supportsSingletons) {
                var parent = hostParentFiber.stateNode,
                  before = getHostSibling(finishedWork);
                insertOrAppendPlacementNode(finishedWork, before, parent);
                break;
              }
            case 5:
              var parent$125 = hostParentFiber.stateNode;
              hostParentFiber.flags & 32 &&
                (resetTextContent!(parent$125), (hostParentFiber.flags &= -33));
              var before$126 = getHostSibling(finishedWork);
              insertOrAppendPlacementNode(finishedWork, before$126, parent$125);
              break;
            case 3:
            case 4:
              var parent$127 = (hostParentFiber.stateNode as RR.FiberRoot | RR.PortalState).containerInfo,
                before$128 = getHostSibling(finishedWork);
              insertOrAppendPlacementNodeIntoContainer(
                finishedWork,
                before$128,
                parent$127
              );
              break;
            default:
              throw Error(formatProdErrorMessage(161));
          }
        }
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
      finishedWork.flags &= -3;
    }
    flags & 4096 && (finishedWork.flags &= -4097);
  }
  function recursivelyResetForms(parentFiber: RR.Fiber): void { var parentFiber$asChild: RR.Fiber | null;
    if (parentFiber.subtreeFlags & 1024)
      for (parentFiber$asChild = parentFiber.child; null !== parentFiber$asChild; ) {
        var fiber = parentFiber$asChild;
        recursivelyResetForms(fiber);
        5 === fiber.tag &&
          fiber.flags & 1024 &&
          resetFormInstance(fiber.stateNode);
        parentFiber$asChild = parentFiber$asChild.sibling;
      }
  }
  function recursivelyTraverseLayoutEffects(root: RR.FiberRoot, parentFiber: RR.Fiber): void { var parentFiber$asChild: RR.Fiber | null;
    if (parentFiber.subtreeFlags & 8772)
      for (parentFiber$asChild = parentFiber.child; null !== parentFiber$asChild; )
        commitLayoutEffectOnFiber(root, parentFiber$asChild.alternate, parentFiber$asChild),
          (parentFiber$asChild = parentFiber$asChild.sibling);
  }
  function recursivelyTraverseDisappearLayoutEffects(parentFiber: RR.Fiber): void { var parentFiber$asChild: RR.Fiber | null;
    for (parentFiber$asChild = parentFiber.child; null !== parentFiber$asChild; ) {
      var finishedWork = parentFiber$asChild;
      switch (finishedWork.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          commitHookEffectListUnmount(4, finishedWork, finishedWork.return);
          recursivelyTraverseDisappearLayoutEffects(finishedWork);
          break;
        case 1:
          safelyDetachRef(finishedWork, finishedWork.return);
          var instance: RR.ClassInstance = finishedWork.stateNode as RR.ClassInstance;
          "function" === typeof instance.componentWillUnmount &&
            safelyCallComponentWillUnmount(
              finishedWork,
              finishedWork.return,
              instance
            );
          recursivelyTraverseDisappearLayoutEffects(finishedWork);
          break;
        case 27:
          supportsSingletons &&
            releaseSingletonInstance!(finishedWork.stateNode);
        case 26:
        case 5:
          safelyDetachRef(finishedWork, finishedWork.return);
          recursivelyTraverseDisappearLayoutEffects(finishedWork);
          break;
        case 22:
          null === finishedWork.memoizedState &&
            recursivelyTraverseDisappearLayoutEffects(finishedWork);
          break;
        case 30:
          recursivelyTraverseDisappearLayoutEffects(finishedWork);
          break;
        default:
          recursivelyTraverseDisappearLayoutEffects(finishedWork);
      }
      parentFiber$asChild = parentFiber$asChild.sibling;
    }
  }
  function recursivelyTraverseReappearLayoutEffects(
    finishedRoot$jscomp$0: RR.FiberRoot,
    parentFiber: RR.Fiber,
    includeWorkInProgressEffects: boolean
  ): void { var parentFiber$asChild: RR.Fiber | null, current$asWork: RR.Fiber, finishedRoot$asInstance: RR.ClassInstance, finishedRoot$asQueue: RR.UpdateQueue | null, finishedRoot$asIndex: number;
    includeWorkInProgressEffects =
      includeWorkInProgressEffects && 0 !== (parentFiber.subtreeFlags & 8772);
    for (parentFiber$asChild = parentFiber.child; null !== parentFiber$asChild; ) {
      var current = parentFiber$asChild.alternate,
        finishedRoot: RR.FiberRoot = finishedRoot$jscomp$0,
        finishedWork = parentFiber$asChild,
        flags = finishedWork.flags;
      switch (finishedWork.tag) {
        case 0:
        case 11:
        case 15:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
          commitHookEffectListMount(4, finishedWork);
          break;
        case 1:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
          current$asWork = finishedWork;
          finishedRoot$asInstance = current$asWork.stateNode as RR.ClassInstance;
          if ("function" === typeof finishedRoot$asInstance.componentDidMount)
            try {
              finishedRoot$asInstance.componentDidMount();
            } catch (error) {
              captureCommitPhaseError(current$asWork, current$asWork.return, error);
            }
          current$asWork = finishedWork;
          finishedRoot$asQueue = current$asWork.updateQueue as RR.UpdateQueue | null;
          if (null !== finishedRoot$asQueue) {
            var instance = current$asWork.stateNode;
            try {
              var hiddenCallbacks = finishedRoot$asQueue.shared.hiddenCallbacks;
              if (null !== hiddenCallbacks)
                for (
                  finishedRoot$asQueue.shared.hiddenCallbacks = null, finishedRoot$asIndex = 0;
                  finishedRoot$asIndex < hiddenCallbacks.length;
                  finishedRoot$asIndex++
                )
                  callCallback(hiddenCallbacks[finishedRoot$asIndex], instance);
            } catch (error) {
              captureCommitPhaseError(current$asWork, current$asWork.return, error);
            }
          }
          includeWorkInProgressEffects &&
            flags & 64 &&
            commitClassCallbacks(finishedWork);
          safelyAttachRef(finishedWork, finishedWork.return);
          break;
        case 27:
          supportsSingletons && commitHostSingletonAcquisition(finishedWork);
        case 26:
        case 5:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
          includeWorkInProgressEffects &&
            null === current &&
            flags & 4 &&
            commitHostMount(finishedWork);
          safelyAttachRef(finishedWork, finishedWork.return);
          break;
        case 12:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
          break;
        case 31:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
          includeWorkInProgressEffects &&
            flags & 4 &&
            commitActivityHydrationCallbacks(finishedRoot, finishedWork);
          break;
        case 13:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
          includeWorkInProgressEffects &&
            flags & 4 &&
            commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
          break;
        case 22:
          null === finishedWork.memoizedState &&
            recursivelyTraverseReappearLayoutEffects(
              finishedRoot,
              finishedWork,
              includeWorkInProgressEffects
            );
          safelyAttachRef(finishedWork, finishedWork.return);
          break;
        case 30:
          break;
        default:
          recursivelyTraverseReappearLayoutEffects(
            finishedRoot,
            finishedWork,
            includeWorkInProgressEffects
          );
      }
      parentFiber$asChild = parentFiber$asChild.sibling;
    }
  }
  function commitOffscreenPassiveMountEffects(current: RR.Fiber | null, finishedWork: RR.Fiber): void { var current$asCache: RR.Cache | null;
    var previousCache: RR.Cache | null = null;
    null !== current &&
      null !== current.memoizedState &&
      null !== (current.memoizedState as RR.OffscreenState).cachePool &&
      (previousCache = (current.memoizedState as RR.OffscreenState).cachePool!.pool);
    current$asCache = null;
    null !== finishedWork.memoizedState &&
      null !== (finishedWork.memoizedState as RR.OffscreenState).cachePool &&
      (current$asCache = (finishedWork.memoizedState as RR.OffscreenState).cachePool!.pool);
    current$asCache !== previousCache &&
      (null != current$asCache && current$asCache.refCount++,
      null != previousCache && releaseCache(previousCache));
  }
  function commitCachePassiveMountEffect(current: RR.Fiber | null, finishedWork: RR.Fiber): void { var current$asCache: RR.Cache | null, finishedWork$asCache: RR.Cache | null;
    current$asCache = null;
    null !== finishedWork.alternate &&
      (current$asCache = (finishedWork.alternate.memoizedState as RR.CacheComponentState).cache);
    finishedWork$asCache = (finishedWork.memoizedState as RR.CacheComponentState).cache;
    finishedWork$asCache !== current$asCache &&
      (finishedWork$asCache!.refCount++, null != current$asCache && releaseCache(current$asCache));
  }
  function recursivelyTraversePassiveMountEffects(
    root: RR.FiberRoot,
    parentFiber: RR.Fiber,
    committedLanes: RR.Lanes,
    committedTransitions: RR.Transition[] | null
  ): void { var parentFiber$asChild: RR.Fiber | null;
    if (parentFiber.subtreeFlags & 10256)
      for (parentFiber$asChild = parentFiber.child; null !== parentFiber$asChild; )
        commitPassiveMountOnFiber(
          root,
          parentFiber$asChild,
          committedLanes,
          committedTransitions
        ),
          (parentFiber$asChild = parentFiber$asChild.sibling);
  }
  function commitPassiveMountOnFiber(
    finishedRoot: RR.FiberRoot,
    finishedWork: RR.Fiber,
    committedLanes: RR.Lanes,
    committedTransitions: RR.Transition[] | null
  ): void { var finishedRoot$asCache: RR.Cache | null, finishedRoot$asProfiler: RR.ProfilerState | null, finishedWork$asCache: RR.Cache, _finishedWork$memoize2$asInstance: RR.OffscreenInstance, id$asAlternate: RR.Fiber | null;
    var flags = finishedWork.flags;
    switch (finishedWork.tag) {
      case 0:
      case 11:
      case 15:
        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions
        );
        flags & 2048 && commitHookEffectListMount(9, finishedWork);
        break;
      case 1:
        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions
        );
        break;
      case 3:
        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions
        );
        flags & 2048 &&
          ((finishedRoot$asCache = null),
          null !== finishedWork.alternate &&
            (finishedRoot$asCache = (finishedWork.alternate.memoizedState as RR.RootState).cache),
          (finishedWork$asCache = (finishedWork.memoizedState as RR.RootState).cache),
          finishedWork$asCache !== finishedRoot$asCache &&
            (finishedWork$asCache.refCount++,
            null != finishedRoot$asCache && releaseCache(finishedRoot$asCache)));
        break;
      case 12:
        if (flags & 2048) {
          recursivelyTraversePassiveMountEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions
          );
          finishedRoot$asProfiler = finishedWork.stateNode as RR.ProfilerState | null;
          try {
            var _finishedWork$memoize2: RR.ProfilerProps = finishedWork.memoizedProps as RR.ProfilerProps,
              id: string | undefined = _finishedWork$memoize2.id,
              onPostCommit = _finishedWork$memoize2.onPostCommit;
            "function" === typeof onPostCommit &&
              onPostCommit(
                id,
                null === finishedWork.alternate ? "mount" : "update",
                finishedRoot$asProfiler!.passiveEffectDuration,
                -0
              );
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        } else
          recursivelyTraversePassiveMountEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions
          );
        break;
      case 31:
        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions
        );
        break;
      case 13:
        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions
        );
        break;
      case 23:
        break;
      case 22:
        _finishedWork$memoize2$asInstance = finishedWork.stateNode as RR.OffscreenInstance;
        id$asAlternate = finishedWork.alternate;
        null !== finishedWork.memoizedState
          ? _finishedWork$memoize2$asInstance._visibility & 2
            ? recursivelyTraversePassiveMountEffects(
                finishedRoot,
                finishedWork,
                committedLanes,
                committedTransitions
              )
            : recursivelyTraverseAtomicPassiveEffects(
                finishedRoot,
                finishedWork
              )
          : _finishedWork$memoize2$asInstance._visibility & 2
            ? recursivelyTraversePassiveMountEffects(
                finishedRoot,
                finishedWork,
                committedLanes,
                committedTransitions
              )
            : ((_finishedWork$memoize2$asInstance._visibility |= 2),
              recursivelyTraverseReconnectPassiveEffects(
                finishedRoot,
                finishedWork,
                committedLanes,
                committedTransitions,
                0 !== (finishedWork.subtreeFlags & 10256) || !1
              ));
        flags & 2048 && commitOffscreenPassiveMountEffects(id$asAlternate, finishedWork);
        break;
      case 24:
        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions
        );
        flags & 2048 &&
          commitCachePassiveMountEffect(finishedWork.alternate, finishedWork);
        break;
      default:
        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions
        );
    }
  }
  function recursivelyTraverseReconnectPassiveEffects(
    finishedRoot$jscomp$0: RR.FiberRoot,
    parentFiber: RR.Fiber,
    committedLanes$jscomp$0: RR.Lanes,
    committedTransitions$jscomp$0: RR.Transition[] | null,
    includeWorkInProgressEffects: boolean
  ): void { var parentFiber$asChild: RR.Fiber | null;
    includeWorkInProgressEffects =
      includeWorkInProgressEffects &&
      (0 !== (parentFiber.subtreeFlags & 10256) || !1);
    for (parentFiber$asChild = parentFiber.child; null !== parentFiber$asChild; ) {
      var finishedRoot = finishedRoot$jscomp$0,
        finishedWork = parentFiber$asChild,
        committedLanes = committedLanes$jscomp$0,
        committedTransitions = committedTransitions$jscomp$0,
        flags = finishedWork.flags;
      switch (finishedWork.tag) {
        case 0:
        case 11:
        case 15:
          recursivelyTraverseReconnectPassiveEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            includeWorkInProgressEffects
          );
          commitHookEffectListMount(8, finishedWork);
          break;
        case 23:
          break;
        case 22:
          var instance: RR.OffscreenInstance = finishedWork.stateNode as RR.OffscreenInstance;
          null !== finishedWork.memoizedState
            ? instance._visibility & 2
              ? recursivelyTraverseReconnectPassiveEffects(
                  finishedRoot,
                  finishedWork,
                  committedLanes,
                  committedTransitions,
                  includeWorkInProgressEffects
                )
              : recursivelyTraverseAtomicPassiveEffects(
                  finishedRoot,
                  finishedWork
                )
            : ((instance._visibility |= 2),
              recursivelyTraverseReconnectPassiveEffects(
                finishedRoot,
                finishedWork,
                committedLanes,
                committedTransitions,
                includeWorkInProgressEffects
              ));
          includeWorkInProgressEffects &&
            flags & 2048 &&
            commitOffscreenPassiveMountEffects(
              finishedWork.alternate,
              finishedWork
            );
          break;
        case 24:
          recursivelyTraverseReconnectPassiveEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            includeWorkInProgressEffects
          );
          includeWorkInProgressEffects &&
            flags & 2048 &&
            commitCachePassiveMountEffect(finishedWork.alternate, finishedWork);
          break;
        default:
          recursivelyTraverseReconnectPassiveEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            includeWorkInProgressEffects
          );
      }
      parentFiber$asChild = parentFiber$asChild.sibling;
    }
  }
  function recursivelyTraverseAtomicPassiveEffects(
    finishedRoot$jscomp$0: RR.FiberRoot,
    parentFiber: RR.Fiber
  ): void { var parentFiber$asChild: RR.Fiber | null;
    if (parentFiber.subtreeFlags & 10256)
      for (parentFiber$asChild = parentFiber.child; null !== parentFiber$asChild; ) {
        var finishedRoot: RR.FiberRoot = finishedRoot$jscomp$0,
          finishedWork: RR.Fiber = parentFiber$asChild,
          flags: RR.Flags = finishedWork.flags;
        switch (finishedWork.tag) {
          case 22:
            recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork);
            flags & 2048 &&
              commitOffscreenPassiveMountEffects(
                finishedWork.alternate,
                finishedWork
              );
            break;
          case 24:
            recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork);
            flags & 2048 &&
              commitCachePassiveMountEffect(
                finishedWork.alternate,
                finishedWork
              );
            break;
          default:
            recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork);
        }
        parentFiber$asChild = parentFiber$asChild.sibling;
      }
  }
  function recursivelyAccumulateSuspenseyCommit(
    parentFiber: RR.Fiber,
    committedLanes: RR.Lanes,
    suspendedState: RR.SuspendedState
  ): void { var parentFiber$asChild: RR.Fiber | null;
    if (parentFiber.subtreeFlags & suspenseyCommitFlag)
      for (parentFiber$asChild = parentFiber.child; null !== parentFiber$asChild; )
        accumulateSuspenseyCommitOnFiber(
          parentFiber$asChild,
          committedLanes,
          suspendedState
        ),
          (parentFiber$asChild = parentFiber$asChild.sibling);
  }
  function accumulateSuspenseyCommitOnFiber(
    fiber: RR.Fiber,
    committedLanes: RR.Lanes,
    suspendedState: RR.SuspendedState
  ): void { var fiber$asProps: RR.Fiber["memoizedProps"], instance$asHoistableRoot: RR.HoistableRoot | null, instance$asCurrent: RR.Fiber | null, instance$asFlag: RR.Flags;
    switch (fiber.tag) {
      case 26:
        recursivelyAccumulateSuspenseyCommit(
          fiber,
          committedLanes,
          suspendedState
        );
        if (fiber.flags & suspenseyCommitFlag)
          if (null !== fiber.memoizedState)
            suspendResource!(
              suspendedState,
              currentHoistableRoot,
              fiber.memoizedState,
              fiber.memoizedProps
            );
          else {
            var instance: RR.StateNode = fiber.stateNode,
              type: RR.ElementType = fiber.type;
            fiber$asProps = fiber.memoizedProps;
            ((committedLanes & 335544128) === committedLanes ||
              maySuspendCommitInSyncRender!(type, fiber$asProps)) &&
              suspendInstance(suspendedState, instance, type, fiber$asProps);
          }
        break;
      case 5:
        recursivelyAccumulateSuspenseyCommit(
          fiber,
          committedLanes,
          suspendedState
        );
        fiber.flags & suspenseyCommitFlag &&
          ((instance = fiber.stateNode),
          (type = fiber.type),
          (fiber$asProps = fiber.memoizedProps),
          ((committedLanes & 335544128) === committedLanes ||
            maySuspendCommitInSyncRender!(type, fiber$asProps)) &&
            suspendInstance(suspendedState, instance, type, fiber$asProps));
        break;
      case 3:
      case 4:
        supportsResources
          ? ((instance$asHoistableRoot = currentHoistableRoot),
            (currentHoistableRoot = getHoistableRoot!(
              (fiber.stateNode as RR.FiberRoot | RR.PortalState).containerInfo
            )),
            recursivelyAccumulateSuspenseyCommit(
              fiber,
              committedLanes,
              suspendedState
            ),
            (currentHoistableRoot = instance$asHoistableRoot))
          : recursivelyAccumulateSuspenseyCommit(
              fiber,
              committedLanes,
              suspendedState
            );
        break;
      case 22:
        null === fiber.memoizedState &&
          ((instance$asCurrent = fiber.alternate),
          null !== instance$asCurrent && null !== instance$asCurrent.memoizedState
            ? ((instance$asFlag = suspenseyCommitFlag),
              (suspenseyCommitFlag = 16777216),
              recursivelyAccumulateSuspenseyCommit(
                fiber,
                committedLanes,
                suspendedState
              ),
              (suspenseyCommitFlag = instance$asFlag))
            : recursivelyAccumulateSuspenseyCommit(
                fiber,
                committedLanes,
                suspendedState
              ));
        break;
      default:
        recursivelyAccumulateSuspenseyCommit(
          fiber,
          committedLanes,
          suspendedState
        );
    }
  }
  function detachAlternateSiblings(parentFiber: RR.Fiber): void { var parentFiber$asChild: RR.Fiber | null;
    var previousFiber: RR.Fiber | null = parentFiber.alternate;
    if (
      null !== previousFiber &&
      ((parentFiber$asChild = previousFiber.child), null !== parentFiber$asChild)
    ) {
      previousFiber.child = null;
      do
        (previousFiber = parentFiber$asChild.sibling),
          (parentFiber$asChild.sibling = null),
          (parentFiber$asChild = previousFiber);
      while (null !== parentFiber$asChild);
    }
  }
  function recursivelyTraversePassiveUnmountEffects(parentFiber: RR.Fiber): void { var parentFiber$asChild: RR.Fiber | null;
    var deletions: RR.Fiber[] | null = parentFiber.deletions;
    if (0 !== (parentFiber.flags & 16)) {
      if (null !== deletions)
        for (var i = 0; i < deletions.length; i++) {
          var childToDelete: RR.Fiber = deletions[i];
          nextEffect = childToDelete;
          commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
            childToDelete,
            parentFiber
          );
        }
      detachAlternateSiblings(parentFiber);
    }
    if (parentFiber.subtreeFlags & 10256)
      for (parentFiber$asChild = parentFiber.child; null !== parentFiber$asChild; )
        commitPassiveUnmountOnFiber(parentFiber$asChild),
          (parentFiber$asChild = parentFiber$asChild.sibling);
  }
  function commitPassiveUnmountOnFiber(finishedWork: RR.Fiber): void {
    switch (finishedWork.tag) {
      case 0:
      case 11:
      case 15:
        recursivelyTraversePassiveUnmountEffects(finishedWork);
        finishedWork.flags & 2048 &&
          commitHookEffectListUnmount(9, finishedWork, finishedWork.return);
        break;
      case 3:
        recursivelyTraversePassiveUnmountEffects(finishedWork);
        break;
      case 12:
        recursivelyTraversePassiveUnmountEffects(finishedWork);
        break;
      case 22:
        var instance: RR.OffscreenInstance = finishedWork.stateNode as RR.OffscreenInstance;
        null !== finishedWork.memoizedState &&
        instance._visibility & 2 &&
        (null === finishedWork.return || 13 !== finishedWork.return.tag)
          ? ((instance._visibility &= -3),
            recursivelyTraverseDisconnectPassiveEffects(finishedWork))
          : recursivelyTraversePassiveUnmountEffects(finishedWork);
        break;
      default:
        recursivelyTraversePassiveUnmountEffects(finishedWork);
    }
  }
  function recursivelyTraverseDisconnectPassiveEffects(parentFiber: RR.Fiber): void { var parentFiber$asChild: RR.Fiber | null, deletions$asFiber: RR.Fiber, i$asInstance: RR.OffscreenInstance;
    var deletions: RR.Fiber[] | null = parentFiber.deletions;
    if (0 !== (parentFiber.flags & 16)) {
      if (null !== deletions)
        for (var i: number = 0; i < deletions.length; i++) {
          var childToDelete: RR.Fiber = deletions[i];
          nextEffect = childToDelete;
          commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
            childToDelete,
            parentFiber
          );
        }
      detachAlternateSiblings(parentFiber);
    }
    for (parentFiber$asChild = parentFiber.child; null !== parentFiber$asChild; ) {
      deletions$asFiber = parentFiber$asChild;
      switch (deletions$asFiber.tag) {
        case 0:
        case 11:
        case 15:
          commitHookEffectListUnmount(8, deletions$asFiber, deletions$asFiber.return);
          recursivelyTraverseDisconnectPassiveEffects(deletions$asFiber);
          break;
        case 22:
          i$asInstance = deletions$asFiber.stateNode as RR.OffscreenInstance;
          i$asInstance._visibility & 2 &&
            ((i$asInstance._visibility &= -3),
            recursivelyTraverseDisconnectPassiveEffects(deletions$asFiber));
          break;
        default:
          recursivelyTraverseDisconnectPassiveEffects(deletions$asFiber);
      }
      parentFiber$asChild = parentFiber$asChild.sibling;
    }
  }
  function commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
    deletedSubtreeRoot: RR.Fiber,
    nearestMountedAncestor: RR.Fiber
  ): void { var cache$asChild: RR.Fiber | null, cache$asFiber: RR.Fiber;
    for (; null !== nextEffect; ) {
      var fiber: RR.Fiber = nextEffect;
      switch (fiber.tag) {
        case 0:
        case 11:
        case 15:
          commitHookEffectListUnmount(8, fiber, nearestMountedAncestor);
          break;
        case 23:
        case 22:
          if (
            null !== fiber.memoizedState &&
            null !== (fiber.memoizedState as RR.OffscreenState).cachePool
          ) {
            var cache: RR.Cache | null = (fiber.memoizedState as RR.OffscreenState).cachePool!.pool;
            null != cache && cache.refCount++;
          }
          break;
        case 24:
          releaseCache((fiber.memoizedState as RR.CacheComponentState).cache!);
      }
      cache$asChild = fiber.child;
      if (null !== cache$asChild) (cache$asChild.return = fiber), (nextEffect = cache$asChild);
      else
        a: for (fiber = deletedSubtreeRoot; null !== nextEffect; ) {
          cache$asFiber = nextEffect;
          var sibling: RR.Fiber | null = cache$asFiber.sibling,
            returnFiber: RR.Fiber | null = cache$asFiber.return;
          detachFiberAfterEffects(cache$asFiber);
          if (cache$asFiber === fiber) {
            nextEffect = null;
            break a;
          }
          if (null !== sibling) {
            sibling.return = returnFiber;
            nextEffect = sibling;
            break a;
          }
          nextEffect = returnFiber;
        }
    }
  }
  function findFiberRootForHostRoot(hostRoot: RR.Instance): RR.Fiber { var hostRoot$asFiber: RR.Fiber | null;
    var maybeFiber: RR.Fiber | null | undefined = getInstanceFromNode(hostRoot);
    if (null != maybeFiber) {
      if ("string" !== typeof maybeFiber.memoizedProps["data-testname"])
        throw Error(formatProdErrorMessage(364));
      return maybeFiber;
    }
    hostRoot$asFiber = findFiberRoot!(hostRoot);
    if (null === hostRoot$asFiber) throw Error(formatProdErrorMessage(362));
    return (hostRoot$asFiber.stateNode as RR.FiberRoot).current!;
  }
  function matchSelector(fiber$jscomp$0: RR.Fiber, selector: RR.Selector): boolean { var fiber$jscomp$0$asStack: (RR.Fiber | number)[], fiber$jscomp$0$asText: string | null, fiber$jscomp$0$asTestName: unknown, selector$asSelectors: RR.Selector[], selector$asResult: boolean, fiber$asChild: RR.Fiber | null, tag$asIndex: number;
    var tag: RR.WorkTag = fiber$jscomp$0.tag;
    switch (selector.$$typeof) {
      case COMPONENT_TYPE:
        if (fiber$jscomp$0.type === selector.value) return !0;
        break;
      case HAS_PSEUDO_CLASS_TYPE:
        a: {
          selector$asSelectors = selector.value as RR.Selector[];
          fiber$jscomp$0$asStack = [fiber$jscomp$0, 0];
          for (tag$asIndex = 0; tag$asIndex < fiber$jscomp$0$asStack.length; ) {
            var fiber: RR.Fiber = fiber$jscomp$0$asStack[tag$asIndex++] as RR.Fiber,
              tag$jscomp$0: RR.WorkTag = fiber.tag,
              selectorIndex: number = fiber$jscomp$0$asStack[tag$asIndex++] as number,
              selector$jscomp$0: RR.Selector | undefined = selector$asSelectors[selectorIndex];
            if (
              (5 !== tag$jscomp$0 &&
                26 !== tag$jscomp$0 &&
                27 !== tag$jscomp$0) ||
              !isHiddenSubtree!(fiber)
            ) {
              for (
                ;
                null != selector$jscomp$0 &&
                matchSelector(fiber, selector$jscomp$0);

              )
                selectorIndex++, (selector$jscomp$0 = selector$asSelectors[selectorIndex]);
              if (selectorIndex === selector$asSelectors.length) {
                selector$asResult = !0;
                break a;
              } else
                for (fiber$asChild = fiber.child; null !== fiber$asChild; )
                  fiber$jscomp$0$asStack.push(fiber$asChild, selectorIndex),
                    (fiber$asChild = fiber$asChild.sibling);
            }
          }
          selector$asResult = !1;
        }
        return selector$asResult;
      case ROLE_TYPE:
        if (
          (5 === tag || 26 === tag || 27 === tag) &&
          matchAccessibilityRole!(fiber$jscomp$0.stateNode, selector.value)
        )
          return !0;
        break;
      case TEXT_TYPE:
        if (5 === tag || 6 === tag || 26 === tag || 27 === tag)
          if (
            ((fiber$jscomp$0$asText = getTextContent!(fiber$jscomp$0)),
            null !== fiber$jscomp$0$asText &&
              0 <= fiber$jscomp$0$asText.indexOf(selector.value))
          )
            return !0;
        break;
      case TEST_NAME_TYPE:
        if (5 === tag || 26 === tag || 27 === tag)
          if (
            ((fiber$jscomp$0$asTestName = fiber$jscomp$0.memoizedProps["data-testname"]),
            "string" === typeof fiber$jscomp$0$asTestName &&
              fiber$jscomp$0$asTestName.toLowerCase() === selector.value.toLowerCase())
          )
            return !0;
        break;
      default:
        throw Error(formatProdErrorMessage(365));
    }
    return !1;
  }
  function selectorToString(selector: RR.Selector): string {
    switch (selector.$$typeof) {
      case COMPONENT_TYPE:
        return (
          "<" + (getComponentNameFromType(selector.value) || "Unknown") + ">"
        );
      case HAS_PSEUDO_CLASS_TYPE:
        return ":has(" + (selectorToString(selector) || "") + ")";
      case ROLE_TYPE:
        return '[role="' + selector.value + '"]';
      case TEXT_TYPE:
        return '"' + selector.value + '"';
      case TEST_NAME_TYPE:
        return '[data-testname="' + selector.value + '"]';
      default:
        throw Error(formatProdErrorMessage(365));
    }
  }
  function findPaths(root: RR.Fiber, selectors: RR.Selector[]): RR.Fiber[] { var root$asStack: (RR.Fiber | number)[], fiber$asChild: RR.Fiber | null;
    var matchingFibers: RR.Fiber[] = [];
    root$asStack = [root, 0];
    for (var index = 0; index < root$asStack.length; ) {
      var fiber: RR.Fiber = root$asStack[index++] as RR.Fiber,
        tag: RR.WorkTag = fiber.tag,
        selectorIndex: number = root$asStack[index++] as number,
        selector: RR.Selector | undefined = selectors[selectorIndex];
      if ((5 !== tag && 26 !== tag && 27 !== tag) || !isHiddenSubtree!(fiber)) {
        for (; null != selector && matchSelector(fiber, selector); )
          selectorIndex++, (selector = selectors[selectorIndex]);
        if (selectorIndex === selectors.length) matchingFibers.push(fiber);
        else
          for (fiber$asChild = fiber.child; null !== fiber$asChild; )
            root$asStack.push(fiber$asChild, selectorIndex), (fiber$asChild = fiber$asChild.sibling);
      }
    }
    return matchingFibers;
  }
  function findAllNodes(hostRoot: RR.Instance, selectors: RR.Selector[]): RR.StateNode[] { var hostRoot$asRoot: RR.Fiber, hostRoot$asMatches: RR.Fiber[], hostRoot$asStack: RR.Fiber[], selectors$asInstances: RR.StateNode[], node$asChild: RR.Fiber | null;
    if (!supportsTestSelectors) throw Error(formatProdErrorMessage(363));
    hostRoot$asRoot = findFiberRootForHostRoot(hostRoot);
    hostRoot$asMatches = findPaths(hostRoot$asRoot, selectors);
    selectors$asInstances = [] as RR.StateNode[];
    hostRoot$asStack = Array.from(hostRoot$asMatches);
    for (var index = 0; index < hostRoot$asStack.length; ) {
      var node: RR.Fiber = hostRoot$asStack[index++],
        tag: RR.WorkTag = node.tag;
      if (5 === tag || 26 === tag || 27 === tag)
        isHiddenSubtree!(node) || selectors$asInstances.push(node.stateNode);
      else
        for (node$asChild = node.child; null !== node$asChild; )
          hostRoot$asStack.push(node$asChild), (node$asChild = node$asChild.sibling);
    }
    return selectors$asInstances;
  }
  function requestUpdateLane(fiber?: RR.Fiber): RR.Lane; function requestUpdateLane(): RR.Lane {
    return 0 !== (executionContext & 2) && 0 !== workInProgressRootRenderLanes
      ? workInProgressRootRenderLanes & -workInProgressRootRenderLanes
      : null !== ReactSharedInternals.T
        ? requestTransitionLane()
        : resolveUpdatePriority() as RR.Lane;
  }
  function requestDeferredLane(): RR.Lane { var lane$asHandler: RR.Fiber | null;
    if (0 === workInProgressDeferredLane)
      if (0 === (workInProgressRootRenderLanes & 536870912) || isHydrating) {
        var lane: RR.Lane = nextTransitionDeferredLane;
        nextTransitionDeferredLane <<= 1;
        0 === (nextTransitionDeferredLane & 3932160) &&
          (nextTransitionDeferredLane = 262144);
        workInProgressDeferredLane = lane;
      } else workInProgressDeferredLane = 536870912;
    lane$asHandler = suspenseHandlerStackCursor.current;
    null !== lane$asHandler && (lane$asHandler.flags |= 32);
    return workInProgressDeferredLane;
  }
  function scheduleUpdateOnFiber(root: RR.FiberRoot, fiber: RR.Fiber, lane: RR.Lane): void {
    if (
      (root === workInProgressRoot &&
        (2 === workInProgressSuspendedReason ||
          9 === workInProgressSuspendedReason)) ||
      null !== root.cancelPendingCommit
    )
      prepareFreshStack(root, 0),
        markRootSuspended(
          root,
          workInProgressRootRenderLanes,
          workInProgressDeferredLane,
          !1
        );
    markRootUpdated$1(root, lane);
    if (0 === (executionContext & 2) || root !== workInProgressRoot)
      root === workInProgressRoot &&
        (0 === (executionContext & 2) &&
          (workInProgressRootInterleavedUpdatedLanes |= lane),
        4 === workInProgressRootExitStatus &&
          markRootSuspended(
            root,
            workInProgressRootRenderLanes,
            workInProgressDeferredLane,
            !1
          )),
        ensureRootIsScheduled(root);
  }
  function performWorkOnRoot(root$jscomp$0: RR.FiberRoot, lanes: RR.Lanes, forceSync: boolean): void { var forceSync$asFinishedWork: RR.Fiber, shouldTimeSlice$asRoot: RR.FiberRoot, exitStatus$asErrors: RR.CapturedValue[] | null, exitStatus$asDelay: RR.Milliseconds, renderWasConcurrent$asErroredLanes: RR.Lanes, renderWasConcurrent$asErrors: RR.CapturedValue[] | null, renderWasConcurrent$asExitStatus: RR.RootExitStatus, JSCompiler_inline_result$asExitStatus: RR.RootExitStatus;
    if (0 !== (executionContext & 6)) throw Error(formatProdErrorMessage(327));
    var shouldTimeSlice: boolean =
        (!forceSync &&
          0 === (lanes & 127) &&
          0 === (lanes & root$jscomp$0.expiredLanes)) ||
        checkIfRootIsPrerendering(root$jscomp$0, lanes),
      exitStatus: RR.RootExitStatus = shouldTimeSlice
        ? renderRootConcurrent(root$jscomp$0, lanes)
        : renderRootSync(root$jscomp$0, lanes, !0),
      renderWasConcurrent: boolean = shouldTimeSlice;
    do {
      if (0 === exitStatus) {
        workInProgressRootIsPrerendering &&
          !shouldTimeSlice &&
          markRootSuspended(root$jscomp$0, lanes, 0, !1);
        break;
      } else {
        forceSync$asFinishedWork = root$jscomp$0.current!.alternate!;
        if (
          renderWasConcurrent &&
          !isRenderConsistentWithExternalStores(forceSync$asFinishedWork)
        ) {
          exitStatus = renderRootSync(root$jscomp$0, lanes, !1);
          renderWasConcurrent = !1;
          continue;
        }
        if (2 === exitStatus) {
          renderWasConcurrent$asErroredLanes = lanes;
          if (root$jscomp$0.errorRecoveryDisabledLanes & renderWasConcurrent$asErroredLanes)
            var JSCompiler_inline_result: RR.Lanes = 0;
          else
            (JSCompiler_inline_result =
              root$jscomp$0.pendingLanes & -536870913),
              (JSCompiler_inline_result =
                0 !== JSCompiler_inline_result
                  ? JSCompiler_inline_result
                  : JSCompiler_inline_result & 536870912
                    ? 536870912
                    : 0);
          if (0 !== JSCompiler_inline_result) {
            lanes = JSCompiler_inline_result;
            a: {
              var root: RR.FiberRoot = root$jscomp$0;
              exitStatus$asErrors = workInProgressRootConcurrentErrors;
              var wasRootDehydrated: boolean =
                supportsHydration && (root.current!.memoizedState as RR.RootState).isDehydrated;
              wasRootDehydrated &&
                (prepareFreshStack(root, JSCompiler_inline_result).flags |=
                  256);
              JSCompiler_inline_result$asExitStatus = renderRootSync(
                root,
                JSCompiler_inline_result,
                !1
              );
              if (2 !== JSCompiler_inline_result$asExitStatus) {
                if (
                  workInProgressRootDidAttachPingListener &&
                  !wasRootDehydrated
                ) {
                  root.errorRecoveryDisabledLanes |= renderWasConcurrent$asErroredLanes;
                  workInProgressRootInterleavedUpdatedLanes |=
                    renderWasConcurrent$asErroredLanes;
                  exitStatus = 4;
                  break a;
                }
                renderWasConcurrent$asErrors = workInProgressRootRecoverableErrors;
                workInProgressRootRecoverableErrors = exitStatus$asErrors;
                null !== renderWasConcurrent$asErrors &&
                  (null === workInProgressRootRecoverableErrors
                    ? (workInProgressRootRecoverableErrors =
                        renderWasConcurrent$asErrors)
                    : workInProgressRootRecoverableErrors.push.apply(
                        workInProgressRootRecoverableErrors,
                        renderWasConcurrent$asErrors
                      ));
              }
              exitStatus = JSCompiler_inline_result$asExitStatus;
            }
            renderWasConcurrent = !1;
            if (2 !== exitStatus) continue;
          }
        }
        if (1 === exitStatus) {
          prepareFreshStack(root$jscomp$0, 0);
          markRootSuspended(root$jscomp$0, lanes, 0, !0);
          break;
        }
        a: {
          shouldTimeSlice$asRoot = root$jscomp$0;
          renderWasConcurrent$asExitStatus = exitStatus;
          switch (renderWasConcurrent$asExitStatus) {
            case 0:
            case 1:
              throw Error(formatProdErrorMessage(345));
            case 4:
              if ((lanes & 4194048) !== lanes) break;
            case 6:
              markRootSuspended(
                shouldTimeSlice$asRoot,
                lanes,
                workInProgressDeferredLane,
                !workInProgressRootDidSkipSuspendedSiblings
              );
              break a;
            case 2:
              workInProgressRootRecoverableErrors = null;
              break;
            case 3:
            case 5:
              break;
            default:
              throw Error(formatProdErrorMessage(329));
          }
          if (
            (lanes & 62914560) === lanes &&
            ((exitStatus$asDelay = globalMostRecentFallbackTime + 300 - now()),
            10 < exitStatus$asDelay)
          ) {
            markRootSuspended(
              shouldTimeSlice$asRoot,
              lanes,
              workInProgressDeferredLane,
              !workInProgressRootDidSkipSuspendedSiblings
            );
            if (0 !== getNextLanes(shouldTimeSlice$asRoot, 0, !0)) break a;
            pendingEffectsLanes = lanes;
            shouldTimeSlice$asRoot.timeoutHandle = scheduleTimeout(
              commitRootWhenReady.bind(
                null,
                shouldTimeSlice$asRoot,
                forceSync$asFinishedWork,
                workInProgressRootRecoverableErrors,
                workInProgressTransitions,
                workInProgressRootDidIncludeRecursiveRenderUpdate,
                lanes,
                workInProgressDeferredLane,
                workInProgressRootInterleavedUpdatedLanes,
                workInProgressSuspendedRetryLanes,
                workInProgressRootDidSkipSuspendedSiblings,
                renderWasConcurrent$asExitStatus,
                "Throttled",
                -0,
                0
              ),
              exitStatus$asDelay
            );
            break a;
          }
          commitRootWhenReady(
            shouldTimeSlice$asRoot,
            forceSync$asFinishedWork,
            workInProgressRootRecoverableErrors,
            workInProgressTransitions,
            workInProgressRootDidIncludeRecursiveRenderUpdate,
            lanes,
            workInProgressDeferredLane,
            workInProgressRootInterleavedUpdatedLanes,
            workInProgressSuspendedRetryLanes,
            workInProgressRootDidSkipSuspendedSiblings,
            renderWasConcurrent$asExitStatus,
            null,
            -0,
            0
          );
        }
      }
      break;
    } while (1);
    ensureRootIsScheduled(root$jscomp$0);
  }
  function commitRootWhenReady(
    root: RR.FiberRoot,
    finishedWork: RR.Fiber,
    recoverableErrors: RR.CapturedValue[] | null,
    transitions: RR.Transition[] | null,
    didIncludeRenderPhaseUpdate: boolean,
    lanes: RR.Lanes,
    spawnedLane: RR.Lane,
    updatedLanes: RR.Lanes,
    suspendedRetryLanes: RR.Lanes,
    didSkipSuspendedSiblings: boolean,
    exitStatus: RR.RootExitStatus,
    suspendedCommitReason: RR.SuspendedCommitReason,
    completedRenderStartTime: RR.Milliseconds,
    completedRenderEndTime: RR.Milliseconds
  ): void { var suspendedCommitReason$asFlags: RR.Flags, suspendedCommitReason$asState: RR.SuspendedState, timeoutOffset$asSchedule: RR.ScheduleCommit | null;
    root.timeoutHandle = noTimeout;
    suspendedCommitReason$asFlags = finishedWork.subtreeFlags;
    if (
      suspendedCommitReason$asFlags & 8192 ||
      16785408 === (suspendedCommitReason$asFlags & 16785408)
    ) {
      suspendedCommitReason$asState = startSuspendingCommit();
      accumulateSuspenseyCommitOnFiber(
        finishedWork,
        lanes,
        suspendedCommitReason$asState
      );
      var timeoutOffset: RR.Milliseconds =
        (lanes & 62914560) === lanes
          ? globalMostRecentFallbackTime - now()
          : (lanes & 4194048) === lanes
            ? globalMostRecentTransitionTime - now()
            : 0;
      timeoutOffset$asSchedule = waitForCommitToBeReady(
        suspendedCommitReason$asState,
        timeoutOffset
      );
      if (null !== timeoutOffset$asSchedule) {
        pendingEffectsLanes = lanes;
        root.cancelPendingCommit = timeoutOffset$asSchedule(
          commitRoot.bind(
            null,
            root,
            finishedWork,
            lanes,
            recoverableErrors,
            transitions,
            didIncludeRenderPhaseUpdate,
            spawnedLane,
            updatedLanes,
            suspendedRetryLanes,
            exitStatus,
            suspendedCommitReason$asState,
            null,
            completedRenderStartTime,
            completedRenderEndTime
          )
        );
        markRootSuspended(root, lanes, spawnedLane, !didSkipSuspendedSiblings);
        return;
      }
    }
    commitRoot(
      root,
      finishedWork,
      lanes,
      recoverableErrors,
      transitions,
      didIncludeRenderPhaseUpdate,
      spawnedLane,
      updatedLanes,
      suspendedRetryLanes
    );
  }
  function isRenderConsistentWithExternalStores(finishedWork: RR.Fiber): boolean { var tag$asQueueThenStores: RR.FunctionComponentUpdateQueue | RR.StoreConsistencyCheck[] | null, tag$asChild: RR.Fiber | null, check$asValue: RR.StoreConsistencyCheck["value"];
    for (var node: RR.Fiber = finishedWork; ; ) {
      var tag: RR.WorkTag = node.tag;
      if (
        (0 === tag || 11 === tag || 15 === tag) &&
        node.flags & 16384 &&
        ((tag$asQueueThenStores = node.updateQueue as RR.FunctionComponentUpdateQueue | null),
        null !== tag$asQueueThenStores && ((tag$asQueueThenStores = tag$asQueueThenStores.stores), null !== tag$asQueueThenStores))
      )
        for (var i = 0; i < (tag$asQueueThenStores as RR.StoreConsistencyCheck[]).length; i++) {
          var check: RR.StoreConsistencyCheck = (tag$asQueueThenStores as RR.StoreConsistencyCheck[])[i],
            getSnapshot: RR.GetSnapshot = check.getSnapshot;
          check$asValue = check.value;
          try {
            if (!objectIs(getSnapshot(), check$asValue)) return !1;
          } catch (error) {
            return !1;
          }
        }
      tag$asChild = node.child;
      if (node.subtreeFlags & 16384 && null !== tag$asChild)
        (tag$asChild.return = node), (node = tag$asChild);
      else {
        if (node === finishedWork) break;
        for (; null === node.sibling; ) {
          if (null === node.return || node.return === finishedWork) return !0;
          node = node.return;
        }
        node.sibling.return = node.return;
        node = node.sibling;
      }
    }
    return !0;
  }
  function markRootSuspended(
    root: RR.FiberRoot,
    suspendedLanes: RR.Lanes,
    spawnedLane: RR.Lane,
    didAttemptEntireTree: boolean
  ): void { var didAttemptEntireTree$asTimes: RR.FiberRoot["expirationTimes"];
    suspendedLanes &= ~workInProgressRootPingedLanes;
    suspendedLanes &= ~workInProgressRootInterleavedUpdatedLanes;
    root.suspendedLanes |= suspendedLanes;
    root.pingedLanes &= ~suspendedLanes;
    didAttemptEntireTree && (root.warmLanes |= suspendedLanes);
    didAttemptEntireTree$asTimes = root.expirationTimes;
    for (var lanes: RR.Lanes = suspendedLanes; 0 < lanes; ) {
      var index$4: number = 31 - clz32(lanes),
        lane: RR.Lane = 1 << index$4;
      didAttemptEntireTree$asTimes[index$4] = -1;
      lanes &= ~lane;
    }
    0 !== spawnedLane &&
      markSpawnedDeferredLane(root, spawnedLane, suspendedLanes);
  }
  function flushSyncWork(): boolean {
    return 0 === (executionContext & 6)
      ? (flushSyncWorkAcrossRoots_impl(0, !1), !1)
      : !0;
  }
  function resetWorkInProgressStack(): void {
    if (null !== workInProgress) {
      if (0 === workInProgressSuspendedReason)
        var interruptedWork: RR.Fiber | null = workInProgress.return;
      else
        (interruptedWork = workInProgress),
          (lastContextDependency = currentlyRenderingFiber$1 = null),
          resetHooksOnUnwind(interruptedWork),
          (thenableState$1 = null),
          (thenableIndexCounter$1 = 0),
          (interruptedWork = workInProgress);
      for (; null !== interruptedWork; )
        unwindInterruptedWork(interruptedWork.alternate, interruptedWork),
          (interruptedWork = interruptedWork.return);
      workInProgress = null;
    }
  }
  function prepareFreshStack(root: RR.FiberRoot, lanes: RR.Lanes): RR.Fiber { var root$asEntanglements: RR.FiberRoot["entanglements"], timeoutHandle$asCancel: RR.FiberRoot["cancelPendingCommit"], timeoutHandle$asFiber: RR.Fiber;
    var timeoutHandle: RR.TimeoutHandle | RR.NoTimeout = root.timeoutHandle;
    timeoutHandle !== noTimeout &&
      ((root.timeoutHandle = noTimeout), cancelTimeout(timeoutHandle));
    timeoutHandle$asCancel = root.cancelPendingCommit;
    null !== timeoutHandle$asCancel &&
      ((root.cancelPendingCommit = null), timeoutHandle$asCancel());
    pendingEffectsLanes = 0;
    resetWorkInProgressStack();
    workInProgressRoot = root;
    workInProgress = timeoutHandle$asFiber = createWorkInProgress(root.current!, null);
    workInProgressRootRenderLanes = lanes;
    workInProgressSuspendedReason = 0;
    workInProgressThrownValue = null;
    workInProgressRootDidSkipSuspendedSiblings = !1;
    workInProgressRootIsPrerendering = checkIfRootIsPrerendering(root, lanes);
    workInProgressRootDidAttachPingListener = !1;
    workInProgressSuspendedRetryLanes =
      workInProgressDeferredLane =
      workInProgressRootPingedLanes =
      workInProgressRootInterleavedUpdatedLanes =
      workInProgressRootSkippedLanes =
      workInProgressRootExitStatus =
        0;
    workInProgressRootRecoverableErrors = workInProgressRootConcurrentErrors =
      null;
    workInProgressRootDidIncludeRecursiveRenderUpdate = !1;
    0 !== (lanes & 8) && (lanes |= lanes & 32);
    var allEntangledLanes: RR.Lanes = root.entangledLanes;
    if (0 !== allEntangledLanes)
      for (
        root$asEntanglements = root.entanglements, allEntangledLanes &= lanes;
        0 < allEntangledLanes;

      ) {
        var index$2: number = 31 - clz32(allEntangledLanes),
          lane: RR.Lane = 1 << index$2;
        lanes |= root$asEntanglements[index$2];
        allEntangledLanes &= ~lane;
      }
    entangledRenderLanes = lanes;
    finishQueueingConcurrentUpdates();
    return timeoutHandle$asFiber;
  }
  function handleThrow(root: RR.FiberRoot, thrownValue: RR.Thrown): void {
    currentlyRenderingFiber = null;
    ReactSharedInternals.H = ContextOnlyDispatcher;
    thrownValue === SuspenseException || thrownValue === SuspenseActionException
      ? ((thrownValue = getSuspendedThenable()),
        (workInProgressSuspendedReason = 3))
      : thrownValue === SuspenseyCommitException
        ? ((thrownValue = getSuspendedThenable()),
          (workInProgressSuspendedReason = 4))
        : (workInProgressSuspendedReason =
            thrownValue === SelectiveHydrationException
              ? 8
              : null !== thrownValue &&
                  "object" === typeof thrownValue &&
                  "function" === typeof thrownValue.then
                ? 6
                : 1);
    workInProgressThrownValue = thrownValue;
    null === workInProgress &&
      ((workInProgressRootExitStatus = 1),
      logUncaughtError(
        root,
        createCapturedValueAtFiber(thrownValue, root.current!)
      ));
  }
  function shouldRemainOnPreviousScreen(): boolean {
    var handler: RR.Fiber | null = suspenseHandlerStackCursor.current;
    return null === handler
      ? !0
      : (workInProgressRootRenderLanes & 4194048) ===
          workInProgressRootRenderLanes
        ? null === shellBoundary
          ? !0
          : !1
        : (workInProgressRootRenderLanes & 62914560) ===
              workInProgressRootRenderLanes ||
            0 !== (workInProgressRootRenderLanes & 536870912)
          ? handler === shellBoundary
          : !1;
  }
  function pushDispatcher(): RR.Dispatcher {
    var prevDispatcher: RR.Dispatcher | null = ReactSharedInternals.H;
    ReactSharedInternals.H = ContextOnlyDispatcher;
    return null === prevDispatcher ? ContextOnlyDispatcher : prevDispatcher;
  }
  function pushAsyncDispatcher(): RR.AsyncDispatcher | null {
    var prevAsyncDispatcher: RR.AsyncDispatcher | null = ReactSharedInternals.A;
    ReactSharedInternals.A = DefaultAsyncDispatcher;
    return prevAsyncDispatcher;
  }
  function renderDidSuspendDelayIfPossible(): void {
    workInProgressRootExitStatus = 4;
    workInProgressRootDidSkipSuspendedSiblings ||
      ((workInProgressRootRenderLanes & 4194048) !==
        workInProgressRootRenderLanes &&
        null !== suspenseHandlerStackCursor.current) ||
      (workInProgressRootIsPrerendering = !0);
    (0 === (workInProgressRootSkippedLanes & 134217727) &&
      0 === (workInProgressRootInterleavedUpdatedLanes & 134217727)) ||
      null === workInProgressRoot ||
      markRootSuspended(
        workInProgressRoot,
        workInProgressRootRenderLanes,
        workInProgressDeferredLane,
        !1
      );
  }
  function renderRootSync(root: RR.FiberRoot, lanes: RR.Lanes, shouldYieldForPrerendering: boolean): RR.RootExitStatus { var lanes$asDidSuspendInShell: boolean;
    var prevExecutionContext: RR.ExecutionContext = executionContext;
    executionContext |= 2;
    var prevDispatcher: RR.Dispatcher = pushDispatcher(),
      prevAsyncDispatcher: RR.AsyncDispatcher | null = pushAsyncDispatcher();
    if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes)
      (workInProgressTransitions = null), prepareFreshStack(root, lanes);
    lanes$asDidSuspendInShell = !1;
    var exitStatus: RR.RootExitStatus = workInProgressRootExitStatus;
    a: do
      try {
        if (0 !== workInProgressSuspendedReason && null !== workInProgress) {
          var unitOfWork: RR.Fiber = workInProgress,
            thrownValue: RR.Thrown = workInProgressThrownValue;
          switch (workInProgressSuspendedReason) {
            case 8:
              resetWorkInProgressStack();
              exitStatus = 6;
              break a;
            case 3:
            case 2:
            case 9:
            case 6:
              null === suspenseHandlerStackCursor.current && (lanes$asDidSuspendInShell = !0);
              var reason: RR.SuspendedReason = workInProgressSuspendedReason;
              workInProgressSuspendedReason = 0;
              workInProgressThrownValue = null;
              throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
              if (
                shouldYieldForPrerendering &&
                workInProgressRootIsPrerendering
              ) {
                exitStatus = 0;
                break a;
              }
              break;
            default:
              (reason = workInProgressSuspendedReason),
                (workInProgressSuspendedReason = 0),
                (workInProgressThrownValue = null),
                throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
          }
        }
        workLoopSync();
        exitStatus = workInProgressRootExitStatus;
        break;
      } catch (thrownValue$152) {
        handleThrow(root, thrownValue$152);
      }
    while (1);
    lanes$asDidSuspendInShell && root.shellSuspendCounter++;
    lastContextDependency = currentlyRenderingFiber$1 = null;
    executionContext = prevExecutionContext;
    ReactSharedInternals.H = prevDispatcher;
    ReactSharedInternals.A = prevAsyncDispatcher;
    null === workInProgress &&
      ((workInProgressRoot = null),
      (workInProgressRootRenderLanes = 0),
      finishQueueingConcurrentUpdates());
    return exitStatus;
  }
  function workLoopSync(): void {
    for (; null !== workInProgress; ) performUnitOfWork(workInProgress);
  }
  function renderRootConcurrent(root: RR.FiberRoot, lanes: RR.Lanes): RR.RootExitStatus { var lanes$asUnitOfWork: RR.Fiber, lanes$asOnResolution: () => void;
    var prevExecutionContext: RR.ExecutionContext = executionContext;
    executionContext |= 2;
    var prevDispatcher: RR.Dispatcher = pushDispatcher(),
      prevAsyncDispatcher: RR.AsyncDispatcher | null = pushAsyncDispatcher();
    workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes
      ? ((workInProgressTransitions = null),
        (workInProgressRootRenderTargetTime = now() + 500),
        prepareFreshStack(root, lanes))
      : (workInProgressRootIsPrerendering = checkIfRootIsPrerendering(
          root,
          lanes
        ));
    a: do
      try {
        if (0 !== workInProgressSuspendedReason && null !== workInProgress) {
          lanes$asUnitOfWork = workInProgress;
          var thrownValue: RR.Thrown = workInProgressThrownValue;
          b: switch (workInProgressSuspendedReason) {
            case 1:
              workInProgressSuspendedReason = 0;
              workInProgressThrownValue = null;
              throwAndUnwindWorkLoop(root, lanes$asUnitOfWork, thrownValue, 1);
              break;
            case 2:
            case 9:
              if (isThenableResolved(thrownValue)) {
                workInProgressSuspendedReason = 0;
                workInProgressThrownValue = null;
                replaySuspendedUnitOfWork(lanes$asUnitOfWork);
                break;
              }
              lanes$asOnResolution = function () {
                (2 !== workInProgressSuspendedReason &&
                  9 !== workInProgressSuspendedReason) ||
                  workInProgressRoot !== root ||
                  (workInProgressSuspendedReason = 7);
                ensureRootIsScheduled(root);
              };
              thrownValue.then(lanes$asOnResolution, lanes$asOnResolution);
              break a;
            case 3:
              workInProgressSuspendedReason = 7;
              break a;
            case 4:
              workInProgressSuspendedReason = 5;
              break a;
            case 7:
              isThenableResolved(thrownValue)
                ? ((workInProgressSuspendedReason = 0),
                  (workInProgressThrownValue = null),
                  replaySuspendedUnitOfWork(lanes$asUnitOfWork))
                : ((workInProgressSuspendedReason = 0),
                  (workInProgressThrownValue = null),
                  throwAndUnwindWorkLoop(root, lanes$asUnitOfWork, thrownValue, 7));
              break;
            case 5:
              var resource: RR.ResourceArg = null;
              switch (workInProgress.tag) {
                case 26:
                  resource = workInProgress.memoizedState;
                case 5:
                case 27:
                  var hostFiber: RR.Fiber = workInProgress,
                    type: RR.HostType = hostFiber.type,
                    props: RR.Props = hostFiber.pendingProps;
                  if (
                    resource
                      ? preloadResource!(resource)
                      : preloadInstance(hostFiber.stateNode, type, props)
                  ) {
                    workInProgressSuspendedReason = 0;
                    workInProgressThrownValue = null;
                    var sibling: RR.Fiber | null = hostFiber.sibling;
                    if (null !== sibling) workInProgress = sibling;
                    else {
                      var returnFiber: RR.Fiber | null = hostFiber.return;
                      null !== returnFiber
                        ? ((workInProgress = returnFiber),
                          completeUnitOfWork(returnFiber))
                        : (workInProgress = null);
                    }
                    break b;
                  }
              }
              workInProgressSuspendedReason = 0;
              workInProgressThrownValue = null;
              throwAndUnwindWorkLoop(root, lanes$asUnitOfWork, thrownValue, 5);
              break;
            case 6:
              workInProgressSuspendedReason = 0;
              workInProgressThrownValue = null;
              throwAndUnwindWorkLoop(root, lanes$asUnitOfWork, thrownValue, 6);
              break;
            case 8:
              resetWorkInProgressStack();
              workInProgressRootExitStatus = 6;
              break a;
            default:
              throw Error(formatProdErrorMessage(462));
          }
        }
        workLoopConcurrentByScheduler();
        break;
      } catch (thrownValue$154) {
        handleThrow(root, thrownValue$154);
      }
    while (1);
    lastContextDependency = currentlyRenderingFiber$1 = null;
    ReactSharedInternals.H = prevDispatcher;
    ReactSharedInternals.A = prevAsyncDispatcher;
    executionContext = prevExecutionContext;
    if (null !== workInProgress) return 0;
    workInProgressRoot = null;
    workInProgressRootRenderLanes = 0;
    finishQueueingConcurrentUpdates();
    return workInProgressRootExitStatus;
  }
  function workLoopConcurrentByScheduler(): void {
    for (; null !== workInProgress && !shouldYield(); )
      performUnitOfWork(workInProgress);
  }
  function performUnitOfWork(unitOfWork: RR.Fiber): void {
    var next: RR.Fiber | null = beginWork(
      unitOfWork.alternate,
      unitOfWork,
      entangledRenderLanes
    );
    unitOfWork.memoizedProps = unitOfWork.pendingProps;
    null === next ? completeUnitOfWork(unitOfWork) : (workInProgress = next);
  }
  function replaySuspendedUnitOfWork(unitOfWork: RR.Fiber): void {
    var next: RR.Fiber | null = unitOfWork;
    var current: RR.Fiber | null = next.alternate;
    switch (next.tag) {
      case 15:
      case 0:
        next = replayFunctionComponent(
          current,
          next,
          next.pendingProps,
          next.type as RR.FunctionComponent,
          void 0,
          workInProgressRootRenderLanes
        );
        break;
      case 11:
        next = replayFunctionComponent(
          current,
          next,
          next.pendingProps,
          (next.type as RR.ForwardRefType).render,
          next.ref,
          workInProgressRootRenderLanes
        );
        break;
      case 5:
        resetHooksOnUnwind(next);
      default:
        unwindInterruptedWork(current, next),
          (next = workInProgress =
            resetWorkInProgress(next, entangledRenderLanes)),
          (next = beginWork(current, next, entangledRenderLanes));
    }
    unitOfWork.memoizedProps = unitOfWork.pendingProps;
    null === next ? completeUnitOfWork(unitOfWork) : (workInProgress = next);
  }
  function throwAndUnwindWorkLoop(
    root: RR.FiberRoot,
    unitOfWork: RR.Fiber,
    thrownValue: RR.Thrown,
    suspendedReason: RR.SuspendedReason
  ): void { var root$asSkip: boolean, suspendedReason$asHandler: RR.Fiber | null;
    lastContextDependency = currentlyRenderingFiber$1 = null;
    resetHooksOnUnwind(unitOfWork);
    thenableState$1 = null;
    thenableIndexCounter$1 = 0;
    var returnFiber: RR.Fiber | null = unitOfWork.return;
    try {
      if (
        throwException(
          root,
          returnFiber,
          unitOfWork,
          thrownValue,
          workInProgressRootRenderLanes
        )
      ) {
        workInProgressRootExitStatus = 1;
        logUncaughtError(
          root,
          createCapturedValueAtFiber(thrownValue, root.current!)
        );
        workInProgress = null;
        return;
      }
    } catch (error) {
      if (null !== returnFiber) throw ((workInProgress = returnFiber), error);
      workInProgressRootExitStatus = 1;
      logUncaughtError(
        root,
        createCapturedValueAtFiber(thrownValue, root.current!)
      );
      workInProgress = null;
      return;
    }
    if (unitOfWork.flags & 32768) {
      if (isHydrating || 1 === suspendedReason) root$asSkip = !0;
      else if (
        workInProgressRootIsPrerendering ||
        0 !== (workInProgressRootRenderLanes & 536870912)
      )
        root$asSkip = !1;
      else if (
        ((workInProgressRootDidSkipSuspendedSiblings = root$asSkip = !0),
        2 === suspendedReason ||
          9 === suspendedReason ||
          3 === suspendedReason ||
          6 === suspendedReason)
      )
        (suspendedReason$asHandler = suspenseHandlerStackCursor.current),
          null !== suspendedReason$asHandler &&
            13 === suspendedReason$asHandler.tag &&
            (suspendedReason$asHandler.flags |= 16384);
      unwindUnitOfWork(unitOfWork, root$asSkip);
    } else completeUnitOfWork(unitOfWork);
  }
  function completeUnitOfWork(unitOfWork: RR.Fiber): void { var unitOfWork$asReturn: RR.Fiber | null;
    var completedWork: RR.Fiber | null = unitOfWork;
    do {
      if (0 !== (completedWork.flags & 32768)) {
        unwindUnitOfWork(
          completedWork,
          workInProgressRootDidSkipSuspendedSiblings
        );
        return;
      }
      unitOfWork$asReturn = completedWork.return;
      var next: RR.Fiber | null = completeWork(
        completedWork.alternate,
        completedWork,
        entangledRenderLanes
      );
      if (null !== next) {
        workInProgress = next;
        return;
      }
      completedWork = completedWork.sibling;
      if (null !== completedWork) {
        workInProgress = completedWork;
        return;
      }
      workInProgress = completedWork = unitOfWork$asReturn;
    } while (null !== completedWork);
    0 === workInProgressRootExitStatus && (workInProgressRootExitStatus = 5);
  }
  function unwindUnitOfWork(unitOfWork$given: RR.Fiber, skipSiblings: boolean): void { var unitOfWork; unitOfWork = unitOfWork$given; var unitOfWork$asSibling: RR.Fiber | null;
    do {
      var next: RR.Fiber | null = unwindWork(unitOfWork.alternate, unitOfWork);
      if (null !== next) {
        next.flags &= 32767;
        workInProgress = next;
        return;
      }
      next = unitOfWork.return;
      null !== next &&
        ((next.flags |= 32768),
        (next.subtreeFlags = 0),
        (next.deletions = null));
      if (
        !skipSiblings &&
        ((unitOfWork$asSibling = unitOfWork.sibling), null !== unitOfWork$asSibling)
      ) {
        workInProgress = unitOfWork$asSibling;
        return;
      }
      workInProgress = unitOfWork = next;
    } while (null !== unitOfWork);
    workInProgressRootExitStatus = 6;
    workInProgress = null;
  }
  function commitRoot(root: RR.FiberRoot, finishedWork: RR.Fiber | null, lanes: RR.Lanes, recoverableErrors: RR.CapturedValue[] | null, transitions: RR.Transition[] | null, didIncludeRenderPhaseUpdate: boolean, spawnedLane: RR.Lane, updatedLanes: RR.Lanes, suspendedRetryLanes: RR.Lanes, exitStatus?: RR.RootExitStatus, suspendedState?: RR.SuspendedState, suspendedCommitReason?: null, completedRenderStartTime?: RR.Milliseconds, completedRenderEndTime?: RR.Milliseconds): void; function commitRoot(
    root: RR.FiberRoot,
    finishedWork: RR.Fiber | null,
    lanes: RR.Lanes,
    recoverableErrors: RR.CapturedValue[] | null,
    transitions: RR.Transition[] | null,
    didIncludeRenderPhaseUpdate: boolean,
    spawnedLane: RR.Lane,
    updatedLanes: RR.Lanes,
    suspendedRetryLanes: RR.Lanes
  ): void { var recoverableErrors$asHasEffect: boolean, recoverableErrors$asTransition: RR.Transition | null, transitions$asPriority: RR.EventPriority, didIncludeRenderPhaseUpdate$asLanes: RR.Lanes, spawnedLane$asContext: RR.ExecutionContext;
    root.cancelPendingCommit = null;
    do flushPendingEffects();
    while (0 !== pendingEffectsStatus);
    if (0 !== (executionContext & 6)) throw Error(formatProdErrorMessage(327));
    if (null !== finishedWork) {
      if (finishedWork === root.current)
        throw Error(formatProdErrorMessage(177));
      didIncludeRenderPhaseUpdate$asLanes =
        finishedWork.lanes | finishedWork.childLanes;
      didIncludeRenderPhaseUpdate$asLanes |= concurrentlyUpdatedLanes;
      markRootFinished(
        root,
        lanes,
        didIncludeRenderPhaseUpdate$asLanes,
        spawnedLane,
        updatedLanes,
        suspendedRetryLanes
      );
      root === workInProgressRoot &&
        ((workInProgress = workInProgressRoot = null),
        (workInProgressRootRenderLanes = 0));
      pendingFinishedWork = finishedWork;
      pendingEffectsRoot = root;
      pendingEffectsLanes = lanes;
      pendingEffectsRemainingLanes = didIncludeRenderPhaseUpdate$asLanes;
      pendingPassiveTransitions = transitions;
      pendingRecoverableErrors = recoverableErrors;
      0 !== (finishedWork.subtreeFlags & 10256) ||
      0 !== (finishedWork.flags & 10256)
        ? ((root.callbackNode = null),
          (root.callbackPriority = 0),
          scheduleCallback(NormalPriority$1, function () {
            flushPassiveEffects();
            return null;
          }))
        : ((root.callbackNode = null), (root.callbackPriority = 0));
      recoverableErrors$asHasEffect = 0 !== (finishedWork.flags & 13878);
      if (0 !== (finishedWork.subtreeFlags & 13878) || recoverableErrors$asHasEffect) {
        recoverableErrors$asTransition = ReactSharedInternals.T;
        ReactSharedInternals.T = null;
        transitions$asPriority = getCurrentUpdatePriority();
        setCurrentUpdatePriority(2);
        spawnedLane$asContext = executionContext;
        executionContext |= 4;
        try {
          commitBeforeMutationEffects(root, finishedWork, lanes);
        } finally {
          (executionContext = spawnedLane$asContext),
            setCurrentUpdatePriority(transitions$asPriority),
            (ReactSharedInternals.T = recoverableErrors$asTransition);
        }
      }
      pendingEffectsStatus = 1;
      flushMutationEffects();
      flushLayoutEffects();
      flushSpawnedWork();
    }
  }
  function flushMutationEffects() { var rootMutationHasEffect$asTransition: RR.Transition | null;
    if (1 === pendingEffectsStatus) {
      pendingEffectsStatus = 0;
      var root: RR.FiberRoot = pendingEffectsRoot!,
        finishedWork: RR.Fiber = pendingFinishedWork!,
        rootMutationHasEffect: boolean = 0 !== (finishedWork.flags & 13878);
      if (0 !== (finishedWork.subtreeFlags & 13878) || rootMutationHasEffect) {
        rootMutationHasEffect$asTransition = ReactSharedInternals.T;
        ReactSharedInternals.T = null;
        var previousPriority: RR.EventPriority = getCurrentUpdatePriority();
        setCurrentUpdatePriority(2);
        var prevExecutionContext: RR.ExecutionContext = executionContext;
        executionContext |= 4;
        try {
          commitMutationEffectsOnFiber(finishedWork, root),
            resetAfterCommit(root.containerInfo);
        } finally {
          (executionContext = prevExecutionContext),
            setCurrentUpdatePriority(previousPriority),
            (ReactSharedInternals.T = rootMutationHasEffect$asTransition);
        }
      }
      root.current = finishedWork;
      pendingEffectsStatus = 2;
    }
  }
  function flushLayoutEffects() { var rootHasLayoutEffect$asTransition: RR.Transition | null;
    if (2 === pendingEffectsStatus) {
      pendingEffectsStatus = 0;
      var root: RR.FiberRoot = pendingEffectsRoot!,
        finishedWork: RR.Fiber = pendingFinishedWork!,
        rootHasLayoutEffect: boolean = 0 !== (finishedWork.flags & 8772);
      if (0 !== (finishedWork.subtreeFlags & 8772) || rootHasLayoutEffect) {
        rootHasLayoutEffect$asTransition = ReactSharedInternals.T;
        ReactSharedInternals.T = null;
        var previousPriority: RR.EventPriority = getCurrentUpdatePriority();
        setCurrentUpdatePriority(2);
        var prevExecutionContext: RR.ExecutionContext = executionContext;
        executionContext |= 4;
        try {
          commitLayoutEffectOnFiber(root, finishedWork.alternate, finishedWork);
        } finally {
          (executionContext = prevExecutionContext),
            setCurrentUpdatePriority(previousPriority),
            (ReactSharedInternals.T = rootHasLayoutEffect$asTransition);
        }
      }
      pendingEffectsStatus = 3;
    }
  }
  function flushSpawnedWork() { var finishedWork$asRoot: RR.FiberRoot, finishedWork$asTransition: RR.Transition | null, remainingLanes$asPriority: RR.EventPriority;
    if (4 === pendingEffectsStatus || 3 === pendingEffectsStatus) {
      pendingEffectsStatus = 0;
      requestPaint();
      var root: RR.FiberRoot = pendingEffectsRoot!,
        finishedWork: RR.Fiber = pendingFinishedWork!,
        lanes: RR.Lanes = pendingEffectsLanes,
        recoverableErrors: RR.CapturedValue[] | null = pendingRecoverableErrors;
      0 !== (finishedWork.subtreeFlags & 10256) ||
      0 !== (finishedWork.flags & 10256)
        ? (pendingEffectsStatus = 5)
        : ((pendingEffectsStatus = 0),
          (pendingFinishedWork = pendingEffectsRoot = null),
          releaseRootPooledCache(root, root.pendingLanes));
      var remainingLanes: RR.Lanes = root.pendingLanes;
      0 === remainingLanes && (legacyErrorBoundariesThatAlreadyFailed = null);
      lanesToEventPriority(lanes);
      finishedWork$asRoot = finishedWork.stateNode as RR.FiberRoot;
      if (injectedHook && "function" === typeof injectedHook.onCommitFiberRoot)
        try {
          injectedHook.onCommitFiberRoot(
            rendererID,
            finishedWork$asRoot,
            void 0,
            128 === (finishedWork$asRoot.current!.flags & 128)
          );
        } catch (err) {}
      if (null !== recoverableErrors) {
        finishedWork$asTransition = ReactSharedInternals.T;
        remainingLanes$asPriority = getCurrentUpdatePriority();
        setCurrentUpdatePriority(2);
        ReactSharedInternals.T = null;
        try {
          for (
            var onRecoverableError: RR.OnRecoverableError = root.onRecoverableError, i = 0;
            i < recoverableErrors.length;
            i++
          ) {
            var recoverableError: RR.CapturedValue = recoverableErrors[i];
            onRecoverableError(recoverableError.value, {
              componentStack: recoverableError.stack
            });
          }
        } finally {
          (ReactSharedInternals.T = finishedWork$asTransition),
            setCurrentUpdatePriority(remainingLanes$asPriority);
        }
      }
      0 !== (pendingEffectsLanes & 3) && flushPendingEffects();
      ensureRootIsScheduled(root);
      remainingLanes = root.pendingLanes;
      0 !== (lanes & 261930) && 0 !== (remainingLanes & 42)
        ? root === rootWithNestedUpdates
          ? nestedUpdateCount++
          : ((nestedUpdateCount = 0), (rootWithNestedUpdates = root))
        : (nestedUpdateCount = 0);
      supportsHydration && flushHydrationEvents!();
      flushSyncWorkAcrossRoots_impl(0, !1);
    }
  }
  function releaseRootPooledCache(root: RR.FiberRoot, remainingLanes: RR.Lanes): void { var remainingLanes$asCache: RR.Cache | null;
    0 === (root.pooledCacheLanes &= remainingLanes) &&
      ((remainingLanes$asCache = root.pooledCache),
      null != remainingLanes$asCache &&
        ((root.pooledCache = null), releaseCache(remainingLanes$asCache)));
  }
  function flushPendingEffects(): boolean {
    flushMutationEffects();
    flushLayoutEffects();
    flushSpawnedWork();
    return flushPassiveEffects();
  }
  function flushPassiveEffects(): boolean { var renderPriority$asTransition: RR.Transition | null, priority$asTransitions: RR.Transition[] | null;
    if (5 !== pendingEffectsStatus) return !1;
    var root: RR.FiberRoot = pendingEffectsRoot!,
      remainingLanes: RR.Lanes = pendingEffectsRemainingLanes;
    pendingEffectsRemainingLanes = 0;
    var renderPriority: RR.EventPriority = lanesToEventPriority(pendingEffectsLanes),
      priority: RR.EventPriority = 32 > renderPriority ? 32 : renderPriority;
    renderPriority$asTransition = ReactSharedInternals.T;
    var previousPriority: RR.EventPriority = getCurrentUpdatePriority();
    try {
      setCurrentUpdatePriority(priority);
      ReactSharedInternals.T = null;
      priority$asTransitions = pendingPassiveTransitions;
      pendingPassiveTransitions = null;
      var root$jscomp$0: RR.FiberRoot = pendingEffectsRoot!,
        lanes: RR.Lanes = pendingEffectsLanes;
      pendingEffectsStatus = 0;
      pendingFinishedWork = pendingEffectsRoot = null;
      pendingEffectsLanes = 0;
      if (0 !== (executionContext & 6))
        throw Error(formatProdErrorMessage(331));
      var prevExecutionContext: RR.ExecutionContext = executionContext;
      executionContext |= 4;
      commitPassiveUnmountOnFiber(root$jscomp$0.current!);
      commitPassiveMountOnFiber(
        root$jscomp$0,
        root$jscomp$0.current!,
        lanes,
        priority$asTransitions
      );
      executionContext = prevExecutionContext;
      flushSyncWorkAcrossRoots_impl(0, !1);
      if (
        injectedHook &&
        "function" === typeof injectedHook.onPostCommitFiberRoot
      )
        try {
          injectedHook.onPostCommitFiberRoot(rendererID, root$jscomp$0);
        } catch (err) {}
      return !0;
    } finally {
      setCurrentUpdatePriority(previousPriority),
        (ReactSharedInternals.T = renderPriority$asTransition),
        releaseRootPooledCache(root, remainingLanes);
    }
  }
  function captureCommitPhaseErrorOnRoot(rootFiber: RR.Fiber, sourceFiber: RR.Fiber, error: RR.Thrown): void { var rootFiber$asRoot: RR.FiberRoot | null, sourceFiber$asValue: RR.CapturedValue, sourceFiber$asUpdate: RR.Update;
    sourceFiber$asValue = createCapturedValueAtFiber(error, sourceFiber);
    sourceFiber$asUpdate = createRootErrorUpdate(rootFiber.stateNode as RR.FiberRoot, sourceFiber$asValue, 2);
    rootFiber$asRoot = enqueueUpdate(rootFiber, sourceFiber$asUpdate, 2);
    null !== rootFiber$asRoot &&
      (markRootUpdated$1(rootFiber$asRoot, 2), ensureRootIsScheduled(rootFiber$asRoot));
  }
  function captureCommitPhaseError(sourceFiber: RR.Fiber, nearestMountedAncestor: RR.Fiber | null, error: RR.Thrown): void { var sourceFiber$asValue: RR.CapturedValue, error$asUpdate: RR.Update, instance$asRoot: RR.FiberRoot | null;
    if (3 === sourceFiber.tag)
      captureCommitPhaseErrorOnRoot(sourceFiber, sourceFiber, error);
    else
      for (; null !== nearestMountedAncestor; ) {
        if (3 === nearestMountedAncestor.tag) {
          captureCommitPhaseErrorOnRoot(
            nearestMountedAncestor,
            sourceFiber,
            error
          );
          break;
        } else if (1 === nearestMountedAncestor.tag) {
          var instance: RR.ClassInstance = nearestMountedAncestor.stateNode as RR.ClassInstance;
          if (
            "function" ===
              typeof (nearestMountedAncestor.type as RR.ClassComponent).getDerivedStateFromError ||
            ("function" === typeof instance.componentDidCatch &&
              (null === legacyErrorBoundariesThatAlreadyFailed ||
                !legacyErrorBoundariesThatAlreadyFailed.has(instance)))
          ) {
            sourceFiber$asValue = createCapturedValueAtFiber(error, sourceFiber);
            error$asUpdate = createClassErrorUpdate(2);
            instance$asRoot = enqueueUpdate(nearestMountedAncestor, error$asUpdate, 2);
            null !== instance$asRoot &&
              (initializeClassErrorUpdate(
                error$asUpdate,
                instance$asRoot,
                nearestMountedAncestor,
                sourceFiber$asValue
              ),
              markRootUpdated$1(instance$asRoot, 2),
              ensureRootIsScheduled(instance$asRoot));
            break;
          }
        }
        nearestMountedAncestor = nearestMountedAncestor.return;
      }
  }
  function attachPingListener(root: RR.FiberRoot, wakeable: RR.Wakeable, lanes: RR.Lanes): void { var root$asPing: () => void;
    var pingCache: RR.PingCache | null = root.pingCache;
    if (null === pingCache) {
      pingCache = root.pingCache = new PossiblyWeakMap();
      var threadIDs: Set<RR.Lanes> | undefined = new Set();
      pingCache!.set(wakeable, threadIDs);
    } else
      (threadIDs = pingCache.get(wakeable)),
        void 0 === threadIDs &&
          ((threadIDs = new Set()), pingCache.set(wakeable, threadIDs));
    threadIDs.has(lanes) ||
      ((workInProgressRootDidAttachPingListener = !0),
      threadIDs.add(lanes),
      (root$asPing = pingSuspendedRoot.bind(null, root, wakeable, lanes)),
      wakeable.then(root$asPing, root$asPing));
  }
  function pingSuspendedRoot(root: RR.FiberRoot, wakeable: RR.Wakeable, pingedLanes: RR.Lanes): void {
    var pingCache: RR.PingCache | null = root.pingCache;
    null !== pingCache && pingCache.delete(wakeable);
    root.pingedLanes |= root.suspendedLanes & pingedLanes;
    root.warmLanes &= ~pingedLanes;
    workInProgressRoot === root &&
      (workInProgressRootRenderLanes & pingedLanes) === pingedLanes &&
      (4 === workInProgressRootExitStatus ||
      (3 === workInProgressRootExitStatus &&
        (workInProgressRootRenderLanes & 62914560) ===
          workInProgressRootRenderLanes &&
        300 > now() - globalMostRecentFallbackTime)
        ? 0 === (executionContext & 2) && prepareFreshStack(root, 0)
        : (workInProgressRootPingedLanes |= pingedLanes),
      workInProgressSuspendedRetryLanes === workInProgressRootRenderLanes &&
        (workInProgressSuspendedRetryLanes = 0));
    ensureRootIsScheduled(root);
  }
  function retryTimedOutBoundary(boundaryFiber: RR.Fiber, retryLane: RR.Lane): void { var boundaryFiber$asRoot: RR.FiberRoot | null;
    0 === retryLane && (retryLane = claimNextRetryLane());
    boundaryFiber$asRoot = enqueueConcurrentRenderForLane(boundaryFiber, retryLane);
    null !== boundaryFiber$asRoot &&
      (markRootUpdated$1(boundaryFiber$asRoot, retryLane),
      ensureRootIsScheduled(boundaryFiber$asRoot));
  }
  function retryDehydratedSuspenseBoundary(boundaryFiber: RR.Fiber): void {
    var suspenseState: RR.SuspenseState | null = boundaryFiber.memoizedState as RR.SuspenseState | null,
      retryLane: RR.Lane = 0;
    null !== suspenseState && (retryLane = suspenseState.retryLane);
    retryTimedOutBoundary(boundaryFiber, retryLane);
  }
  function resolveRetryWakeable(boundaryFiber: RR.Fiber, wakeable: RR.Wakeable): void {
    var retryLane: RR.Lane = 0;
    switch (boundaryFiber.tag) {
      case 31:
      case 13:
        var retryCache: RR.RetryCache | null = boundaryFiber.stateNode as RR.RetryCache | null;
        var suspenseState: RR.SuspenseState | null = boundaryFiber.memoizedState as RR.SuspenseState | null;
        null !== suspenseState && (retryLane = suspenseState.retryLane);
        break;
      case 19:
        retryCache = boundaryFiber.stateNode as RR.RetryCache | null;
        break;
      case 22:
        retryCache = (boundaryFiber.stateNode as RR.OffscreenInstance)._retryCache;
        break;
      default:
        throw Error(formatProdErrorMessage(314));
    }
    null !== retryCache && retryCache.delete(wakeable);
    retryTimedOutBoundary(boundaryFiber, retryLane);
  }
  function scheduleCallback(priorityLevel: RR.SchedulerPriority, callback: RR.SchedulerCallback): RR.SchedulerTask {
    return scheduleCallback$3(priorityLevel, callback);
  }
  function FiberNode(this: RR.Fiber, tag: RR.WorkTag, pendingProps: RR.Fiber["pendingProps"], key: string | null, mode: RR.TypeOfMode) {
    this.tag = tag;
    this.key = key;
    this.sibling =
      this.child =
      this.return =
      this.stateNode =
      this.type =
      this.elementType =
        null;
    this.index = 0;
    this.refCleanup = this.ref = null;
    this.pendingProps = pendingProps;
    this.dependencies =
      this.memoizedState =
      this.updateQueue =
      this.memoizedProps =
        null;
    this.mode = mode;
    this.subtreeFlags = this.flags = 0;
    this.deletions = null;
    this.childLanes = this.lanes = 0;
    this.alternate = null;
  }
  function shouldConstruct(Component: RR.PrototypeHolder): boolean { var Component$asPrototype: RR.ClassPrototype | undefined;
    Component$asPrototype = Component.prototype;
    return !(!Component$asPrototype || !Component$asPrototype.isReactComponent);
  }
  function createWorkInProgress(current: RR.Fiber, pendingProps: RR.Fiber["pendingProps"]): RR.Fiber { var pendingProps$asDependencies: RR.Dependencies | null;
    var workInProgress: RR.Fiber | null = current.alternate;
    null === workInProgress
      ? ((workInProgress = createFiber(
          current.tag,
          pendingProps,
          current.key,
          current.mode
        )),
        (workInProgress.elementType = current.elementType),
        (workInProgress.type = current.type),
        (workInProgress.stateNode = current.stateNode),
        (workInProgress.alternate = current),
        (current.alternate = workInProgress))
      : ((workInProgress.pendingProps = pendingProps),
        (workInProgress.type = current.type),
        (workInProgress.flags = 0),
        (workInProgress.subtreeFlags = 0),
        (workInProgress.deletions = null));
    workInProgress.flags = current.flags & 65011712;
    workInProgress.childLanes = current.childLanes;
    workInProgress.lanes = current.lanes;
    workInProgress.child = current.child;
    workInProgress.memoizedProps = current.memoizedProps;
    workInProgress.memoizedState = current.memoizedState;
    workInProgress.updateQueue = current.updateQueue;
    pendingProps$asDependencies = current.dependencies;
    workInProgress.dependencies =
      null === pendingProps$asDependencies
        ? null
        : {
            lanes: pendingProps$asDependencies.lanes,
            firstContext: pendingProps$asDependencies.firstContext
          };
    workInProgress.sibling = current.sibling;
    workInProgress.index = current.index;
    workInProgress.ref = current.ref;
    workInProgress.refCleanup = current.refCleanup;
    return workInProgress;
  }
  function resetWorkInProgress(workInProgress: RR.Fiber, renderLanes: RR.Lanes): RR.Fiber { var renderLanes$asDependencies: RR.Dependencies | null;
    workInProgress.flags &= 65011714;
    var current: RR.Fiber | null = workInProgress.alternate;
    null === current
      ? ((workInProgress.childLanes = 0),
        (workInProgress.lanes = renderLanes),
        (workInProgress.child = null),
        (workInProgress.subtreeFlags = 0),
        (workInProgress.memoizedProps = null),
        (workInProgress.memoizedState = null),
        (workInProgress.updateQueue = null),
        (workInProgress.dependencies = null),
        (workInProgress.stateNode = null))
      : ((workInProgress.childLanes = current.childLanes),
        (workInProgress.lanes = current.lanes),
        (workInProgress.child = current.child),
        (workInProgress.subtreeFlags = 0),
        (workInProgress.deletions = null),
        (workInProgress.memoizedProps = current.memoizedProps),
        (workInProgress.memoizedState = current.memoizedState),
        (workInProgress.updateQueue = current.updateQueue),
        (workInProgress.type = current.type),
        (renderLanes$asDependencies = current.dependencies),
        (workInProgress.dependencies =
          null === renderLanes$asDependencies
            ? null
            : {
                lanes: renderLanes$asDependencies.lanes,
                firstContext: renderLanes$asDependencies.firstContext
              }));
    return workInProgress;
  }
  function createFiberFromTypeAndProps(
    type: RR.ElementTypeGiven,
    key: string | null,
    pendingProps$given: RR.Props,
    owner: RR.Fiber | null,
    mode: RR.TypeOfMode,
    lanes: RR.Lanes
  ): RR.Fiber { var pendingProps; pendingProps = pendingProps$given; var type$asActivityFiber: RR.Fiber, type$asProfilerFiber: RR.Fiber, type$asSuspenseFiber: RR.Fiber, type$asSuspenseListFiber: RR.Fiber, key$asFiber: RR.Fiber, owner$asResolvedType: RR.ElementTypeGiven;
    var fiberTag: RR.WorkTag = 0;
    owner$asResolvedType = type;
    if ("function" === typeof type) shouldConstruct(type) && (fiberTag = 1);
    else if ("string" === typeof type)
      fiberTag =
        supportsResources && supportsSingletons
          ? isHostHoistableType!(type, pendingProps, contextStackCursor.current)
            ? 26
            : isHostSingletonType!(type)
              ? 27
              : 5
          : supportsResources
            ? isHostHoistableType!(
                type,
                pendingProps,
                contextStackCursor.current
              )
              ? 26
              : 5
            : supportsSingletons
              ? isHostSingletonType!(type)
                ? 27
                : 5
              : 5;
    else
      a: switch (type) {
        case REACT_ACTIVITY_TYPE:
          return (
            (type$asActivityFiber = createFiber(31, pendingProps, key, mode)),
            (type$asActivityFiber.elementType = REACT_ACTIVITY_TYPE),
            (type$asActivityFiber.lanes = lanes),
            type$asActivityFiber
          );
        case REACT_FRAGMENT_TYPE:
          return createFiberFromFragment(
            pendingProps.children,
            mode,
            lanes,
            key
          );
        case REACT_STRICT_MODE_TYPE:
          fiberTag = 8;
          mode |= 24;
          break;
        case REACT_PROFILER_TYPE:
          return (
            (type$asProfilerFiber = createFiber(12, pendingProps, key, mode | 2)),
            (type$asProfilerFiber.elementType = REACT_PROFILER_TYPE),
            (type$asProfilerFiber.lanes = lanes),
            type$asProfilerFiber
          );
        case REACT_SUSPENSE_TYPE:
          return (
            (type$asSuspenseFiber = createFiber(13, pendingProps, key, mode)),
            (type$asSuspenseFiber.elementType = REACT_SUSPENSE_TYPE),
            (type$asSuspenseFiber.lanes = lanes),
            type$asSuspenseFiber
          );
        case REACT_SUSPENSE_LIST_TYPE:
          return (
            (type$asSuspenseListFiber = createFiber(19, pendingProps, key, mode)),
            (type$asSuspenseListFiber.elementType = REACT_SUSPENSE_LIST_TYPE),
            (type$asSuspenseListFiber.lanes = lanes),
            type$asSuspenseListFiber
          );
        default:
          if ("object" === typeof type && null !== type)
            switch (type.$$typeof) {
              case REACT_CONTEXT_TYPE:
                fiberTag = 10;
                break a;
              case REACT_CONSUMER_TYPE:
                fiberTag = 9;
                break a;
              case REACT_FORWARD_REF_TYPE:
                fiberTag = 11;
                break a;
              case REACT_MEMO_TYPE:
                fiberTag = 14;
                break a;
              case REACT_LAZY_TYPE:
                fiberTag = 16;
                owner$asResolvedType = null;
                break a;
            }
          fiberTag = 29;
          pendingProps = Error(
            formatProdErrorMessage(
              130,
              null === type ? "null" : typeof type,
              ""
            )
          );
          owner$asResolvedType = null;
      }
    key$asFiber = createFiber(fiberTag, pendingProps, key, mode);
    key$asFiber.elementType = type;
    key$asFiber.type = owner$asResolvedType as RR.ElementType;
    key$asFiber.lanes = lanes;
    return key$asFiber;
  }
  function createFiberFromFragment(elements: RR.ReactNode, mode: RR.TypeOfMode, lanes: RR.Lanes, key: string | null): RR.Fiber { var elements$asFiber: RR.Fiber;
    elements$asFiber = createFiber(7, elements, key, mode);
    elements$asFiber.lanes = lanes;
    return elements$asFiber;
  }
  function createFiberFromText(content: string, mode: RR.TypeOfMode, lanes: RR.Lanes): RR.Fiber { var content$asFiber: RR.Fiber;
    content$asFiber = createFiber(6, content, null, mode);
    content$asFiber.lanes = lanes;
    return content$asFiber;
  }
  function createFiberFromDehydratedFragment(dehydratedNode: RR.SuspenseInstance | RR.ActivityInstance): RR.Fiber {
    var fiber: RR.Fiber = createFiber(18, null, null, 0);
    fiber.stateNode = dehydratedNode;
    return fiber;
  }
  function createFiberFromPortal(portal: RR.ReactPortal, mode: RR.TypeOfMode, lanes: RR.Lanes): RR.Fiber { var mode$asFiber: RR.Fiber;
    mode$asFiber = createFiber(
      4,
      null !== portal.children ? portal.children : [],
      portal.key,
      mode
    );
    mode$asFiber.lanes = lanes;
    mode$asFiber.stateNode = {
      containerInfo: portal.containerInfo,
      pendingChildren: null,
      implementation: portal.implementation
    } as RR.PortalState;
    return mode$asFiber;
  }
  function FiberRootNode(this: RR.FiberRoot,
    containerInfo: RR.Container,
    tag: RR.RootTag,
    hydrate: boolean,
    identifierPrefix: string,
    onUncaughtError: RR.OnUncaughtError,
    onCaughtError: RR.OnCaughtError,
    onRecoverableError: RR.OnRecoverableError,
    onDefaultTransitionIndicator: RR.OnDefaultTransitionIndicator,
    formState: RR.ReactFormState | null
  ): void {
    this.tag = 1;
    this.containerInfo = containerInfo;
    this.pingCache = this.current = this.pendingChildren = null;
    this.timeoutHandle = noTimeout;
    this.callbackNode =
      this.next =
      this.pendingContext =
      this.context =
      this.cancelPendingCommit =
        null;
    this.callbackPriority = 0;
    this.expirationTimes = createLaneMap<RR.Milliseconds>(-1);
    this.entangledLanes =
      this.shellSuspendCounter =
      this.errorRecoveryDisabledLanes =
      this.expiredLanes =
      this.warmLanes =
      this.pingedLanes =
      this.suspendedLanes =
      this.pendingLanes =
        0;
    this.entanglements = createLaneMap<RR.Lanes>(0);
    this.hiddenUpdates = createLaneMap<RR.ConcurrentUpdate[] | null>(null);
    this.identifierPrefix = identifierPrefix;
    this.onUncaughtError = onUncaughtError;
    this.onCaughtError = onCaughtError;
    this.onRecoverableError = onRecoverableError;
    this.pooledCache = null;
    this.pooledCacheLanes = 0;
    this.formState = formState;
    this.incompleteTransitions = new Map<RR.Transition, unknown>();
  }
  function createFiberRoot(
    containerInfo: RR.Container,
    tag: RR.RootTag,
    hydrate: boolean,
    initialChildren: RR.ReactNode,
    hydrationCallbacks: unknown,
    isStrictMode: boolean,
    identifierPrefix: string,
    formState: RR.ReactFormState | null,
    onUncaughtError: RR.OnUncaughtError,
    onCaughtError: RR.OnCaughtError,
    onRecoverableError: RR.OnRecoverableError,
    onDefaultTransitionIndicator: RR.OnDefaultTransitionIndicator
  ): RR.FiberRoot { var containerInfo$asRoot: RR.FiberRoot, tag$asMode: RR.TypeOfMode, tag$asCache: RR.Cache, isStrictMode$asFiber: RR.Fiber;
    containerInfo$asRoot = new (FiberRootNode as unknown as RR.FiberRootConstructor)(
      containerInfo,
      tag,
      hydrate,
      identifierPrefix,
      onUncaughtError,
      onCaughtError,
      onRecoverableError,
      onDefaultTransitionIndicator,
      formState
    );
    tag$asMode = 1;
    !0 === isStrictMode && (tag$asMode |= 24);
    isStrictMode$asFiber = createFiber(3, null, null, tag$asMode);
    containerInfo$asRoot.current = isStrictMode$asFiber;
    isStrictMode$asFiber.stateNode = containerInfo$asRoot;
    tag$asCache = createCache();
    tag$asCache.refCount++;
    containerInfo$asRoot.pooledCache = tag$asCache;
    tag$asCache.refCount++;
    isStrictMode$asFiber.memoizedState = {
      element: initialChildren,
      isDehydrated: hydrate,
      cache: tag$asCache
    } as RR.RootState;
    initializeUpdateQueue(isStrictMode$asFiber);
    return containerInfo$asRoot;
  }
  function getContextForSubtree(parentComponent: RR.ClassInstance | null | undefined): RR.LegacyContext { var parentComponent$asContext: RR.LegacyContext;
    if (!parentComponent) return emptyContextObject;
    parentComponent$asContext = emptyContextObject;
    return parentComponent$asContext;
  }
  function findHostInstance(component: RR.ClassInstance): RR.PublicInstance | null { var component$asKeys: string, component$asCurrentFiber: RR.Fiber | null, component$asHostFiber: RR.Fiber | null;
    var fiber: RR.Fiber | undefined = component._reactInternals;
    if (void 0 === fiber) {
      if ("function" === typeof component.render)
        throw Error(formatProdErrorMessage(188));
      component$asKeys = Object.keys(component).join(",");
      throw Error(formatProdErrorMessage(268, component$asKeys));
    }
    component$asCurrentFiber = findCurrentFiberUsingSlowPath(fiber);
    component$asHostFiber = null !== component$asCurrentFiber ? findCurrentHostFiberImpl(component$asCurrentFiber) : null;
    return null === component$asHostFiber ? null : getPublicInstance(component$asHostFiber.stateNode);
  }
  function updateContainerImpl(
    rootFiber: RR.Fiber,
    lane: RR.Lane,
    element: RR.ReactNode,
    container: RR.FiberRoot,
    parentComponent: RR.ClassInstance | null | undefined,
    callback: RR.UpdateCallback | null | undefined
  ): void { var element$asRoot: RR.FiberRoot | null, container$asUpdate: RR.Update, parentComponent$asContext: RR.LegacyContext;
    parentComponent$asContext = getContextForSubtree(parentComponent);
    null === container.context
      ? (container.context = parentComponent$asContext)
      : (container.pendingContext = parentComponent$asContext);
    container$asUpdate = createUpdate(lane);
    container$asUpdate.payload = { element: element } as RR.RootUpdatePayload;
    callback = void 0 === callback ? null : callback;
    null !== callback && (container$asUpdate.callback = callback);
    element$asRoot = enqueueUpdate(rootFiber, container$asUpdate, lane);
    null !== element$asRoot &&
      (scheduleUpdateOnFiber(element$asRoot, rootFiber, lane),
      entangleTransitions(element$asRoot, rootFiber, lane));
  }
  function markRetryLaneImpl(fiber: RR.Fiber, retryLane: RR.Lane): void { var fiber$asState: RR.SuspenseState | null;
    fiber$asState = fiber.memoizedState as RR.SuspenseState | null;
    if (null !== fiber$asState && null !== fiber$asState.dehydrated) {
      var a: RR.Lane = fiber$asState.retryLane;
      fiber$asState.retryLane = 0 !== a && a < retryLane ? a : retryLane;
    }
  }
  function markRetryLaneIfNotHydrated(fiber: RR.Fiber, retryLane: RR.Lane): void { var fiber$asAlternate: RR.Fiber | null;
    markRetryLaneImpl(fiber, retryLane);
    (fiber$asAlternate = fiber.alternate) && markRetryLaneImpl(fiber$asAlternate, retryLane);
  }
  var exports: RR.Reconciler = {};
  ("use strict");
  var React: any = (react$module as any),
    Scheduler: any = (scheduler$module as any),
    assign = Object.assign,
    REACT_LEGACY_ELEMENT_TYPE = Symbol.for("react.element"),
    REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"),
    REACT_PORTAL_TYPE = Symbol.for("react.portal"),
    REACT_FRAGMENT_TYPE = Symbol.for("react.fragment"),
    REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode"),
    REACT_PROFILER_TYPE = Symbol.for("react.profiler"),
    REACT_CONSUMER_TYPE = Symbol.for("react.consumer"),
    REACT_CONTEXT_TYPE = Symbol.for("react.context"),
    REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref"),
    REACT_SUSPENSE_TYPE = Symbol.for("react.suspense"),
    REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list"),
    REACT_MEMO_TYPE = Symbol.for("react.memo"),
    REACT_LAZY_TYPE = Symbol.for("react.lazy");
  Symbol.for("react.scope");
  var REACT_ACTIVITY_TYPE = Symbol.for("react.activity");
  Symbol.for("react.legacy_hidden");
  Symbol.for("react.tracing_marker");
  var REACT_MEMO_CACHE_SENTINEL = Symbol.for("react.memo_cache_sentinel");
  Symbol.for("react.view_transition");
  var MAYBE_ITERATOR_SYMBOL = Symbol.iterator,
    REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference"),
    isArrayImpl = Array.isArray,
    ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
    rendererVersion = $$$config.rendererVersion,
    rendererPackageName = $$$config.rendererPackageName,
    extraDevToolsConfig = $$$config.extraDevToolsConfig,
    getPublicInstance = $$$config.getPublicInstance,
    getRootHostContext = $$$config.getRootHostContext,
    getChildHostContext = $$$config.getChildHostContext,
    prepareForCommit = $$$config.prepareForCommit,
    resetAfterCommit = $$$config.resetAfterCommit,
    createInstance = $$$config.createInstance;
  $$$config.cloneMutableInstance;
  var appendInitialChild = $$$config.appendInitialChild,
    finalizeInitialChildren = $$$config.finalizeInitialChildren,
    shouldSetTextContent = $$$config.shouldSetTextContent,
    createTextInstance = $$$config.createTextInstance;
  $$$config.cloneMutableTextInstance;
  var scheduleTimeout = $$$config.scheduleTimeout,
    cancelTimeout = $$$config.cancelTimeout,
    noTimeout = $$$config.noTimeout,
    isPrimaryRenderer = $$$config.isPrimaryRenderer;
  $$$config.warnsIfNotActing;
  var supportsMutation = $$$config.supportsMutation,
    supportsPersistence = $$$config.supportsPersistence,
    supportsHydration = $$$config.supportsHydration,
    getInstanceFromNode = $$$config.getInstanceFromNode;
  $$$config.beforeActiveInstanceBlur;
  var preparePortalMount = $$$config.preparePortalMount;
  $$$config.prepareScopeUpdate;
  $$$config.getInstanceFromScope;
  var setCurrentUpdatePriority = $$$config.setCurrentUpdatePriority,
    getCurrentUpdatePriority = $$$config.getCurrentUpdatePriority,
    resolveUpdatePriority = $$$config.resolveUpdatePriority;
  $$$config.trackSchedulerEvent;
  $$$config.resolveEventType;
  $$$config.resolveEventTimeStamp;
  var shouldAttemptEagerTransition = $$$config.shouldAttemptEagerTransition,
    detachDeletedInstance = $$$config.detachDeletedInstance;
  $$$config.requestPostPaintCallback;
  var maySuspendCommit = $$$config.maySuspendCommit,
    maySuspendCommitOnUpdate = $$$config.maySuspendCommitOnUpdate,
    maySuspendCommitInSyncRender = $$$config.maySuspendCommitInSyncRender,
    preloadInstance = $$$config.preloadInstance,
    startSuspendingCommit = $$$config.startSuspendingCommit,
    suspendInstance = $$$config.suspendInstance;
  $$$config.suspendOnActiveViewTransition;
  var waitForCommitToBeReady = $$$config.waitForCommitToBeReady;
  $$$config.getSuspendedCommitReason;
  var NotPendingTransition = $$$config.NotPendingTransition,
    HostTransitionContext = $$$config.HostTransitionContext,
    resetFormInstance = $$$config.resetFormInstance;
  $$$config.bindToConsole;
  var supportsMicrotasks = $$$config.supportsMicrotasks,
    scheduleMicrotask = $$$config.scheduleMicrotask,
    supportsTestSelectors = $$$config.supportsTestSelectors,
    findFiberRoot = $$$config.findFiberRoot,
    getBoundingRect = $$$config.getBoundingRect,
    getTextContent = $$$config.getTextContent,
    isHiddenSubtree = $$$config.isHiddenSubtree,
    matchAccessibilityRole = $$$config.matchAccessibilityRole,
    setFocusIfFocusable = $$$config.setFocusIfFocusable,
    setupIntersectionObserver = $$$config.setupIntersectionObserver,
    appendChild = $$$config.appendChild,
    appendChildToContainer = $$$config.appendChildToContainer,
    commitTextUpdate = $$$config.commitTextUpdate,
    commitMount = $$$config.commitMount,
    commitUpdate = $$$config.commitUpdate,
    insertBefore = $$$config.insertBefore,
    insertInContainerBefore = $$$config.insertInContainerBefore,
    removeChild = $$$config.removeChild,
    removeChildFromContainer = $$$config.removeChildFromContainer,
    resetTextContent = $$$config.resetTextContent,
    hideInstance = $$$config.hideInstance,
    hideTextInstance = $$$config.hideTextInstance,
    unhideInstance = $$$config.unhideInstance,
    unhideTextInstance = $$$config.unhideTextInstance;
  $$$config.cancelViewTransitionName;
  $$$config.cancelRootViewTransitionName;
  $$$config.restoreRootViewTransitionName;
  $$$config.cloneRootViewTransitionContainer;
  $$$config.removeRootViewTransitionClone;
  $$$config.measureClonedInstance;
  $$$config.hasInstanceChanged;
  $$$config.hasInstanceAffectedParent;
  $$$config.startViewTransition;
  $$$config.startGestureTransition;
  $$$config.stopViewTransition;
  $$$config.getCurrentGestureOffset;
  $$$config.createViewTransitionInstance;
  var clearContainer = $$$config.clearContainer;
  $$$config.createFragmentInstance;
  $$$config.updateFragmentInstanceFiber;
  $$$config.commitNewChildToFragmentInstance;
  $$$config.deleteChildFromFragmentInstance;
  var cloneInstance = $$$config.cloneInstance,
    createContainerChildSet = $$$config.createContainerChildSet,
    appendChildToContainerChildSet = $$$config.appendChildToContainerChildSet,
    finalizeContainerChildren = $$$config.finalizeContainerChildren,
    replaceContainerChildren = $$$config.replaceContainerChildren,
    cloneHiddenInstance = $$$config.cloneHiddenInstance,
    cloneHiddenTextInstance = $$$config.cloneHiddenTextInstance,
    isSuspenseInstancePending = $$$config.isSuspenseInstancePending,
    isSuspenseInstanceFallback = $$$config.isSuspenseInstanceFallback,
    getSuspenseInstanceFallbackErrorDetails =
      $$$config.getSuspenseInstanceFallbackErrorDetails,
    registerSuspenseInstanceRetry = $$$config.registerSuspenseInstanceRetry,
    canHydrateFormStateMarker = $$$config.canHydrateFormStateMarker,
    isFormStateMarkerMatching = $$$config.isFormStateMarkerMatching,
    getNextHydratableSibling = $$$config.getNextHydratableSibling,
    getNextHydratableSiblingAfterSingleton =
      $$$config.getNextHydratableSiblingAfterSingleton,
    getFirstHydratableChild = $$$config.getFirstHydratableChild,
    getFirstHydratableChildWithinContainer =
      $$$config.getFirstHydratableChildWithinContainer,
    getFirstHydratableChildWithinActivityInstance =
      $$$config.getFirstHydratableChildWithinActivityInstance,
    getFirstHydratableChildWithinSuspenseInstance =
      $$$config.getFirstHydratableChildWithinSuspenseInstance,
    getFirstHydratableChildWithinSingleton =
      $$$config.getFirstHydratableChildWithinSingleton,
    canHydrateInstance = $$$config.canHydrateInstance,
    canHydrateTextInstance = $$$config.canHydrateTextInstance,
    canHydrateActivityInstance = $$$config.canHydrateActivityInstance,
    canHydrateSuspenseInstance = $$$config.canHydrateSuspenseInstance,
    hydrateInstance = $$$config.hydrateInstance,
    hydrateTextInstance = $$$config.hydrateTextInstance,
    hydrateActivityInstance = $$$config.hydrateActivityInstance,
    hydrateSuspenseInstance = $$$config.hydrateSuspenseInstance,
    getNextHydratableInstanceAfterActivityInstance =
      $$$config.getNextHydratableInstanceAfterActivityInstance,
    getNextHydratableInstanceAfterSuspenseInstance =
      $$$config.getNextHydratableInstanceAfterSuspenseInstance,
    commitHydratedInstance = $$$config.commitHydratedInstance,
    commitHydratedContainer = $$$config.commitHydratedContainer,
    commitHydratedActivityInstance = $$$config.commitHydratedActivityInstance,
    commitHydratedSuspenseInstance = $$$config.commitHydratedSuspenseInstance,
    finalizeHydratedChildren = $$$config.finalizeHydratedChildren,
    flushHydrationEvents = $$$config.flushHydrationEvents;
  $$$config.clearActivityBoundary;
  var clearSuspenseBoundary = $$$config.clearSuspenseBoundary;
  $$$config.clearActivityBoundaryFromContainer;
  var clearSuspenseBoundaryFromContainer =
      $$$config.clearSuspenseBoundaryFromContainer,
    hideDehydratedBoundary = $$$config.hideDehydratedBoundary,
    unhideDehydratedBoundary = $$$config.unhideDehydratedBoundary,
    shouldDeleteUnhydratedTailInstances =
      $$$config.shouldDeleteUnhydratedTailInstances;
  $$$config.diffHydratedPropsForDevWarnings;
  $$$config.diffHydratedTextForDevWarnings;
  $$$config.describeHydratableInstanceForDevWarnings;
  var validateHydratableInstance = $$$config.validateHydratableInstance,
    validateHydratableTextInstance = $$$config.validateHydratableTextInstance,
    supportsResources = $$$config.supportsResources,
    isHostHoistableType = $$$config.isHostHoistableType,
    getHoistableRoot = $$$config.getHoistableRoot,
    getResource = $$$config.getResource,
    acquireResource = $$$config.acquireResource,
    releaseResource = $$$config.releaseResource,
    hydrateHoistable = $$$config.hydrateHoistable,
    mountHoistable = $$$config.mountHoistable,
    unmountHoistable = $$$config.unmountHoistable,
    createHoistableInstance = $$$config.createHoistableInstance,
    prepareToCommitHoistables = $$$config.prepareToCommitHoistables,
    mayResourceSuspendCommit = $$$config.mayResourceSuspendCommit,
    preloadResource = $$$config.preloadResource,
    suspendResource = $$$config.suspendResource,
    supportsSingletons = $$$config.supportsSingletons,
    resolveSingletonInstance = $$$config.resolveSingletonInstance,
    acquireSingletonInstance = $$$config.acquireSingletonInstance,
    releaseSingletonInstance = $$$config.releaseSingletonInstance,
    isHostSingletonType = $$$config.isHostSingletonType,
    isSingletonScope = $$$config.isSingletonScope,
    valueStack: any[] = [],
    index$jscomp$0: number = -1,
    emptyContextObject: RR.LegacyContext = {},
    clz32: (x: number) => number = Math.clz32 ? Math.clz32 : clz32Fallback,
    log$1 = Math.log,
    LN2 = Math.LN2,
    nextTransitionUpdateLane: RR.Lane = 256,
    nextTransitionDeferredLane: RR.Lane = 262144,
    nextRetryLane: RR.Lane = 4194304,
    scheduleCallback$3 = Scheduler.unstable_scheduleCallback,
    cancelCallback$1 = Scheduler.unstable_cancelCallback,
    shouldYield = Scheduler.unstable_shouldYield,
    requestPaint = Scheduler.unstable_requestPaint,
    now = Scheduler.unstable_now,
    ImmediatePriority = Scheduler.unstable_ImmediatePriority,
    UserBlockingPriority = Scheduler.unstable_UserBlockingPriority,
    NormalPriority$1 = Scheduler.unstable_NormalPriority,
    IdlePriority = Scheduler.unstable_IdlePriority,
    log = Scheduler.log,
    unstable_setDisableYieldValue = Scheduler.unstable_setDisableYieldValue,
    rendererID: number | null = null,
    injectedHook: RR.DevToolsHook | null = null,
    objectIs: (x: unknown, y: unknown) => boolean = "function" === typeof Object.is ? Object.is : is,
    reportGlobalError: (error: RR.Thrown) => void =
      "function" === typeof reportError
        ? reportError
        : function (error) {
            if (
              "object" === typeof window &&
              "function" === typeof window.ErrorEvent
            ) {
              var event: object = new window.ErrorEvent("error", {
                bubbles: !0,
                cancelable: !0,
                message:
                  "object" === typeof error &&
                  null !== error &&
                  "string" === typeof error.message
                    ? String(error.message)
                    : String(error),
                error: error
              });
              if (!window.dispatchEvent(event)) return;
            } else if (
              "object" === typeof process &&
              "function" === typeof process.emit
            ) {
              process.emit("uncaughtException", error);
              return;
            }
            console.error(error);
          },
    hasOwnProperty = Object.prototype.hasOwnProperty,
    prefix: string | undefined,
    suffix: string | undefined,
    reentry = !1,
    CapturedStacks: WeakMap<object, RR.CapturedValue> = new WeakMap(),
    forkStack: RR.ForkStackEntry[] = [],
    forkStackIndex: number = 0,
    treeForkProvider: RR.Fiber | null = null,
    treeForkCount: number = 0,
    idStack: RR.IdStackEntry[] = [],
    idStackIndex: number = 0,
    treeContextProvider: RR.Fiber | null = null,
    treeContextId: number = 1,
    treeContextOverflow: string = "",
    contextStackCursor: RR.StackCursor<RR.HostContext> = createCursor(null),
    contextFiberStackCursor: RR.StackCursor<RR.Fiber | null> = createCursor(null),
    rootInstanceStackCursor: RR.StackCursor<RR.Container | null> = createCursor(null),
    hostTransitionProviderCursor: RR.StackCursor<RR.Fiber | null> = createCursor(null),
    hydrationParentFiber: RR.Fiber | null = null,
    nextHydratableInstance: RR.HydratableInstance | null = null,
    isHydrating = !1,
    hydrationErrors: RR.CapturedValue[] | null = null,
    rootOrSingletonContext = !1,
    HydrationMismatchException = Error(formatProdErrorMessage(519)),
    valueCursor: RR.StackCursor<RR.ContextValue> = createCursor(null),
    currentlyRenderingFiber$1: RR.Fiber | null = null,
    lastContextDependency: RR.ContextDependency | null = null,
    AbortControllerLocal: RR.AbortControllerConstructor =
      "undefined" !== typeof AbortController
        ? AbortController
        : function (this: RR.AbortControllerLike) {
            var listeners: Array<() => void> = [],
              signal: RR.AbortSignalLike = (this.signal = {
                aborted: !1,
                addEventListener: function (type: string, listener: () => void) {
                  listeners.push(listener);
                }
              });
            this.abort = function () {
              signal.aborted = !0;
              listeners.forEach(function (listener) {
                return listener();
              });
            };
          } as unknown as RR.AbortControllerConstructor,
    scheduleCallback$2 = Scheduler.unstable_scheduleCallback,
    NormalPriority = Scheduler.unstable_NormalPriority,
    CacheContext: RR.ReactContext<RR.Cache | null> = {
      $$typeof: REACT_CONTEXT_TYPE,
      Consumer: null,
      Provider: null,
      _currentValue: null,
      _currentValue2: null,
      _threadCount: 0
    },
    firstScheduledRoot: RR.FiberRoot | null = null,
    lastScheduledRoot: RR.FiberRoot | null = null,
    didScheduleMicrotask = !1,
    mightHavePendingSyncWork = !1,
    isFlushingWork = !1,
    currentEventTransitionLane: RR.Lane = 0,
    currentEntangledListeners: Array<() => unknown> | null = null,
    currentEntangledPendingCount: number = 0,
    currentEntangledLane: RR.Lane = 0,
    currentEntangledActionThenable: RR.EntangledActionThenable | null = null,
    prevOnStartTransitionFinish: RR.SharedInternals["S"] = ReactSharedInternals.S;
  ReactSharedInternals.S = function (transition: RR.Transition, returnValue: RR.TransitionResult) {
    globalMostRecentTransitionTime = now();
    "object" === typeof returnValue &&
      null !== returnValue &&
      "function" === typeof returnValue.then &&
      entangleAsyncAction(transition, returnValue);
    null !== prevOnStartTransitionFinish &&
      prevOnStartTransitionFinish(transition, returnValue);
  };
  var resumedCache: RR.StackCursor<RR.Cache | null> = createCursor(null),
    SuspenseException = Error(formatProdErrorMessage(460)),
    SuspenseyCommitException = Error(formatProdErrorMessage(474)),
    SuspenseActionException = Error(formatProdErrorMessage(542)),
    noopSuspenseyCommitThenable: RR.NoopThenable = { then: function () {} },
    suspendedThenable: RR.Thenable | RR.NoopThenable | null = null,
    thenableState$1: RR.ThenableState | null = null,
    thenableIndexCounter$1: number = 0,
    reconcileChildFibers: RR.ChildReconciler = createChildReconciler(!0),
    mountChildFibers: RR.ChildReconciler = createChildReconciler(!1),
    concurrentQueues: RR.ConcurrentQueuesEntry[] = [],
    concurrentQueuesIndex: number = 0,
    concurrentlyUpdatedLanes: RR.Lanes = 0,
    hasForceUpdate = !1,
    didReadFromEntangledAsyncAction = !1,
    currentTreeHiddenStackCursor: RR.StackCursor<RR.HiddenContext | null> = createCursor(null),
    prevEntangledRenderLanesCursor: RR.StackCursor<RR.Lanes> = createCursor(0),
    suspenseHandlerStackCursor: RR.StackCursor<RR.Fiber | null> = createCursor(null),
    shellBoundary: RR.Fiber | null = null,
    suspenseStackCursor: RR.StackCursor<RR.SuspenseContext> = createCursor(0),
    renderLanes: RR.Lanes = 0,
    currentlyRenderingFiber: RR.Fiber | null = null,
    currentHook: RR.Hook | null = null,
    workInProgressHook: RR.Hook | null = null,
    didScheduleRenderPhaseUpdate = !1,
    didScheduleRenderPhaseUpdateDuringThisPass = !1,
    shouldDoubleInvokeUserFnsInHooksDEV = !1,
    localIdCounter: number = 0,
    thenableIndexCounter: number = 0,
    thenableState: RR.ThenableState | null = null,
    globalClientIdCounter: number = 0,
    ContextOnlyDispatcher: RR.Dispatcher = {
      readContext: readContext,
      use: use,
      useCallback: throwInvalidHookError,
      useContext: throwInvalidHookError,
      useEffect: throwInvalidHookError,
      useImperativeHandle: throwInvalidHookError,
      useLayoutEffect: throwInvalidHookError,
      useInsertionEffect: throwInvalidHookError,
      useMemo: throwInvalidHookError,
      useReducer: throwInvalidHookError,
      useRef: throwInvalidHookError,
      useState: throwInvalidHookError,
      useDebugValue: throwInvalidHookError,
      useDeferredValue: throwInvalidHookError,
      useTransition: throwInvalidHookError,
      useSyncExternalStore: throwInvalidHookError,
      useId: throwInvalidHookError,
      useHostTransitionStatus: throwInvalidHookError,
      useFormState: throwInvalidHookError,
      useActionState: throwInvalidHookError,
      useOptimistic: throwInvalidHookError,
      useMemoCache: throwInvalidHookError,
      useCacheRefresh: throwInvalidHookError
    };
  ContextOnlyDispatcher.useEffectEvent = throwInvalidHookError;
  var HooksDispatcherOnMount: RR.Dispatcher = {
      readContext: readContext,
      use: use,
      useCallback: function (callback, deps) {
        mountWorkInProgressHook().memoizedState = [
          callback,
          void 0 === deps ? null : deps
        ];
        return callback;
      },
      useContext: readContext,
      useEffect: mountEffect,
      useImperativeHandle: function (ref, create, deps) {
        deps = null !== deps && void 0 !== deps ? deps.concat([ref]) : null;
        mountEffectImpl(
          4194308,
          4,
          imperativeHandleEffect.bind(null, create, ref),
          deps
        );
      },
      useLayoutEffect: function (create, deps) {
        return mountEffectImpl(4194308, 4, create, deps);
      },
      useInsertionEffect: function (create, deps) {
        mountEffectImpl(4, 2, create, deps);
      },
      useMemo: function (nextCreate, deps) {
        var hook: RR.Hook = mountWorkInProgressHook();
        deps = void 0 === deps ? null : deps;
        var nextValue: RR.HookState = nextCreate();
        if (shouldDoubleInvokeUserFnsInHooksDEV) {
          setIsStrictModeForDevtools(!0);
          try {
            nextCreate();
          } finally {
            setIsStrictModeForDevtools(!1);
          }
        }
        hook.memoizedState = [nextValue, deps];
        return nextValue;
      },
      useReducer: function (reducer, initialArg, init) { var reducer$asQueue: RR.HookQueue, reducer$asDispatch: RR.Dispatch;
        var hook: RR.Hook = mountWorkInProgressHook();
        if (void 0 !== init) {
          var initialState: RR.HookState = init(initialArg);
          if (shouldDoubleInvokeUserFnsInHooksDEV) {
            setIsStrictModeForDevtools(!0);
            try {
              init(initialArg);
            } finally {
              setIsStrictModeForDevtools(!1);
            }
          }
        } else initialState = initialArg;
        hook.memoizedState = hook.baseState = initialState;
        reducer$asQueue = {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: reducer,
          lastRenderedState: initialState
        } as RR.HookQueue;
        hook.queue = reducer$asQueue;
        reducer$asDispatch = reducer$asQueue.dispatch = dispatchReducerAction.bind(
          null,
          currentlyRenderingFiber!,
          reducer$asQueue
        );
        return [hook.memoizedState, reducer$asDispatch];
      },
      useRef: function (initialValue) { var initialValue$asRef: RR.RefObject;
        var hook: RR.Hook = mountWorkInProgressHook();
        initialValue$asRef = { current: initialValue } as RR.RefObject;
        return (hook.memoizedState = initialValue$asRef);
      },
      useState: function (initialState) { var initialState$asHook: RR.Hook;
        initialState$asHook = mountStateImpl(initialState);
        var queue: RR.HookQueue = initialState$asHook.queue as RR.HookQueue,
          dispatch: RR.Dispatch = dispatchSetState.bind(
            null,
            currentlyRenderingFiber!,
            queue
          );
        queue.dispatch = dispatch;
        return [initialState$asHook.memoizedState, dispatch];
      },
      useDebugValue: mountDebugValue,
      useDeferredValue: function (value, initialValue) {
        var hook: RR.Hook = mountWorkInProgressHook();
        return mountDeferredValueImpl(hook, value, initialValue);
      },
      useTransition: function () { var stateHook$asStart: RR.StartTransition;
        var stateHook: RR.Hook = mountStateImpl(!1);
        stateHook$asStart = startTransition.bind(
          null,
          currentlyRenderingFiber!,
          stateHook.queue as RR.HookQueue,
          !0,
          !1
        );
        mountWorkInProgressHook().memoizedState = stateHook$asStart;
        return [!1, stateHook$asStart];
      },
      useSyncExternalStore: function (
        subscribe,
        getSnapshot,
        getServerSnapshot
      ) { var getServerSnapshot$asSnapshot: RR.HookState;
        var fiber: RR.Fiber = currentlyRenderingFiber!,
          hook: RR.Hook = mountWorkInProgressHook();
        if (isHydrating) {
          if (void 0 === getServerSnapshot)
            throw Error(formatProdErrorMessage(407));
          getServerSnapshot$asSnapshot = getServerSnapshot();
        } else {
          getServerSnapshot$asSnapshot = getSnapshot();
          if (null === workInProgressRoot)
            throw Error(formatProdErrorMessage(349));
          0 !== (workInProgressRootRenderLanes & 127) ||
            pushStoreConsistencyCheck(fiber, getSnapshot, getServerSnapshot$asSnapshot);
        }
        hook.memoizedState = getServerSnapshot$asSnapshot;
        var inst: RR.StoreInstance = { value: getServerSnapshot$asSnapshot, getSnapshot: getSnapshot };
        hook.queue = inst;
        mountEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [
          subscribe
        ]);
        fiber.flags |= 2048;
        pushSimpleEffect(
          9,
          { destroy: void 0 },
          updateStoreInstance.bind(
            null,
            fiber,
            inst,
            getServerSnapshot$asSnapshot,
            getSnapshot
          ),
          null
        );
        return getServerSnapshot$asSnapshot;
      },
      useId: function () { var JSCompiler_inline_result$asCounter: number;
        var hook: RR.Hook = mountWorkInProgressHook(),
          identifierPrefix: string = workInProgressRoot!.identifierPrefix;
        if (isHydrating) {
          var JSCompiler_inline_result: string = treeContextOverflow;
          var idWithLeadingBit: number = treeContextId;
          JSCompiler_inline_result =
            (
              idWithLeadingBit & ~(1 << (32 - clz32(idWithLeadingBit) - 1))
            ).toString(32) + JSCompiler_inline_result;
          identifierPrefix =
            "_" + identifierPrefix + "R_" + JSCompiler_inline_result;
          JSCompiler_inline_result$asCounter = localIdCounter++;
          0 < JSCompiler_inline_result$asCounter &&
            (identifierPrefix += "H" + JSCompiler_inline_result$asCounter.toString(32));
          identifierPrefix += "_";
        } else
          (JSCompiler_inline_result$asCounter = globalClientIdCounter++),
            (identifierPrefix =
              "_" +
              identifierPrefix +
              "r_" +
              JSCompiler_inline_result$asCounter.toString(32) +
              "_");
        return (hook.memoizedState = identifierPrefix);
      },
      useHostTransitionStatus: useHostTransitionStatus,
      useFormState: mountActionState,
      useActionState: mountActionState,
      useOptimistic: function (passthrough) { var hook$asDispatch: RR.Dispatch;
        var hook: RR.Hook = mountWorkInProgressHook();
        hook.memoizedState = hook.baseState = passthrough;
        var queue: RR.HookQueue = {
          pending: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: null,
          lastRenderedState: null
        };
        hook.queue = queue;
        hook$asDispatch = dispatchOptimisticSetState.bind(
          null,
          currentlyRenderingFiber!,
          !0,
          queue
        );
        queue.dispatch = hook$asDispatch;
        return [passthrough, hook$asDispatch];
      },
      useMemoCache: useMemoCache,
      useCacheRefresh: function () {
        return (mountWorkInProgressHook().memoizedState = refreshCache.bind(
          null,
          currentlyRenderingFiber!
        ));
      },
      useEffectEvent: function (callback) {
        var hook: RR.Hook = mountWorkInProgressHook(),
          ref: RR.EventFunctionRef = { impl: callback };
        hook.memoizedState = ref;
        return function () {
          if (0 !== (executionContext & 2))
            throw Error(formatProdErrorMessage(440));
          return ref.impl.apply(void 0, arguments as any);
        };
      }
    },
    HooksDispatcherOnUpdate: RR.Dispatcher = {
      readContext: readContext,
      use: use,
      useCallback: updateCallback,
      useContext: readContext,
      useEffect: updateEffect,
      useImperativeHandle: updateImperativeHandle,
      useInsertionEffect: updateInsertionEffect,
      useLayoutEffect: updateLayoutEffect,
      useMemo: updateMemo,
      useReducer: updateReducer,
      useRef: updateRef,
      useState: function () {
        return updateReducer(basicStateReducer);
      },
      useDebugValue: mountDebugValue,
      useDeferredValue: function (value, initialValue) {
        var hook: RR.Hook = updateWorkInProgressHook();
        return updateDeferredValueImpl(
          hook,
          currentHook!.memoizedState,
          value,
          initialValue
        );
      },
      useTransition: function () {
        var booleanOrThenable: boolean | RR.Thenable<boolean> = updateReducer(basicStateReducer)[0],
          start: RR.StartTransition = updateWorkInProgressHook().memoizedState;
        return [
          "boolean" === typeof booleanOrThenable
            ? booleanOrThenable
            : useThenable(booleanOrThenable),
          start
        ];
      },
      useSyncExternalStore: updateSyncExternalStore,
      useId: updateId,
      useHostTransitionStatus: useHostTransitionStatus,
      useFormState: updateActionState,
      useActionState: updateActionState,
      useOptimistic: function (passthrough, reducer) {
        var hook: RR.Hook = updateWorkInProgressHook();
        return updateOptimisticImpl(hook, currentHook, passthrough, reducer);
      },
      useMemoCache: useMemoCache,
      useCacheRefresh: updateRefresh
    };
  HooksDispatcherOnUpdate.useEffectEvent = updateEvent;
  var HooksDispatcherOnRerender: RR.Dispatcher = {
    readContext: readContext,
    use: use,
    useCallback: updateCallback,
    useContext: readContext,
    useEffect: updateEffect,
    useImperativeHandle: updateImperativeHandle,
    useInsertionEffect: updateInsertionEffect,
    useLayoutEffect: updateLayoutEffect,
    useMemo: updateMemo,
    useReducer: rerenderReducer,
    useRef: updateRef,
    useState: function () {
      return rerenderReducer(basicStateReducer);
    },
    useDebugValue: mountDebugValue,
    useDeferredValue: function (value, initialValue) {
      var hook: RR.Hook = updateWorkInProgressHook();
      return null === currentHook
        ? mountDeferredValueImpl(hook, value, initialValue)
        : updateDeferredValueImpl(
            hook,
            currentHook.memoizedState,
            value,
            initialValue
          );
    },
    useTransition: function () {
      var booleanOrThenable: boolean | RR.Thenable<boolean> = rerenderReducer(basicStateReducer)[0],
        start: RR.StartTransition = updateWorkInProgressHook().memoizedState;
      return [
        "boolean" === typeof booleanOrThenable
          ? booleanOrThenable
          : useThenable(booleanOrThenable),
        start
      ];
    },
    useSyncExternalStore: updateSyncExternalStore,
    useId: updateId,
    useHostTransitionStatus: useHostTransitionStatus,
    useFormState: rerenderActionState,
    useActionState: rerenderActionState,
    useOptimistic: function (passthrough, reducer) {
      var hook: RR.Hook = updateWorkInProgressHook();
      if (null !== currentHook)
        return updateOptimisticImpl(hook, currentHook, passthrough, reducer);
      hook.baseState = passthrough;
      return [passthrough, (hook.queue as RR.HookQueue).dispatch];
    },
    useMemoCache: useMemoCache,
    useCacheRefresh: updateRefresh
  };
  HooksDispatcherOnRerender.useEffectEvent = updateEvent;
  var classComponentUpdater: RR.ClassComponentUpdater = {
      enqueueSetState: function (inst, payload, callback) { var inst$asFiber: RR.Fiber, payload$asRoot: RR.FiberRoot | null;
        inst$asFiber = inst._reactInternals!;
        var lane = requestUpdateLane(),
          update = createUpdate(lane);
        update.payload = payload;
        void 0 !== callback &&
          null !== callback &&
          (update.callback = callback);
        payload$asRoot = enqueueUpdate(inst$asFiber, update, lane);
        null !== payload$asRoot &&
          (scheduleUpdateOnFiber(payload$asRoot, inst$asFiber, lane),
          entangleTransitions(payload$asRoot, inst$asFiber, lane));
      },
      enqueueReplaceState: function (inst, payload, callback) { var inst$asFiber: RR.Fiber, payload$asRoot: RR.FiberRoot | null;
        inst$asFiber = inst._reactInternals!;
        var lane = requestUpdateLane(),
          update = createUpdate(lane);
        update.tag = 1;
        update.payload = payload;
        void 0 !== callback &&
          null !== callback &&
          (update.callback = callback);
        payload$asRoot = enqueueUpdate(inst$asFiber, update, lane);
        null !== payload$asRoot &&
          (scheduleUpdateOnFiber(payload$asRoot, inst$asFiber, lane),
          entangleTransitions(payload$asRoot, inst$asFiber, lane));
      },
      enqueueForceUpdate: function (inst, callback) { var inst$asFiber: RR.Fiber, callback$asRoot: RR.FiberRoot | null;
        inst$asFiber = inst._reactInternals!;
        var lane = requestUpdateLane(),
          update = createUpdate(lane);
        update.tag = 2;
        void 0 !== callback &&
          null !== callback &&
          (update.callback = callback);
        callback$asRoot = enqueueUpdate(inst$asFiber, update, lane);
        null !== callback$asRoot &&
          (scheduleUpdateOnFiber(callback$asRoot, inst$asFiber, lane),
          entangleTransitions(callback$asRoot, inst$asFiber, lane));
      }
    },
    SelectiveHydrationException = Error(formatProdErrorMessage(461)),
    didReceiveUpdate = !1,
    SUSPENDED_MARKER: RR.SuspenseState = {
      dehydrated: null,
      treeContext: null,
      retryLane: 0,
      hydrationErrors: null
    },
    offscreenSubtreeIsHidden = !1,
    offscreenSubtreeWasHidden = !1,
    needsFormReset = !1,
    PossiblyWeakSet: RR.RetryCacheConstructor = "function" === typeof WeakSet ? WeakSet : Set,
    nextEffect: RR.Fiber | null = null,
    hostParent: RR.StateNode = null,
    hostParentIsContainer = !1,
    currentHoistableRoot: RR.HoistableRoot | null = null,
    suspenseyCommitFlag: RR.Flags = 8192,
    DefaultAsyncDispatcher: RR.AsyncDispatcher = {
      getCacheForType: function (resourceType) {
        var cache: RR.Cache = readContext(CacheContext)!,
          cacheForType: RR.CacheEntry = cache.data.get(resourceType);
        void 0 === cacheForType &&
          ((cacheForType = resourceType()),
          cache.data.set(resourceType, cacheForType));
        return cacheForType;
      },
      cacheSignal: function () {
        return (readContext(CacheContext)! as RR.Cache).controller.signal;
      }
    },
    COMPONENT_TYPE: RR.SelectorType = 0,
    HAS_PSEUDO_CLASS_TYPE: RR.SelectorType = 1,
    ROLE_TYPE: RR.SelectorType = 2,
    TEST_NAME_TYPE: RR.SelectorType = 3,
    TEXT_TYPE: RR.SelectorType = 4;
  if ("function" === typeof Symbol && Symbol.for) {
    var symbolFor = Symbol.for;
    COMPONENT_TYPE = symbolFor("selector.component");
    HAS_PSEUDO_CLASS_TYPE = symbolFor("selector.has_pseudo_class");
    ROLE_TYPE = symbolFor("selector.role");
    TEST_NAME_TYPE = symbolFor("selector.test_id");
    TEXT_TYPE = symbolFor("selector.text");
  }
  var PossiblyWeakMap: RR.PingCacheConstructor = "function" === typeof WeakMap ? WeakMap : Map,
    executionContext: RR.ExecutionContext = 0,
    workInProgressRoot: RR.FiberRoot | null = null,
    workInProgress: RR.Fiber | null = null,
    workInProgressRootRenderLanes: RR.Lanes = 0,
    workInProgressSuspendedReason: RR.SuspendedReason = 0,
    workInProgressThrownValue: RR.Thrown = null,
    workInProgressRootDidSkipSuspendedSiblings = !1,
    workInProgressRootIsPrerendering = !1,
    workInProgressRootDidAttachPingListener = !1,
    entangledRenderLanes: RR.Lanes = 0,
    workInProgressRootExitStatus: RR.RootExitStatus = 0,
    workInProgressRootSkippedLanes: RR.Lanes = 0,
    workInProgressRootInterleavedUpdatedLanes: RR.Lanes = 0,
    workInProgressRootPingedLanes: RR.Lanes = 0,
    workInProgressDeferredLane: RR.Lane = 0,
    workInProgressSuspendedRetryLanes: RR.Lanes = 0,
    workInProgressRootConcurrentErrors: RR.CapturedValue[] | null = null,
    workInProgressRootRecoverableErrors: RR.CapturedValue[] | null = null,
    workInProgressRootDidIncludeRecursiveRenderUpdate = !1,
    globalMostRecentFallbackTime: RR.Milliseconds = 0,
    globalMostRecentTransitionTime: RR.Milliseconds = 0,
    workInProgressRootRenderTargetTime: RR.Milliseconds = Infinity,
    workInProgressTransitions: RR.Transition[] | null = null,
    legacyErrorBoundariesThatAlreadyFailed: Set<RR.ClassInstance> | null = null,
    pendingEffectsStatus: RR.PendingEffectsStatus = 0,
    pendingEffectsRoot: RR.FiberRoot | null = null,
    pendingFinishedWork: RR.Fiber | null = null,
    pendingEffectsLanes: RR.Lanes = 0,
    pendingEffectsRemainingLanes: RR.Lanes = 0,
    pendingPassiveTransitions: RR.Transition[] | null = null,
    pendingRecoverableErrors: RR.CapturedValue[] | null = null,
    nestedUpdateCount = 0,
    rootWithNestedUpdates: RR.FiberRoot | null = null;
  exports.attemptContinuousHydration = function (fiber) {
    if (13 === fiber.tag || 31 === fiber.tag) {
      var root = enqueueConcurrentRenderForLane(fiber, 67108864);
      null !== root && scheduleUpdateOnFiber(root, fiber, 67108864);
      markRetryLaneIfNotHydrated(fiber, 67108864);
    }
  };
  exports.attemptHydrationAtCurrentPriority = function (fiber) {
    if (13 === fiber.tag || 31 === fiber.tag) {
      var lane = requestUpdateLane();
      lane = getBumpedLaneForHydrationByLane(lane);
      var root = enqueueConcurrentRenderForLane(fiber, lane);
      null !== root && scheduleUpdateOnFiber(root, fiber, lane);
      markRetryLaneIfNotHydrated(fiber, lane);
    }
  };
  exports.attemptSynchronousHydration = function (fiber) { var fiber$asRoot: RR.FiberRoot, lanes$asRoot: RR.FiberRoot | null;
    switch (fiber.tag) {
      case 3:
        fiber$asRoot = fiber.stateNode as RR.FiberRoot;
        if ((fiber$asRoot.current!.memoizedState as RR.RootState).isDehydrated) {
          var lanes: RR.Lanes = getHighestPriorityLanes(fiber$asRoot.pendingLanes);
          if (0 !== lanes) {
            fiber$asRoot.pendingLanes |= 2;
            for (fiber$asRoot.entangledLanes |= 2; lanes; ) {
              var lane = 1 << (31 - clz32(lanes));
              fiber$asRoot.entanglements[1] |= lane;
              lanes &= ~lane;
            }
            ensureRootIsScheduled(fiber$asRoot);
            0 === (executionContext & 6) &&
              ((workInProgressRootRenderTargetTime = now() + 500),
              flushSyncWorkAcrossRoots_impl(0, !1));
          }
        }
        break;
      case 31:
      case 13:
        (lanes$asRoot = enqueueConcurrentRenderForLane(fiber, 2)),
          null !== lanes$asRoot && scheduleUpdateOnFiber(lanes$asRoot, fiber, 2),
          flushSyncWork(),
          markRetryLaneIfNotHydrated(fiber, 2);
    }
  };
  exports.batchedUpdates = function (fn, a) {
    return fn(a);
  };
  exports.createComponentSelector = function (component): RR.Selector {
    return { $$typeof: COMPONENT_TYPE, value: component };
  };
  exports.createContainer = function (
    containerInfo,
    tag,
    hydrationCallbacks,
    isStrictMode,
    concurrentUpdatesByDefaultOverride,
    identifierPrefix,
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
    onDefaultTransitionIndicator
  ) {
    return createFiberRoot(
      containerInfo,
      tag as RR.RootTag,
      !1,
      null,
      hydrationCallbacks,
      isStrictMode,
      identifierPrefix,
      null,
      onUncaughtError,
      onCaughtError,
      onRecoverableError,
      onDefaultTransitionIndicator
    );
  };
  exports.createHasPseudoClassSelector = function (selectors): RR.Selector {
    return { $$typeof: HAS_PSEUDO_CLASS_TYPE, value: selectors };
  };
  exports.createHydrationContainer = function (
    initialChildren,
    callback,
    containerInfo,
    tag,
    hydrationCallbacks: RR.Carried,
    isStrictMode,
    concurrentUpdatesByDefaultOverride,
    identifierPrefix,
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
    onDefaultTransitionIndicator,
    transitionCallbacks,
    formState
  ) { var initialChildren$asRoot: RR.FiberRoot, callback$asLane: RR.Lane, containerInfo$asFiber: RR.Fiber, tag$asLane: RR.Lane, hydrationCallbacks$asUpdate: RR.Update;
    initialChildren$asRoot = createFiberRoot(
      containerInfo,
      tag as RR.RootTag,
      !0,
      initialChildren,
      hydrationCallbacks,
      isStrictMode,
      identifierPrefix,
      formState,
      onUncaughtError,
      onCaughtError,
      onRecoverableError,
      onDefaultTransitionIndicator
    );
    initialChildren$asRoot.context = getContextForSubtree(null);
    containerInfo$asFiber = initialChildren$asRoot.current!;
    tag$asLane = requestUpdateLane();
    tag$asLane = getBumpedLaneForHydrationByLane(tag$asLane);
    hydrationCallbacks$asUpdate = createUpdate(tag$asLane);
    hydrationCallbacks$asUpdate.callback =
      void 0 !== callback && null !== callback ? callback : null;
    enqueueUpdate(containerInfo$asFiber, hydrationCallbacks$asUpdate, tag$asLane);
    callback$asLane = tag$asLane;
    initialChildren$asRoot.current!.lanes = callback$asLane;
    markRootUpdated$1(initialChildren$asRoot, callback$asLane);
    ensureRootIsScheduled(initialChildren$asRoot);
    return initialChildren$asRoot;
  };
  exports.createPortal = function (children, containerInfo, implementation): RR.ReactPortal {
    var key: unknown =
      3 < arguments.length && void 0 !== arguments[3] ? arguments[3] : null;
    return {
      $$typeof: REACT_PORTAL_TYPE,
      key: null == key ? null : "" + key,
      children: children,
      containerInfo: containerInfo,
      implementation: implementation
    };
  };
  exports.createRoleSelector = function (role): RR.Selector {
    return { $$typeof: ROLE_TYPE, value: role };
  };
  exports.createTestNameSelector = function (id): RR.Selector {
    return { $$typeof: TEST_NAME_TYPE, value: id };
  };
  exports.createTextSelector = function (text): RR.Selector {
    return { $$typeof: TEXT_TYPE, value: text };
  };
  exports.defaultOnCaughtError = function (error) {
    console.error(error);
  };
  exports.defaultOnRecoverableError = function (error) {
    reportGlobalError(error);
  };
  exports.defaultOnUncaughtError = function (error) {
    reportGlobalError(error);
  };
  exports.deferredUpdates = function (fn) {
    var prevTransition = ReactSharedInternals.T,
      previousPriority = getCurrentUpdatePriority();
    try {
      return (
        setCurrentUpdatePriority(32), (ReactSharedInternals.T = null), fn()
      );
    } finally {
      setCurrentUpdatePriority(previousPriority),
        (ReactSharedInternals.T = prevTransition);
    }
  };
  exports.discreteUpdates = function (fn, a, b, c, d) {
    var prevTransition = ReactSharedInternals.T,
      previousPriority = getCurrentUpdatePriority();
    try {
      return (
        setCurrentUpdatePriority(2),
        (ReactSharedInternals.T = null),
        fn(a, b, c, d)
      );
    } finally {
      setCurrentUpdatePriority(previousPriority),
        (ReactSharedInternals.T = prevTransition),
        0 === executionContext &&
          (workInProgressRootRenderTargetTime = now() + 500);
    }
  };
  exports.findAllNodes = findAllNodes;
  exports.findBoundingRects = function (hostRoot, selectors) { var hostRoot$asRects: RR.BoundingRect[], selectors$asNodes: RR.StateNode[], selectors$asIndex: number, i$asRect: RR.BoundingRect;
    if (!supportsTestSelectors) throw Error(formatProdErrorMessage(363));
    selectors$asNodes = findAllNodes(hostRoot, selectors);
    hostRoot$asRects = [];
    for (var i: number = 0; i < selectors$asNodes.length; i++)
      hostRoot$asRects.push(getBoundingRect!(selectors$asNodes[i]));
    for (selectors$asIndex = hostRoot$asRects.length - 1; 0 < selectors$asIndex; selectors$asIndex--) {
      i$asRect = hostRoot$asRects[selectors$asIndex];
      for (
        var targetLeft = i$asRect.x,
          targetRight = targetLeft + i$asRect.width,
          targetTop = i$asRect.y,
          targetBottom = targetTop + i$asRect.height,
          j: number = selectors$asIndex - 1;
        0 <= j;
        j--
      )
        if (selectors$asIndex !== j) {
          var otherRect = hostRoot$asRects[j],
            otherLeft = otherRect.x,
            otherRight = otherLeft + otherRect.width,
            otherTop = otherRect.y,
            otherBottom = otherTop + otherRect.height;
          if (
            targetLeft >= otherLeft &&
            targetTop >= otherTop &&
            targetRight <= otherRight &&
            targetBottom <= otherBottom
          ) {
            hostRoot$asRects.splice(selectors$asIndex, 1);
            break;
          } else if (
            !(
              targetLeft !== otherLeft ||
              i$asRect.width !== otherRect.width ||
              otherBottom < targetTop ||
              otherTop > targetBottom
            )
          ) {
            otherTop > targetTop &&
              ((otherRect.height += otherTop - targetTop),
              (otherRect.y = targetTop));
            otherBottom < targetBottom &&
              (otherRect.height = targetBottom - otherTop);
            hostRoot$asRects.splice(selectors$asIndex, 1);
            break;
          } else if (
            !(
              targetTop !== otherTop ||
              i$asRect.height !== otherRect.height ||
              otherRight < targetLeft ||
              otherLeft > targetRight
            )
          ) {
            otherLeft > targetLeft &&
              ((otherRect.width += otherLeft - targetLeft),
              (otherRect.x = targetLeft));
            otherRight < targetRight &&
              (otherRect.width = targetRight - otherLeft);
            hostRoot$asRects.splice(selectors$asIndex, 1);
            break;
          }
        }
    }
    return hostRoot$asRects;
  };
  exports.findHostInstance = findHostInstance;
  exports.findHostInstanceWithNoPortals = function (fiber) { var fiber$asCurrent: RR.Fiber | null, fiber$asHostFiber: RR.Fiber | null;
    fiber$asCurrent = findCurrentFiberUsingSlowPath(fiber);
    fiber$asHostFiber =
      null !== fiber$asCurrent ? findCurrentHostFiberWithNoPortalsImpl(fiber$asCurrent) : null;
    return null === fiber$asHostFiber ? null : getPublicInstance(fiber$asHostFiber.stateNode);
  };
  exports.findHostInstanceWithWarning = function (component) {
    return findHostInstance(component);
  };
  exports.flushPassiveEffects = flushPendingEffects;
  exports.flushSyncFromReconciler = function (fn) {
    var prevExecutionContext = executionContext;
    executionContext |= 1;
    var prevTransition = ReactSharedInternals.T,
      previousPriority = getCurrentUpdatePriority();
    try {
      if ((setCurrentUpdatePriority(2), (ReactSharedInternals.T = null), fn))
        return fn();
    } finally {
      setCurrentUpdatePriority(previousPriority),
        (ReactSharedInternals.T = prevTransition),
        (executionContext = prevExecutionContext),
        0 === (executionContext & 6) && flushSyncWorkAcrossRoots_impl(0, !1);
    }
  };
  exports.flushSyncWork = flushSyncWork;
  exports.focusWithin = function (hostRoot, selectors) { var hostRoot$asRoot: RR.Fiber, hostRoot$asIndex: number, selectors$asPaths: RR.Fiber[], selectors$asStack: RR.Fiber[], fiber$asChild: RR.Fiber | null;
    if (!supportsTestSelectors) throw Error(formatProdErrorMessage(363));
    hostRoot$asRoot = findFiberRootForHostRoot(hostRoot);
    selectors$asPaths = findPaths(hostRoot$asRoot, selectors);
    selectors$asStack = Array.from(selectors$asPaths);
    for (hostRoot$asIndex = 0; hostRoot$asIndex < selectors$asStack.length; ) {
      var fiber: RR.Fiber = selectors$asStack[hostRoot$asIndex++],
        tag = fiber.tag;
      if (!isHiddenSubtree!(fiber)) {
        if (
          (5 === tag || 26 === tag || 27 === tag) &&
          setFocusIfFocusable!(fiber.stateNode)
        )
          return !0;
        for (fiber$asChild = fiber.child; null !== fiber$asChild; )
          selectors$asStack.push(fiber$asChild), (fiber$asChild = fiber$asChild.sibling);
      }
    }
    return !1;
  };
  exports.getFindAllNodesFailureDescription = function (hostRoot, selectors) { var hostRoot$asStack: RR.SelectorStackEntry[], hostRoot$asNames: string[], fiber$asChild: RR.Fiber | null;
    if (!supportsTestSelectors) throw Error(formatProdErrorMessage(363));
    var maxSelectorIndex = 0,
      matchedNames: string[] = [];
    hostRoot$asStack = [findFiberRootForHostRoot(hostRoot), 0];
    for (var index = 0; index < hostRoot$asStack.length; ) {
      var fiber: RR.Fiber = hostRoot$asStack[index++] as RR.Fiber,
        tag = fiber.tag,
        selectorIndex = hostRoot$asStack[index++] as number,
        selector = selectors[selectorIndex];
      if ((5 !== tag && 26 !== tag && 27 !== tag) || !isHiddenSubtree!(fiber))
        if (
          (matchSelector(fiber, selector) &&
            (matchedNames.push(selectorToString(selector)),
            selectorIndex++,
            selectorIndex > maxSelectorIndex &&
              (maxSelectorIndex = selectorIndex)),
          selectorIndex < selectors.length)
        )
          for (fiber$asChild = fiber.child; null !== fiber$asChild; )
            hostRoot$asStack.push(fiber$asChild, selectorIndex), (fiber$asChild = fiber$asChild.sibling);
    }
    if (maxSelectorIndex < selectors.length) {
      for (
        hostRoot$asNames = [];
        maxSelectorIndex < selectors.length;
        maxSelectorIndex++
      )
        hostRoot$asNames.push(selectorToString(selectors[maxSelectorIndex]));
      return (
        "findAllNodes was able to match part of the selector:\n  " +
        (matchedNames.join(" > ") +
          "\n\nNo matching component was found for:\n  ") +
        hostRoot$asNames.join(" > ")
      );
    }
    return null;
  };
  exports.getPublicRootInstance = function (container) { var container$asFiber: RR.Fiber;
    container$asFiber = container.current!;
    if (!container$asFiber.child) return null;
    switch (container$asFiber.child.tag) {
      case 27:
      case 5:
        return getPublicInstance(container$asFiber.child.stateNode);
      default:
        return container$asFiber.child.stateNode;
    }
  };
  exports.injectIntoDevTools = function () { var internals$asResult: boolean;
    var internals: RR.DevToolsInternals = {
      bundleType: 0,
      version: rendererVersion,
      rendererPackageName: rendererPackageName,
      currentDispatcherRef: ReactSharedInternals,
      reconcilerVersion: "19.2.0"
    };
    null !== extraDevToolsConfig &&
      (internals.rendererConfig = extraDevToolsConfig);
    if ("undefined" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__) internals$asResult = !1;
    else {
      var hook = __REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook.isDisabled || !hook.supportsFiber) internals$asResult = !0;
      else {
        try {
          (rendererID = hook.inject(internals)), (injectedHook = hook);
        } catch (err) {}
        internals$asResult = hook.checkDCE ? !0 : !1;
      }
    }
    return internals$asResult;
  };
  exports.isAlreadyRendering = function () {
    return 0 !== (executionContext & 6);
  };
  exports.observeVisibleRects = function (
    hostRoot,
    selectors,
    callback,
    options
  ): RR.Disconnectable { var hostRoot$asNodes: RR.StateNode[];
    if (!supportsTestSelectors) throw Error(formatProdErrorMessage(363));
    hostRoot$asNodes = findAllNodes(hostRoot, selectors);
    var disconnect: () => void = setupIntersectionObserver!(
      hostRoot$asNodes,
      callback,
      options
    ).disconnect;
    return {
      disconnect: function () {
        disconnect();
      }
    };
  };
  exports.shouldError = function () {
    return null;
  };
  exports.shouldSuspend = function () {
    return !1;
  };
  exports.startHostTransition = function (
    formFiber,
    pendingState,
    action,
    formData
  ) {
    if (5 !== formFiber.tag) throw Error(formatProdErrorMessage(476));
    var queue: RR.HookQueue = ensureFormComponentIsStateful(formFiber).queue as RR.HookQueue;
    startTransition(
      formFiber,
      queue,
      pendingState,
      NotPendingTransition,
      null === action
        ? noop
        : function () {
            var stateHook: RR.Hook = ensureFormComponentIsStateful(formFiber);
            null === stateHook.next &&
              (stateHook = formFiber.alternate!.memoizedState as RR.Hook);
            dispatchSetStateInternal<RR.FormResetState>(
              formFiber,
              stateHook.next!.queue as RR.HookQueue,
              {},
              requestUpdateLane()
            );
            return action(formData);
          }
    );
  };
  exports.updateContainer = function (
    element,
    container,
    parentComponent,
    callback
  ) {
    var current: RR.Fiber = container.current!,
      lane: RR.Lane = requestUpdateLane();
    updateContainerImpl(
      current,
      lane,
      element,
      container,
      parentComponent,
      callback
    );
    return lane;
  };
  exports.updateContainerSync = function (
    element,
    container,
    parentComponent,
    callback
  ) {
    updateContainerImpl(
      container.current!,
      2,
      element,
      container,
      parentComponent,
      callback
    );
    return 2;
  };
  return exports;
};
//module.exports.default = module.exports;
//Object.defineProperty(module.exports, "__esModule", { value: !0 });
import * as react$module from "react";
import * as scheduler$module from "scheduler";
namespace RR {
  export type IteratorFn = (this: ReactNode) => Iterator<ReactNode>;
  export type AnyElementType = any;
}
namespace RR {
  export type ComponentFunction = any;
  export type FakeOrResult = any;
  export type PrepareStackTrace = (error: Error, structuredStackTrace: unknown[]) => unknown;
  export type ComponentFrameStacks = [sample: string | null, control: string | null | undefined];
  export interface RootFrameRunner { DetermineComponentFrameRoot: { (): ComponentFrameStacks; displayName?: string } }
}
namespace RR {
  export type ThrownObject = any;
  export type ThrownInUnion = ThrownObject | string | number | boolean | bigint | symbol | null | undefined;
  export type Comparand = any;
  export type LazyResult = any;
}
namespace RR {
  export type ChildReconciler = (returnFiber: Fiber, currentFirstChild: Fiber | null, newChild: ReactNode, lanes: Lanes) => Fiber | null;
  export type ExistingChildren = Map<string | number, Fiber>;
  export type ChildIteratorResult = any;
  export type ChildIterator = any;
}
namespace RR {
  export type StateUpdater = (this: any, prevState: any, nextProps: any) => any;
}
namespace RR {
  export type HookStateObject = any;
  export type HookStateInUnion = HookStateObject | string | number | bigint | boolean | symbol | null | undefined;
  export interface StoreInstance { pending?: null }
  export type UsableThenable = any;
  export type UsableContext = any;
  export type UsableGiven = UsableThenable | UsableContext;
  export type UsedValue = any;
  export type StoreSubscribe = (onStoreChange: () => void) => () => void;
  export type GetSnapshot = () => any;
  export type ActionPayload = any;
}
namespace RR {
  export type MemoizedPair<T = any> = [value: T, deps: HookDeps | null];
  export interface FormResetState {}
}
namespace RR {
  export type DeriveStateFromProps = (nextProps: any, prevState: any) => ClassState | null | undefined;
  export type PropsWithRef = any;
  export type MemoCompare = (prevProps: any, nextProps: any) => boolean;
}
namespace RR {
  export interface CarriedObject { [name: string]: unknown }
  export type Carried = CarriedObject | string | number | bigint | boolean | symbol | null | undefined;
}
namespace RR {
  export type GivenObject = any;
  export type Given = GivenObject | string | number | bigint | boolean | symbol | null | undefined;
}
namespace RR {
  export type AnythingObject = any;
  export type Anything = AnythingObject | string | number | bigint | boolean | symbol | null | undefined;
  export type ResolvedLazy = Exclude<ElementType, string | symbol>;
  export type PropsOrChildren = any;
}
namespace RR {
  export type PropsInUnion = Props | string | number | bigint | boolean | symbol | null | undefined;
  export type PropsArg = unknown;
  export type CompleteWorkCurrent = Fiber | HostContext | Instance | SuspenseState | FiberUpdateQueue | Lanes | boolean | null;
  export type CompleteWorkRenderLanes = Lanes | FiberRoot | HostContext | MemoizedState | CapturedValue[] | Fiber | OffscreenQueue | Cache | boolean | null;
  export type CompleteWorkNewProps = PropsInUnion | Cache | SuspenseState | SuspenseListRenderState | Fiber;
  export type CompleteWorkType = ElementType | Fiber | SuspenseState | SuspenseInstance | CapturedValue[] | Cache | boolean | null;
  export type CompleteWorkNextResource = MemoizedState | Props | HostContext | Cache | Fiber | null;
}
namespace RR {
  export type SnapshotObject = any;
  export type Snapshot = SnapshotObject | string | number | bigint | boolean | symbol | null | undefined;
}
namespace RR {
  export type SelectorStackEntry = Fiber | number;
}
namespace RR {
  export type ScheduleCommit = (initiateCommit: () => unknown) => () => void;
  export type SuspendedCommitReason = string | null;
}
namespace RR {
  export type PrototypeHolder = any;
  export type TypeObjectGiven = any;
  export type ElementTypeGiven = ElementType | TypeObjectGiven | number | bigint | boolean | undefined;
}
namespace RR {
  export type TransitionResult = any;
  export type ReducerInUnion = (state: any, action: any) => HookStateInUnion;
}
namespace RR {
  export type CacheEntry = any;
  export type SelectorStackOrNames = Array<SelectorStackEntry | string>;
}
declare var module: { exports: any };
declare function require(name: string): any;
declare var console: { error(...data: any[]): void };
declare function setTimeout(handler: () => void, timeout?: number): RR.TimeoutHandle;
declare var reportError: (error: any) => void;
declare var window: RR.WindowLike;
declare var process: RR.ProcessLike;
declare var AbortController: RR.AbortControllerConstructor;
declare var __REACT_DEVTOOLS_GLOBAL_HOOK__: RR.DevToolsHook;
namespace RR {
  export type int32 = import("bun").int32;
  export type Lane = int32;
  export type Lanes = int32;
  export type LaneMap<T> = T[];
  export type Flags = int32;
  export type WorkTag = int32;
  export type TypeOfMode = int32;
  export type HookFlags = int32;
  export type RootTag = int32;
  export type UpdateTag = int32;
  export type EventPriority = number;
  export type SchedulerPriority = number;
  export type ExecutionContext = int32;
  export type RootExitStatus = int32;
  export type SuspendedReason = int32;
  export type PendingEffectsStatus = int32;
  export type SuspenseContext = int32;
  export type OffscreenVisibility = int32;
  export type Milliseconds = number;
  export type ReactNode = any;
  export type ContextValue = any;
  export type HookState = any;
  export type Payload = any;
  export type Thrown = any;
  export type HostObject = any;
  export type ClassState = any;
  export type Instance = HostObject;
  export type TextInstance = HostObject;
  export type SuspenseInstance = HostObject;
  export type ActivityInstance = HostObject;
  export type HydratableInstance = HostObject;
  export type FormInstance = HostObject;
  export type PublicInstance = HostObject;
  export type Container = HostObject;
  export type ChildSet = HostObject;
  export type HoistableRoot = HostObject;
  export type Resource = HostObject;
  export type SuspendedState = HostObject;
  export type UpdatePayload = HostObject;
  export type HostContext = HostObject | number | string | null;
  export type TransitionStatus = HostObject | null;
  export type TimeoutHandle = HostObject | number;
  export type NoTimeout = number;
  export type LegacyContext = any;
  export type Props = any;
  export type State = MemoizedState;
  export type HostArg = StateNode;
  export type ResourceArg = MemoizedState;
  export type HostType = ElementType;
  export interface Fiber {
    tag: WorkTag;
    key: string | null;
    elementType: any;
    type: ElementType;
    stateNode: StateNode;
    return: Fiber | null;
    child: Fiber | null;
    sibling: Fiber | null;
    index: number;
    ref: Ref;
    refCleanup: RefCleanup;
    pendingProps: any;
    memoizedProps: any;
    updateQueue: FiberUpdateQueue;
    memoizedState: MemoizedState;
    dependencies: Dependencies | null;
    mode: TypeOfMode;
    flags: Flags;
    subtreeFlags: Flags;
    deletions: Fiber[] | null;
    lanes: Lanes;
    childLanes: Lanes;
    alternate: Fiber | null;
  }
  export interface FiberConstructor { new (tag: WorkTag, pendingProps: any, key: string | null, mode: TypeOfMode): Fiber }
  export type MemoizedState = Hook | RootState | SuspenseState | SuspenseListRenderState | OffscreenState | CacheComponentState | ClassState | Resource | null;
  export type FiberUpdateQueue = UpdateQueue | FunctionComponentUpdateQueue | OffscreenQueue | RetryQueue | null;
  export type StateNode = FiberRoot | ClassInstance | PortalState | OffscreenInstance | RetryCache | ProfilerState | HostObject | null;
  export interface FiberRoot {
    tag: RootTag;
    containerInfo: Container;
    pendingChildren: ChildSet | null;
    current: Fiber | null;
    pingCache: PingCache | null;
    timeoutHandle: TimeoutHandle | NoTimeout;
    cancelPendingCommit: (() => void) | null;
    context: LegacyContext | null;
    pendingContext: LegacyContext | null;
    next: FiberRoot | null;
    callbackNode: SchedulerTask | null;
    callbackPriority: Lane;
    expirationTimes: LaneMap<Milliseconds>;
    pendingLanes: Lanes;
    suspendedLanes: Lanes;
    pingedLanes: Lanes;
    warmLanes: Lanes;
    expiredLanes: Lanes;
    errorRecoveryDisabledLanes: Lanes;
    shellSuspendCounter: number;
    entangledLanes: Lanes;
    entanglements: LaneMap<Lanes>;
    hiddenUpdates: LaneMap<ConcurrentUpdate[] | null>;
    identifierPrefix: string;
    onUncaughtError: OnUncaughtError;
    onCaughtError: OnCaughtError;
    onRecoverableError: OnRecoverableError;
    pooledCache: Cache | null;
    pooledCacheLanes: Lanes;
    formState: ReactFormState | null;
    incompleteTransitions: Map<Transition, unknown>;
  }
  export interface FiberRootConstructor {
    new (
      containerInfo: Container,
      tag: RootTag,
      hydrate: boolean,
      identifierPrefix: string,
      onUncaughtError: OnUncaughtError,
      onCaughtError: OnCaughtError,
      onRecoverableError: OnRecoverableError,
      onDefaultTransitionIndicator: OnDefaultTransitionIndicator,
      formState: ReactFormState | null
    ): FiberRoot;
  }
  export type OnUncaughtError = (error: Thrown, errorInfo: ErrorInfo) => void;
  export type OnCaughtError = (error: Thrown, errorInfo: CaughtErrorInfo) => void;
  export type OnRecoverableError = (error: Thrown, errorInfo: ErrorInfo) => void;
  export type OnDefaultTransitionIndicator = () => void | (() => void);
  export interface ErrorInfo { componentStack: string | null }
  export interface CaughtErrorInfo { componentStack: string | null; errorBoundary: StateNode }
  export type ReactFormState = [state: any, keyPath: string, referenceId: string | null, boundArgumentCount: number];
  export type PingCache = WeakMap<Wakeable, Set<Lanes>>;
  export type PingCacheConstructor = any;
  export interface RootState { element: ReactNode; isDehydrated: boolean; cache: Cache }
  export interface RootUpdatePayload { element: ReactNode }
  export interface Update { lane: Lane; tag: UpdateTag; payload: Payload; callback: UpdateCallback | null; next: Update | null }
  export type UpdateCallback = (this: any) => unknown;
  export interface SharedQueue { pending: Update | null; lanes: Lanes; hiddenCallbacks: UpdateCallback[] | null }
  export interface UpdateQueue {
    baseState: MemoizedState;
    firstBaseUpdate: Update | null;
    lastBaseUpdate: Update | null;
    shared: SharedQueue;
    callbacks: UpdateCallback[] | null;
  }
  export interface ConcurrentUpdate { lane: Lane; next: ConcurrentUpdate | null }
  export interface ConcurrentQueue { pending: ConcurrentUpdate | null }
  export type ConcurrentQueuesEntry = any;
  export interface Hook {
    memoizedState: HookState;
    baseState: HookState;
    baseQueue: HookUpdate | null;
    queue: any;
    next: Hook | null;
  }
  export interface HookUpdate {
    lane: Lane;
    revertLane: Lane;
    gesture: null;
    action: HookState;
    hasEagerState: boolean;
    eagerState: HookState;
    next: HookUpdate | null;
  }
  export interface HookQueue {
    pending: HookUpdate | null;
    lanes: Lanes;
    dispatch: Dispatch | null;
    lastRenderedReducer: Reducer | null;
    lastRenderedState: HookState;
  }
  export type Dispatch = (action?: any) => void;
  export type Reducer = (state: any, action: any) => any;
  export type HookDeps = any[];
  export type EffectDestroy = () => void;
  export type EffectCreate = () => EffectDestroy | void;
  export interface Effect { tag: HookFlags; create: EffectCreate; deps: HookDeps | null; inst: EffectInstance; next: Effect | null }
  export interface EffectInstance { destroy: EffectDestroy | void }
  export interface FunctionComponentUpdateQueue {
    lastEffect: Effect | null;
    events: EventFunctionPayload[] | null;
    stores: StoreConsistencyCheck[] | null;
    memoCache: MemoCache | null;
  }
  export interface MemoCache { data: any[][]; index: number }
  export interface EventFunctionRef { impl: (...args: any[]) => any }
  export interface EventFunctionPayload { ref: EventFunctionRef; nextImpl: (...args: any[]) => any }
  export interface StoreConsistencyCheck { getSnapshot: () => any; value: any }
  export interface StoreInstance { value: any; getSnapshot: () => any }
  export type ActionFn = (state: any, payload: any) => any;
  export interface ActionStateQueue { state: any; dispatch: Dispatch | null; action: ActionFn | null; pending: ActionStateQueueNode | null }
  export interface ActionStateQueueNode {
    payload: any;
    action: ActionFn;
    next: ActionStateQueueNode | null;
    isTransition: boolean;
    status: ThenableStatus;
    value: any;
    reason: Thrown;
    listeners: Array<(value?: any) => unknown>;
    then(listener: (value?: any) => unknown): void;
  }
  export type RefObject = any;
  export type RefCallback = (instance: any) => void | (() => void);
  export type Ref = RefCallback | RefObject | null;
  export type RefCleanup = (() => void) | void | null;
  export type DispatchTuple = [state: any, dispatch: Dispatch | null];
  export type StartTransition = (callback: () => unknown) => void;
  export type TransitionTuple = [isPending: boolean, start: StartTransition];
  export type ActionStateTuple = [state: any, dispatch: Dispatch | null, isPending: boolean];
  export type Usable = Thenable<any> | ReactContext<any>;
  export interface Dispatcher {
    readContext<T>(context: ReactContext<T>): T;
    use(usable: Usable): any;
    useCallback(callback: any, deps: HookDeps | null | undefined): any;
    useContext<T>(context: ReactContext<T>): T;
    useEffect(create: EffectCreate, deps: HookDeps | null | undefined): void;
    useImperativeHandle(ref: Ref | undefined, create: () => any, deps: HookDeps | null | undefined): void;
    useLayoutEffect(create: EffectCreate, deps: HookDeps | null | undefined): void;
    useInsertionEffect(create: EffectCreate, deps: HookDeps | null | undefined): void;
    useMemo(nextCreate: () => any, deps: HookDeps | null | undefined): any;
    useReducer(reducer: Reducer, initialArg: any, init?: (initialArg: any) => any): DispatchTuple;
    useRef(initialValue: any): RefObject;
    useState(initialState?: any): DispatchTuple;
    useDebugValue(value?: any, formatterFn?: (value: any) => any): void;
    useDeferredValue(value: any, initialValue?: any): any;
    useTransition(): TransitionTuple;
    useSyncExternalStore(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => any, getServerSnapshot?: () => any): any;
    useId(): string;
    useHostTransitionStatus(): TransitionStatus;
    useFormState(action: ActionFn, initialState: any, permalink?: string): ActionStateTuple;
    useActionState(action: ActionFn, initialState: any, permalink?: string): ActionStateTuple;
    useOptimistic(passthrough: any, reducer?: Reducer | null): DispatchTuple;
    useMemoCache(size: number): any[];
    useCacheRefresh(): () => void;
    useEffectEvent?(callback: (...args: any[]) => any): (...args: any[]) => any;
  }
  export interface AsyncDispatcher { getCacheForType<T>(resourceType: () => T): T; cacheSignal(): AbortSignalLike }
  export interface ClassComponentUpdater {
    enqueueSetState(inst: ClassInstance, payload: Payload, callback?: UpdateCallback | null): void;
    enqueueReplaceState(inst: ClassInstance, payload: Payload, callback?: UpdateCallback | null): void;
    enqueueForceUpdate(inst: ClassInstance, callback?: UpdateCallback | null): void;
  }
  export interface ContextDependency { context: ReactContext<any>; memoizedValue: ContextValue; next: ContextDependency | null }
  export interface Dependencies { lanes: Lanes; firstContext: ContextDependency | null }
  export type ReactContext<T = any> = any;
  export interface Cache { controller: AbortControllerLike; data: Map<() => unknown, unknown>; refCount: number }
  export interface CacheComponentState { parent: Cache | null; cache: Cache | null }
  export interface CacheUpdatePayload { cache: Cache }
  export interface SpawnedCachePool { parent: Cache | null; pool: Cache | null }
  export interface AbortSignalLike { aborted: boolean; addEventListener(type: string, listener: () => void): void }
  export type AbortControllerLike = any;
  export type AbortControllerConstructor = any;
  export type Transition = any;
  export interface TreeContext { id: number; overflow: string }
  export interface SuspenseState {
    dehydrated: SuspenseInstance | ActivityInstance | null;
    treeContext: TreeContext | null;
    retryLane: Lane;
    hydrationErrors: CapturedValue[] | null;
  }
  export type ActivityState = SuspenseState;
  export interface OffscreenState { baseLanes: Lanes; cachePool: SpawnedCachePool | null }
  export type HiddenContext = OffscreenState;
  export interface OffscreenInstance {
    _visibility: OffscreenVisibility;
    _pendingMarkers: null;
    _retryCache: RetryCache | null;
    _transitions: null;
  }
  export interface OffscreenQueue { transitions: null; markerInstances: null; retryQueue: RetryQueue | null }
  export type RetryQueue = Set<Wakeable>;
  export type RetryCache = WeakSet<Wakeable>;
  export type RetryCacheConstructor = any;
  export type SuspenseListTailMode = string | undefined;
  export interface SuspenseListRenderState {
    isBackwards: boolean;
    rendering: Fiber | null;
    renderingStartTime: Milliseconds;
    last: Fiber | null;
    tail: Fiber | null;
    tailMode: SuspenseListTailMode;
    treeForkCount: number;
    lastEffect?: null;
  }
  export type ProfilerState = any;
  export interface OffscreenProps { mode: unknown; children: ReactNode }
  export type SuspenseProps = any;
  export type ActivityProps = any;
  export type SuspenseListProps = any;
  export type ProviderProps = any;
  export type ConsumerProps = any;
  export type ProfilerProps = any;
  export type ThenableStatus = "pending" | "fulfilled" | "rejected";
  export type Wakeable = any;
  export type Thenable<T = any> = any;
  export type ThenableState = Thenable<any>[];
  export interface EntangledActionThenable { status: ThenableStatus; value: undefined; then(resolve: () => unknown): void }
  export interface ChainedThenable<T = any> { status: ThenableStatus; value: T | null; reason: Thrown; then(resolve: (value?: T) => unknown): void }
  export interface RejectedThenable { then(): void; status: "rejected"; reason: Thrown }
  export interface NoopThenable { then(): void }
  export interface StackCursor<T> { current: T }
  export interface CapturedValue { value: Thrown; source: Fiber | null; stack: string | null }
  export type ForkStackEntry = Fiber | number | null;
  export type IdStackEntry = Fiber | number | string | null;
  export interface PortalState { containerInfo: Container; pendingChildren: ChildSet | null; implementation: unknown }
  export type ComponentFrameSample = [sample: string | null, control: string | null];
  export interface RunInRootFrame { DetermineComponentFrameRoot: { (): ComponentFrameSample; displayName?: string } }
  export type ReactElement = any;
  export interface ReactPortal { $$typeof: symbol; key: string | null; children: ReactNode; containerInfo: Container; implementation: unknown }
  export type LazyComponent = any;
  export type ForwardRefType = any;
  export type MemoType = any;
  export type ConsumerType = any;
  export type FunctionComponent = any;
  export type ClassPrototype = any;
  export type ClassComponent = any;
  export type GetDerivedStateFromProps = (nextProps: any, prevState: any) => any;
  export type ElementType = string | symbol | FunctionComponent | ClassComponent | ReactContext<any> | ConsumerType | ForwardRefType | MemoType | LazyComponent | null;
  export type ClassInstance = any;
  export type SharedInternals = any;
  export type ReactModule = any;
  export type SchedulerCallback = (didTimeout: boolean) => SchedulerCallback | null | undefined | void;
  export type SchedulerTask = any;
  export type SchedulerModule = any;
  export type DevToolsHook = any;
  export interface DevToolsInternals {
    bundleType: number;
    version: string | undefined;
    rendererPackageName: string | undefined;
    currentDispatcherRef: SharedInternals;
    reconcilerVersion: string;
    rendererConfig?: unknown;
  }
  export type SelectorType = symbol | number;
  export interface Selector { $$typeof: SelectorType; value: any }
  export type BoundingRect = any;
  export type IntersectionObserverOptionsLike = any;
  export type ObserveVisibleRectsCallback = (intersections: Array<{ ratio: number; rect: BoundingRect }>) => void;
  export interface Disconnectable { disconnect(): void }
  export interface ErrorEventInitLike { bubbles: boolean; cancelable: boolean; message: string; error: Thrown }
  export type WindowLike = any;
  export type ProcessLike = any;
  export type HostConfig = any;
  export interface Reconciler {
    attemptContinuousHydration?(fiber: Fiber): void;
    attemptHydrationAtCurrentPriority?(fiber: Fiber): void;
    attemptSynchronousHydration?(fiber: Fiber): void;
    batchedUpdates?(fn: (a: any) => any, a: any): any;
    createComponentSelector?(component: ElementType): Selector;
    createContainer?(
      containerInfo: Container,
      tag: RootTag,
      hydrationCallbacks: unknown,
      isStrictMode: boolean,
      concurrentUpdatesByDefaultOverride: boolean | null,
      identifierPrefix: string,
      onUncaughtError: OnUncaughtError,
      onCaughtError: OnCaughtError,
      onRecoverableError: OnRecoverableError,
      onDefaultTransitionIndicator: OnDefaultTransitionIndicator
    ): FiberRoot;
    createHasPseudoClassSelector?(selectors: Selector[]): Selector;
    createHydrationContainer?(
      initialChildren: ReactNode,
      callback: UpdateCallback | null | undefined,
      containerInfo: Container,
      tag: RootTag,
      hydrationCallbacks: unknown,
      isStrictMode: boolean,
      concurrentUpdatesByDefaultOverride: boolean | null,
      identifierPrefix: string,
      onUncaughtError: OnUncaughtError,
      onCaughtError: OnCaughtError,
      onRecoverableError: OnRecoverableError,
      onDefaultTransitionIndicator: OnDefaultTransitionIndicator,
      transitionCallbacks: unknown,
      formState: ReactFormState | null
    ): FiberRoot;
    createPortal?(children: ReactNode, containerInfo: Container, implementation: unknown, key?: unknown): ReactPortal;
    createRoleSelector?(role: string): Selector;
    createTestNameSelector?(id: string): Selector;
    createTextSelector?(text: string): Selector;
    defaultOnCaughtError?(error: Thrown): void;
    defaultOnRecoverableError?(error: Thrown): void;
    defaultOnUncaughtError?(error: Thrown): void;
    deferredUpdates?(fn: () => any): any;
    discreteUpdates?(fn: (a: any, b: any, c: any, d: any) => any, a: any, b: any, c: any, d: any): any;
    findAllNodes?(hostRoot: Instance, selectors: Selector[]): StateNode[];
    findBoundingRects?(hostRoot: Instance, selectors: Selector[]): BoundingRect[];
    findHostInstance?(component: ClassInstance): PublicInstance | null;
    findHostInstanceWithNoPortals?(fiber: Fiber): PublicInstance | null;
    findHostInstanceWithWarning?(component: ClassInstance, methodName?: string): PublicInstance | null;
    flushPassiveEffects?(): boolean;
    flushSyncFromReconciler?(fn?: (() => any) | null): any;
    flushSyncWork?(): boolean;
    focusWithin?(hostRoot: Instance, selectors: Selector[]): boolean;
    getFindAllNodesFailureDescription?(hostRoot: Instance, selectors: Selector[]): string | null;
    getPublicRootInstance?(container: FiberRoot): StateNode;
    injectIntoDevTools?(): boolean;
    isAlreadyRendering?(): boolean;
    observeVisibleRects?(hostRoot: Instance, selectors: Selector[], callback: ObserveVisibleRectsCallback, options?: IntersectionObserverOptionsLike): Disconnectable;
    shouldError?(fiber?: Fiber): boolean | null;
    shouldSuspend?(fiber?: Fiber): boolean;
    startHostTransition?(formFiber: Fiber, pendingState: TransitionStatus, action: ((formData: any) => unknown) | null, formData: any): void;
    updateContainer?(element: ReactNode, container: FiberRoot, parentComponent?: ClassInstance | null, callback?: UpdateCallback | null): Lane;
    updateContainerSync?(element: ReactNode, container: FiberRoot, parentComponent?: ClassInstance | null, callback?: UpdateCallback | null): Lane;
  }
}
