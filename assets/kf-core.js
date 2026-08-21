/* ==========================================================================
   Kofii Flow — Core runtime
   --------------------------------------------------------------------------
   The only script loaded on every page. Everything else is a Custom Element
   in its own file, requested by the section that needs it.

   Provides:
     KF.define()        guarded custom element registration
     KF.on/off/emit     document-level event bus
     KF.ready()         DOM-ready helper
     KF.onSectionLoad() Shopify Theme Editor lifecycle
     KF.trapFocus()     accessible focus containment
     KF.lockScroll()    reference-counted scroll lock (iOS safe)
     KF.announce()      polite screen reader announcements
     KF.raf/debounce    scheduling helpers

   Deliberately global-light: one `KF` object, nothing else on window.
   ========================================================================== */

(function () {
  'use strict';

  if (window.KF) return;

  var FOCUSABLE = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'iframe',
    'object',
    'embed',
    'summary',
    'audio[controls]',
    'video[controls]',
    '[contenteditable]:not([contenteditable="false"])',
    '[tabindex]:not([tabindex^="-"])'
  ].join(',');

  var KF = {
    version: '0.1.0',
    isEditor: Boolean(window.Shopify && window.Shopify.designMode)
  };

  /* ---------------------------------------------------------- Custom elements */

  /**
   * Registers a custom element once. Section files are loaded per section, so
   * the same script tag can appear several times on a page; this makes that
   * harmless instead of throwing.
   */
  KF.define = function (tagName, constructor) {
    if (!('customElements' in window)) return false;
    if (customElements.get(tagName)) return false;
    customElements.define(tagName, constructor);
    return true;
  };

  /* ------------------------------------------------------------------- Events */

  KF.on = function (name, handler, options) {
    document.addEventListener(name, handler, options);
    return function () {
      document.removeEventListener(name, handler, options);
    };
  };

  KF.off = function (name, handler, options) {
    document.removeEventListener(name, handler, options);
  };

  KF.emit = function (name, detail, target) {
    (target || document).dispatchEvent(
      new CustomEvent(name, { detail: detail || {}, bubbles: true, cancelable: true })
    );
  };

  /** Theme-wide event names. Components communicate through these, not imports. */
  KF.events = {
    cartUpdate: 'kf:cart:update',
    cartError: 'kf:cart:error',
    drawerOpen: 'kf:drawer:open',
    drawerClose: 'kf:drawer:close',
    variantChange: 'kf:variant:change',
    motionReady: 'kf:motion:ready'
  };

  /* -------------------------------------------------------------------- Ready */

  KF.ready = function (fn) {
    if (document.readyState !== 'loading') {
      fn();
    } else {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    }
  };

  /* --------------------------------------------------- Theme Editor lifecycle */

  /**
   * Runs `fn(sectionElement, event)` for every section that Shopify re-renders
   * in the Theme Editor. Custom elements re-run connectedCallback on their own,
   * so this is only needed for page-level work (re-scanning for animations,
   * re-measuring the header, and so on).
   */
  KF.onSectionLoad = function (fn) {
    return KF.on('shopify:section:load', function (event) {
      fn(event.target, event);
    });
  };

  KF.onSectionUnload = function (fn) {
    return KF.on('shopify:section:unload', function (event) {
      fn(event.target, event);
    });
  };

  KF.onSectionSelect = function (fn) {
    return KF.on('shopify:section:select', function (event) {
      fn(event.target, event);
    });
  };

  KF.onBlockSelect = function (fn) {
    return KF.on('shopify:block:select', function (event) {
      fn(event.target, event);
    });
  };

  KF.onBlockDeselect = function (fn) {
    return KF.on('shopify:block:deselect', function (event) {
      fn(event.target, event);
    });
  };

  /* ------------------------------------------------------------------ Motion */

  KF.prefersReducedMotion = function () {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  KF.flowMode = function () {
    return document.documentElement.dataset.kfFlow || 'balanced';
  };

  KF.motionAllowed = function () {
    return !KF.prefersReducedMotion() && KF.flowMode() !== 'off';
  };

  /* -------------------------------------------------------------- Scheduling */

  KF.raf = function (fn) {
    var scheduled = false;
    var lastArgs;
    return function () {
      lastArgs = arguments;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        fn.apply(null, lastArgs);
      });
    };
  };

  KF.debounce = function (fn, wait) {
    var timer;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(self, args);
      }, wait || 150);
    };
  };

  /* -------------------------------------------------------------- Focusable */

  KF.focusableSelector = FOCUSABLE;

  KF.getFocusable = function (root) {
    return Array.prototype.filter.call(
      root.querySelectorAll(FOCUSABLE),
      function (el) {
        return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
      }
    );
  };

  /**
   * Contains Tab focus inside `container` and restores focus on release.
   * Returns a release function — always call it when the surface closes.
   */
  KF.trapFocus = function (container, options) {
    var opts = options || {};
    var previous = opts.returnFocusTo || document.activeElement;

    function onKeydown(event) {
      if (event.key !== 'Tab') return;

      var focusable = KF.getFocusable(container);
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }

      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    container.addEventListener('keydown', onKeydown);

    var target = opts.initialFocus || KF.getFocusable(container)[0] || container;
    // Wait a frame so the surface is visible before focus moves into it,
    // otherwise the browser refuses to focus a hidden element.
    requestAnimationFrame(function () {
      if (target && typeof target.focus === 'function') {
        target.focus({ preventScroll: true });
      }
    });

    return function release() {
      container.removeEventListener('keydown', onKeydown);
      if (opts.restoreFocus === false) return;
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  };

  /* ------------------------------------------------------------ Scroll lock */

  var scrollLocks = 0;
  var savedScrollY = 0;

  KF.lockScroll = function () {
    scrollLocks += 1;
    if (scrollLocks > 1) return;

    savedScrollY = window.scrollY;
    var body = document.body;
    // Compensate for the scrollbar so the page does not shift horizontally.
    var scrollbar = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbar > 0) body.style.paddingRight = scrollbar + 'px';
    body.style.top = -savedScrollY + 'px';
    body.style.position = 'fixed';
    body.style.width = '100%';
    body.classList.add('kf-no-scroll');
  };

  KF.unlockScroll = function () {
    if (scrollLocks === 0) return;
    scrollLocks -= 1;
    if (scrollLocks > 0) return;

    var body = document.body;
    body.classList.remove('kf-no-scroll');
    body.style.position = '';
    body.style.top = '';
    body.style.width = '';
    body.style.paddingRight = '';
    window.scrollTo(0, savedScrollY);
  };

  /* ------------------------------------------------------------- Announcements */

  var liveRegion = null;

  KF.announce = function (message, assertive) {
    if (!liveRegion) {
      liveRegion = document.createElement('div');
      liveRegion.className = 'kf-visually-hidden';
      liveRegion.setAttribute('role', 'status');
      liveRegion.setAttribute('aria-live', 'polite');
      document.body.appendChild(liveRegion);
    }
    liveRegion.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    // Clearing first guarantees repeated identical messages are announced.
    liveRegion.textContent = '';
    window.setTimeout(function () {
      liveRegion.textContent = message;
    }, 60);
  };

  /* -------------------------------------------------------------------- Fetch */

  /**
   * Fetches a rendered section and returns its HTML as a DocumentFragment.
   * Used by predictive search now, and by filtering and the cart drawer later.
   */
  KF.fetchSection = function (url, signal) {
    return fetch(url, { signal: signal, headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (response) {
        if (!response.ok) throw new Error('Request failed: ' + response.status);
        return response.text();
      })
      .then(function (html) {
        return new DOMParser().parseFromString(html, 'text/html');
      });
  };

  /* ---------------------------------------------------------------- Utilities */

  KF.parseNumber = function (value, fallback) {
    var parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
  };

  KF.matches = function (query) {
    return window.matchMedia(query).matches;
  };

  KF.isDesktop = function () {
    return KF.matches('(min-width: 990px)');
  };

  /* ------------------------------------------------------------ Auto submit */

  /**
   * `[data-kf-auto-submit]` submits its owning form on change. Used by the
   * country and language selectors, which must still work without JavaScript —
   * their submit button is hidden by CSS only when `.kf-js` is present.
   */
  document.addEventListener('change', function (event) {
    if (!(event.target instanceof Element)) return;
    var control = event.target.closest('[data-kf-auto-submit]');
    if (!control || !control.form) return;
    control.form.requestSubmit ? control.form.requestSubmit() : control.form.submit();
  });

  window.KF = KF;
})();
