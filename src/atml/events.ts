// Serialized into the page's main world by Context.addInitScript. Keep this
// function self-contained: the ATML extractor runs in a separate utility world.
export function installAtmlEventTracking() {
  const prototype = EventTarget.prototype;
  const installed = Symbol.for('browser.atml.events');
  if (Object.prototype.hasOwnProperty.call(prototype, installed)) return;
  Object.defineProperty(prototype, installed, { value: true });

  const add = prototype.addEventListener;
  const remove = prototype.removeEventListener;
  const getAttribute = Element.prototype.getAttribute;
  const setAttribute = Element.prototype.setAttribute;
  const removeAttribute = Element.prototype.removeAttribute;
  const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
  const interactive = new Set('click dblclick mousedown mouseup pointerdown pointerup touchstart touchend keydown keyup keypress input change submit focus blur'.split(' '));
  const marker = 'data-browser-atml-listeners';
  type Registration = {
    type: string; listener: EventListenerOrEventListenerObject; capture: boolean;
    wrapper: EventListener; signal?: AbortSignal | null; abort?: EventListener;
  };
  const registrations = new WeakMap<Element, Registration[]>();

  const sync = (element: Element) => {
    // Bookkeeping must never prevent registration, removal or event delivery.
    try {
      const types = [...new Set((registrations.get(element) || []).map(entry => entry.type))].join(',');
      if (types) {
        if (getAttribute.call(element, marker) !== types) setAttribute.call(element, marker, types);
      } else if (getAttribute.call(element, marker) !== null) {
        removeAttribute.call(element, marker);
      }
    } catch {}
  };
  const forget = (element: Element, entry: Registration) => {
    const entries = registrations.get(element);
    const index = entries?.indexOf(entry) ?? -1;
    if (index < 0) return;
    entries!.splice(index, 1);
    if (!entries!.length) registrations.delete(element);
    if (entry.signal && entry.abort) remove.call(entry.signal, 'abort', entry.abort);
    sync(element);
  };
  const prune = (element: Element) => {
    for (const entry of [...(registrations.get(element) || [])]) {
      if (entry.signal && aborted.call(entry.signal)) forget(element, entry);
    }
  };
  // Match Web IDL's dictionary/boolean union conversion. Read each member once,
  // in native order; passing the original options again would repeat getters.
  const dictionary = (options: unknown): options is AddEventListenerOptions =>
    options !== null && (typeof options === 'object' || typeof options === 'function');

  prototype.addEventListener = function addEventListener(type, listener, options = undefined) {
    if (!(this instanceof Element) || listener === null || listener === undefined ||
        (typeof listener !== 'function' && typeof listener !== 'object'))
      return add.apply(this, arguments as any);
    // Template interpolation implements DOMString conversion, including throwing
    // on Symbols (String(symbol) would incorrectly succeed).
    type = `${type}`;
    if (!interactive.has(type)) return add.call(this, type, listener, options);
    const normalized: AddEventListenerOptions = {};
    if (dictionary(options)) {
      normalized.capture = !!options.capture;
      normalized.once = !!options.once;
      const passive = options.passive;
      if (passive !== undefined) normalized.passive = !!passive;
      const signal = options.signal;
      if (signal !== undefined) normalized.signal = signal;
    } else {
      normalized.capture = !!options;
    }
    prune(this);
    const existing = registrations.get(this)?.find(entry =>
      entry.type === type && entry.listener === listener && entry.capture === normalized.capture);
    if (existing) {
      // Let the engine validate options and apply its duplicate-registration
      // semantics. In particular, the first once/passive/signal options win.
      return add.call(this, type, existing.wrapper, normalized);
    }
    const entry: Registration = {
      type, listener, capture: !!normalized.capture, signal: normalized.signal,
      wrapper: function(this: Element, event: Event) {
        // Native once removes before invocation, including recursive dispatch,
        // thrown callbacks and callbacks that re-register themselves.
        if (normalized.once) forget(this, entry);
        if (typeof listener === 'function') return listener.call(this, event);
        return listener.handleEvent(event);
      },
    };
    // Validate and register natively before publishing any metadata. This also
    // retains native passive handling, ordering and stopImmediatePropagation.
    const result = add.call(this, type, entry.wrapper, normalized);
    if (entry.signal && aborted.call(entry.signal)) return result;
    const entries = registrations.get(this) || [];
    entries.push(entry);
    registrations.set(this, entries);
    if (entry.signal) {
      // Avoid retaining detached elements through a long-lived AbortSignal.
      const target = new WeakRef(this);
      const registration = new WeakRef(entry);
      entry.abort = () => {
        const element = target.deref(), current = registration.deref();
        if (element && current) forget(element, current);
      };
      add.call(entry.signal, 'abort', entry.abort, { once: true });
    }
    sync(this);
    return result;
  };

  prototype.removeEventListener = function removeEventListener(type, listener, options = undefined) {
    if (!(this instanceof Element) || listener === null || listener === undefined ||
        (typeof listener !== 'function' && typeof listener !== 'object'))
      return remove.apply(this, arguments as any);
    type = `${type}`;
    if (!interactive.has(type)) return remove.call(this, type, listener, options);
    const capture = dictionary(options) ? !!options.capture : !!options;
    prune(this);
    const entry = registrations.get(this)?.find(entry =>
      entry.type === type && entry.listener === listener && entry.capture === capture);
    const result = remove.call(this, type, entry?.wrapper || listener, capture);
    if (entry) forget(this, entry);
    return result;
  };

  // An earlier abort listener can stopImmediatePropagation, hiding the abort
  // notification from us even though the browser removed the actual listener.
  // Refresh synchronously from the utility-world extractor, using a plain DOM
  // event (no cross-world object details, which Firefox disallows).
  add.call(window, '__browser_atml_refresh__', event => {
    const root = event.composedPath()[0];
    if (!(root instanceof Element)) return;
    const visit = (element: Element) => {
      prune(element);
      for (const child of Array.from(element.children)) visit(child);
      if (element.shadowRoot) {
        for (const child of Array.from(element.shadowRoot.children)) visit(child);
      }
    };
    visit(root);
  }, true);
}
