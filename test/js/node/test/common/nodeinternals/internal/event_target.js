'use strict';

// Bun adaptation of node's lib/internal/event_target.js. Not verbatim: node's
// file defines its own Event/EventTarget classes, but here `new Event(...)`
// in tests creates the runtime's native Event, so NodeEventTarget must be
// built on the native EventTarget for dispatchEvent() to accept it. The
// node-style listener bookkeeping (kEvents) is reimplemented on top of native
// add/removeEventListener; method semantics follow node v26.3.0.

const EventEmitter = require('events');
const {
  codes: {
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_THIS,
  },
} = require('internal/errors');
const { validateString } = require('internal/validators');

const {
  kMaxEventTargetListeners,
  kMaxEventTargetListenersWarned,
} = EventEmitter;

const kEvents = Symbol('kEvents');
const kIsNodeEventTarget = Symbol('kIsNodeEventTarget');
// emit() smuggles the raw node value through the dispatched CustomEvent so
// node-style listeners receive it instead of the event (kHybridDispatch).
const kNodeValue = Symbol('kNodeValue');

function isNodeEventTarget(obj) {
  return obj?.constructor?.[kIsNodeEventTarget];
}

function validateEventListener(listener) {
  if (typeof listener === 'function' ||
      typeof listener?.handleEvent === 'function') {
    return true;
  }
  if (listener == null) return false;
  throw new ERR_INVALID_ARG_TYPE('listener', 'EventListener', listener);
}

class NodeEventTarget extends EventTarget {
  static [kIsNodeEventTarget] = true;
  static defaultMaxListeners = 10;

  constructor() {
    super();
    this[kEvents] = new Map();
    this[kMaxEventTargetListeners] = EventEmitter.defaultMaxListeners;
    this[kMaxEventTargetListenersWarned] = false;
  }

  // node's EventTarget[kNewListener] max-listeners warning; node renders the
  // target as inspect(this, { depth: -1 }), which resolves to the constructor
  // name via its customInspect.
  #warnIfNeeded(type, size) {
    if (this[kMaxEventTargetListeners] > 0 &&
        size > this[kMaxEventTargetListeners] &&
        !this[kMaxEventTargetListenersWarned]) {
      this[kMaxEventTargetListenersWarned] = true;
      const w = new Error('Possible EventTarget memory leak detected. ' +
                          `${size} ${type} listeners ` +
                          `added to ${this.constructor.name}. MaxListeners is ` +
                          `${this[kMaxEventTargetListeners]}. Use ` +
                          'events.setMaxListeners() to increase limit');
      w.name = 'MaxListenersExceededWarning';
      w.target = this;
      w.type = type;
      w.count = size;
      process.emitWarning(w);
    }
  }

  #add(type, listener, { once = false, isNodeStyleListener = false } = {}) {
    if (!validateEventListener(listener)) return;
    type = String(type);
    let root = this[kEvents].get(type);
    if (root === undefined) {
      root = new Map();
      this[kEvents].set(type, root);
    }
    // Same (type, listener) dedupe as the spec'd EventTarget; the wrapper
    // below would otherwise defeat the native dedupe.
    if (root.has(listener)) return;

    const target = this;
    const isFunction = typeof listener === 'function';
    // handleEvent is bound at registration time, like node's Listener.
    const callback = isFunction ? listener : listener.handleEvent.bind(listener);
    function wrapper(event) {
      if (once) {
        root.delete(listener);
        if (root.size === 0) target[kEvents].delete(type);
      }
      const arg = isNodeStyleListener && (kNodeValue in event)
        ? event[kNodeValue]
        : event;
      // Native dispatch invokes `wrapper` with this === target; plain
      // function listeners keep that.
      return callback.call(isFunction ? this : listener, arg);
    }
    root.set(listener, { wrapper, once });
    super.addEventListener(type, wrapper, { once });
    this.#warnIfNeeded(type, root.size);
  }

  addEventListener(type, listener, options = {}) {
    if (typeof options === 'boolean') options = { capture: options };
    this.#add(type, listener, {
      once: Boolean(options?.once),
      isNodeStyleListener: false,
    });
  }

  removeEventListener(type, listener, _options = {}) {
    if (!validateEventListener(listener)) return;
    type = String(type);
    const root = this[kEvents].get(type);
    const record = root?.get(listener);
    if (record === undefined) return;
    root.delete(listener);
    if (root.size === 0) this[kEvents].delete(type);
    super.removeEventListener(type, record.wrapper);
  }

  setMaxListeners(n) {
    if (!isNodeEventTarget(this))
      throw new ERR_INVALID_THIS('NodeEventTarget');
    EventEmitter.setMaxListeners(n, this);
  }

  getMaxListeners() {
    if (!isNodeEventTarget(this))
      throw new ERR_INVALID_THIS('NodeEventTarget');
    return this[kMaxEventTargetListeners];
  }

  eventNames() {
    if (!isNodeEventTarget(this))
      throw new ERR_INVALID_THIS('NodeEventTarget');
    return Array.from(this[kEvents].keys());
  }

  listenerCount(type) {
    if (!isNodeEventTarget(this))
      throw new ERR_INVALID_THIS('NodeEventTarget');
    const root = this[kEvents].get(String(type));
    return root !== undefined ? root.size : 0;
  }

  off(type, listener, options) {
    if (!isNodeEventTarget(this))
      throw new ERR_INVALID_THIS('NodeEventTarget');
    this.removeEventListener(type, listener, options);
    return this;
  }

  removeListener(type, listener, options) {
    if (!isNodeEventTarget(this))
      throw new ERR_INVALID_THIS('NodeEventTarget');
    this.removeEventListener(type, listener, options);
    return this;
  }

  on(type, listener) {
    if (!isNodeEventTarget(this))
      throw new ERR_INVALID_THIS('NodeEventTarget');
    this.#add(type, listener, { isNodeStyleListener: true });
    return this;
  }

  addListener(type, listener) {
    if (!isNodeEventTarget(this))
      throw new ERR_INVALID_THIS('NodeEventTarget');
    this.#add(type, listener, { isNodeStyleListener: true });
    return this;
  }

  emit(type, arg) {
    if (!isNodeEventTarget(this))
      throw new ERR_INVALID_THIS('NodeEventTarget');
    validateString(type, 'type');
    const hadListeners = this.listenerCount(type) > 0;
    if (hadListeners) {
      const event = new CustomEvent(type, { detail: arg });
      event[kNodeValue] = arg;
      super.dispatchEvent(event);
    }
    return hadListeners;
  }

  once(type, listener) {
    if (!isNodeEventTarget(this))
      throw new ERR_INVALID_THIS('NodeEventTarget');
    this.#add(type, listener, { once: true, isNodeStyleListener: true });
    return this;
  }

  removeAllListeners(type) {
    if (!isNodeEventTarget(this))
      throw new ERR_INVALID_THIS('NodeEventTarget');
    if (type !== undefined) {
      type = String(type);
      const root = this[kEvents].get(type);
      if (root !== undefined) {
        for (const { wrapper } of root.values()) {
          super.removeEventListener(type, wrapper);
        }
        this[kEvents].delete(type);
      }
    } else {
      for (const [rootType, root] of this[kEvents]) {
        for (const { wrapper } of root.values()) {
          super.removeEventListener(rootType, wrapper);
        }
      }
      this[kEvents].clear();
    }
    return this;
  }
}

module.exports = {
  Event: globalThis.Event,
  CustomEvent: globalThis.CustomEvent,
  EventTarget: globalThis.EventTarget,
  NodeEventTarget,
  kEvents,
};
