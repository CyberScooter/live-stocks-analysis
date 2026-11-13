import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Fixed locale: the app formats with the browser's locale, so pin it to en-US
// to get the same "$1,234.50" on every machine.
// ---------------------------------------------------------------------------
const RealNumberFormat = Intl.NumberFormat;
function NumberFormat(locale, options) {
  return new RealNumberFormat(locale ?? 'en-US', options);
}
NumberFormat.prototype = RealNumberFormat.prototype;
NumberFormat.supportedLocalesOf = RealNumberFormat.supportedLocalesOf;
Intl.NumberFormat = NumberFormat;

const numberToLocale = Number.prototype.toLocaleString;
// eslint-disable-next-line no-extend-native
Number.prototype.toLocaleString = function (locale, options) {
  return numberToLocale.call(this, locale ?? 'en-US', options);
};
for (const method of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
  const original = Date.prototype[method];
  // eslint-disable-next-line no-extend-native
  Date.prototype[method] = function (locale, options) {
    return original.call(this, locale ?? 'en-US', options);
  };
}

// ---------------------------------------------------------------------------
// localStorage: recent Node versions define their own `localStorage` global
// (undefined unless Node is started with a storage file), which hides jsdom's.
// Use a simple in-memory one so tests behave the same on every Node version.
// ---------------------------------------------------------------------------
class MemoryStorage {
  #items = new Map();
  get length() {
    return this.#items.size;
  }
  key(i) {
    return [...this.#items.keys()][i] ?? null;
  }
  getItem(k) {
    return this.#items.has(String(k)) ? this.#items.get(String(k)) : null;
  }
  setItem(k, v) {
    this.#items.set(String(k), String(v));
  }
  removeItem(k) {
    this.#items.delete(String(k));
  }
  clear() {
    this.#items.clear();
  }
}
const memoryStorage = new MemoryStorage();
for (const target of [globalThis, window]) {
  Object.defineProperty(target, 'localStorage', { value: memoryStorage, configurable: true, writable: true });
}

// ---------------------------------------------------------------------------
// Browser APIs jsdom doesn't have
// ---------------------------------------------------------------------------
// Blob/File.text() (used by Import and to inspect Export): real browsers have it, jsdom doesn't.
if (!Blob.prototype.text) {
  Blob.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = NoopObserver;
globalThis.IntersectionObserver = NoopObserver; // news images are never "scrolled into view"

/**
 * Stand-in for the live price stream (/api/stream). Tests push events with
 * `liveStream().emit('trades', [...])`.
 */
export class FakeEventSource {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type, data) {
    for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(data) });
  }
}
globalThis.EventSource = FakeEventSource;

/** The most recently opened (and still open) live stream, if any. */
export const liveStream = () => FakeEventSource.instances.filter((es) => !es.closed).at(-1);

afterEach(() => {
  cleanup();
  FakeEventSource.instances.length = 0;
  localStorage.clear();
  window.location.hash = '';
  vi.clearAllMocks();
});
