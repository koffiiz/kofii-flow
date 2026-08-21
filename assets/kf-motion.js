/* ==========================================================================
   Kofii Motion — engine
   --------------------------------------------------------------------------
   The single animation system for Kofii Flow. Sections never ship their own
   scroll or parallax code; they emit data attributes and this file plays them.

   Markup contract
     data-kf-animate="fade-up"      preset name (see kf-motion.css)
     data-kf-duration="700"         ms, written to --kf-a-duration by Liquid
     data-kf-delay="150"            ms, written to --kf-a-delay by Liquid
     data-kf-trigger="scroll|load"  default: scroll
     data-kf-replay="once|always"   default: once
     data-kf-threshold="0.15"       intersection ratio
     data-kf-offset="10"            % of viewport to wait past the edge
     data-kf-stagger="80"           on a PARENT: play descendants in sequence
     data-kf-parallax="0.2"         parallax strength, 0 to 1

   What this file actually does: adds `data-kf-inview`. All visual state is CSS.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF || window.KF.motion) return;

  var KF = window.KF;
  var root = document.documentElement;

  var observed = new WeakSet();
  var parallaxItems = [];
  var activeParallax = new Set();

  var revealObserver = null;
  var parallaxObserver = null;
  var parallaxTicking = false;

  /* ------------------------------------------------------------------ Setup */

  function motionEnabled() {
    return KF.motionAllowed();
  }

  /**
   * Disables the engine and reveals everything. Called when motion is not
   * allowed, so nothing is ever left hidden behind an animation that will
   * never run.
   */
  function disable() {
    root.classList.remove('kf-motion');
    root.classList.add('kf-motion-ready');
    if (revealObserver) revealObserver.disconnect();
    if (parallaxObserver) {
      parallaxObserver.disconnect();
      parallaxObserver = null;
    }
    parallaxItems.forEach(function (item) {
      item.el.style.removeProperty('--kf-parallax-y');
    });
    parallaxItems = [];
    activeParallax.clear();

    // Forget every registration so a later re-enable (the visitor turning
    // reduced motion back off) can observe the same elements again.
    observed = new WeakSet();
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-kf-managed]'),
      function (el) {
        el.removeAttribute('data-kf-managed');
      }
    );
  }

  /* ---------------------------------------------------------------- Reveals */

  function play(el, delayOverride) {
    if (typeof delayOverride === 'number') {
      el.style.setProperty('--kf-a-delay', delayOverride + 'ms');
    }
    el.setAttribute('data-kf-inview', '');
  }

  function reset(el) {
    el.removeAttribute('data-kf-inview');
    el.removeAttribute('data-kf-settled');
  }

  /** Plays a stagger container and every animated descendant it owns. */
  function playGroup(container) {
    var step = KF.parseNumber(container.dataset.kfStagger, 80);
    var base = KF.parseNumber(container.dataset.kfDelay, 0);
    var items = container.querySelectorAll('[data-kf-animate][data-kf-managed]');

    if (container.hasAttribute('data-kf-animate')) play(container);

    Array.prototype.forEach.call(items, function (item, index) {
      play(item, base + index * step);
    });
  }

  function resetGroup(container) {
    if (container.hasAttribute('data-kf-animate')) reset(container);
    var items = container.querySelectorAll('[data-kf-animate][data-kf-managed]');
    Array.prototype.forEach.call(items, reset);
  }

  function onIntersect(entries) {
    entries.forEach(function (entry) {
      var el = entry.target;
      var isGroup = el.hasAttribute('data-kf-stagger');
      var replay = el.dataset.kfReplay === 'always';

      if (entry.isIntersecting) {
        if (isGroup) {
          playGroup(el);
        } else {
          play(el);
        }
        if (!replay) revealObserver.unobserve(el);
      } else if (replay) {
        // Only reset once the element has left through the bottom edge, so
        // scrolling back up does not re-hide content the visitor is reading.
        if (entry.boundingClientRect.top > 0) {
          if (isGroup) resetGroup(el); else reset(el);
        }
      }
    });
  }

  /**
   * clip-path is switched to `none` once the transition settles so shadows,
   * focus rings and hover lifts are not clipped by the reveal frame.
   */
  function onTransitionEnd(event) {
    var el = event.target;
    if (!(el instanceof Element)) return;
    if (!el.hasAttribute('data-kf-inview')) return;
    if (event.propertyName !== 'clip-path') return;
    el.setAttribute('data-kf-settled', '');
  }

  function observeReveal(el) {
    if (observed.has(el)) return;
    observed.add(el);

    if (el.dataset.kfTrigger === 'load') {
      // Two frames: one for the initial state to paint, one to transition from.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (el.hasAttribute('data-kf-stagger')) playGroup(el); else play(el);
        });
      });
      return;
    }

    var threshold = Math.min(Math.max(KF.parseNumber(el.dataset.kfThreshold, 0.15), 0), 1);
    var offset = KF.parseNumber(el.dataset.kfOffset, 8);

    // One observer per unique threshold/offset pair rather than one per
    // element: most of a page shares the same configuration.
    getObserver(threshold, offset).observe(el);
  }

  var observerPool = {};

  function getObserver(threshold, offset) {
    var key = threshold + '|' + offset;
    if (!observerPool[key]) {
      observerPool[key] = new IntersectionObserver(onIntersect, {
        threshold: threshold,
        rootMargin: '0px 0px -' + offset + '% 0px'
      });
    }
    return observerPool[key];
  }

  // Facade over the pool so callers do not need to know which observer holds
  // a given element.
  revealObserver = {
    unobserve: function (el) {
      Object.keys(observerPool).forEach(function (poolKey) {
        observerPool[poolKey].unobserve(el);
      });
    },
    disconnect: function () {
      Object.keys(observerPool).forEach(function (poolKey) {
        observerPool[poolKey].disconnect();
      });
      observerPool = {};
    }
  };

  /* --------------------------------------------------------------- Parallax */

  function measureParallax() {
    var viewport = window.innerHeight;

    activeParallax.forEach(function (item) {
      var rect = item.el.getBoundingClientRect();
      var center = rect.top + rect.height / 2;
      // -1 when the element is below the fold, +1 when it is above it.
      var progress = (viewport / 2 - center) / (viewport / 2 + rect.height / 2);
      var shift = progress * item.strength * item.range;
      item.el.style.setProperty('--kf-parallax-y', shift.toFixed(2) + 'px');
    });

    parallaxTicking = false;
  }

  function requestParallax() {
    if (parallaxTicking || activeParallax.size === 0) return;
    parallaxTicking = true;
    requestAnimationFrame(measureParallax);
  }

  function observeParallax(el) {
    if (observed.has(el)) return;
    observed.add(el);

    var item = {
      el: el,
      strength: Math.min(Math.max(KF.parseNumber(el.dataset.kfParallax, 0.2), 0), 1),
      range: KF.parseNumber(el.dataset.kfParallaxRange, 90)
    };

    parallaxItems.push(item);

    if (!parallaxObserver) {
      parallaxObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var match = parallaxItems.filter(function (candidate) {
            return candidate.el === entry.target;
          })[0];
          if (!match) return;
          if (entry.isIntersecting) {
            activeParallax.add(match);
          } else {
            activeParallax.delete(match);
          }
        });
        requestParallax();
      }, { rootMargin: '20% 0px 20% 0px' });
    }

    parallaxObserver.observe(el);
  }

  /* ------------------------------------------------------------------- Scan */

  /**
   * Registers everything inside `scope`. Safe to call repeatedly — already
   * registered elements are skipped, which is what makes Theme Editor section
   * re-renders cheap.
   */
  function scan(scope) {
    if (!motionEnabled()) return;
    var container = scope || document;

    // Stagger containers claim their descendants before anything else, so the
    // children play as a sequence instead of individually on scroll.
    var groups = container.querySelectorAll('[data-kf-stagger]');
    Array.prototype.forEach.call(groups, function (group) {
      var items = group.querySelectorAll('[data-kf-animate]');
      Array.prototype.forEach.call(items, function (item) {
        if (item === group) return;
        item.setAttribute('data-kf-managed', '');
        observed.add(item);
      });
      observeReveal(group);
    });

    var singles = container.querySelectorAll('[data-kf-animate]:not([data-kf-managed])');
    Array.prototype.forEach.call(singles, observeReveal);

    if (root.dataset.kfParallax !== 'off') {
      var parallax = container.querySelectorAll('[data-kf-parallax]');
      Array.prototype.forEach.call(parallax, observeParallax);
    }
  }

  /**
   * Forgets a subtree. Called when the Theme Editor removes a section so the
   * parallax list does not keep dead nodes alive.
   */
  function forget(scope) {
    parallaxItems = parallaxItems.filter(function (item) {
      if (scope.contains(item.el)) {
        activeParallax.delete(item);
        if (parallaxObserver) parallaxObserver.unobserve(item.el);
        return false;
      }
      return true;
    });
  }

  /* ------------------------------------------------------------------- Boot */

  var listenersBound = false;

  function boot() {
    if (!motionEnabled()) {
      disable();
      return;
    }

    root.classList.add('kf-motion', 'kf-motion-ready');

    // Bind once. boot() runs again if the visitor changes their reduced-motion
    // preference, and duplicate listeners would leak.
    if (!listenersBound) {
      listenersBound = true;
      document.addEventListener('transitionend', onTransitionEnd, true);
      window.addEventListener('scroll', requestParallax, { passive: true });
      window.addEventListener('resize', KF.debounce(requestParallax, 120), { passive: true });
    }

    scan(document);

    KF.emit(KF.events.motionReady);
  }

  /* Theme Editor: sections are replaced wholesale, so rescan the new markup. */
  KF.onSectionLoad(function (section) {
    scan(section);
  });

  KF.onSectionUnload(function (section) {
    forget(section);
  });

  /* Respond live if the visitor changes their reduced-motion preference. */
  var reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var onPreferenceChange = function () {
    if (motionEnabled()) {
      boot();
    } else {
      disable();
    }
  };

  if (typeof reduceQuery.addEventListener === 'function') {
    reduceQuery.addEventListener('change', onPreferenceChange);
  }

  KF.motion = {
    scan: scan,
    forget: forget,
    play: play,
    reset: reset,
    enabled: motionEnabled
  };

  KF.ready(boot);
})();
