/* ==========================================================================
   <kf-header> — sticky, reveal and transparent header behaviour
   --------------------------------------------------------------------------
   Owns three things and nothing else:

     1. Publishing the header height as --kf-header-height / --kf-sticky-offset
        so heroes, sticky columns and scroll-margin can account for it.
     2. Sticky modes: none | always | reveal (hide on scroll down, show on up).
     3. Toggling `is-scrolled`, which the transparent header uses to become
        solid. Hover and focus states are handled in CSS, not here.

   Attributes:
     data-sticky="none|always|reveal"
     data-transparent="true"
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  var SCROLL_THRESHOLD = 8;
  var REVEAL_THRESHOLD = 120;

  class KFHeaderElement extends HTMLElement {
    constructor() {
      super();
      this.lastY = 0;
      this.hidden_ = false;
      this.onScroll = KF.raf(this.update.bind(this));
      this.measure = this.measure.bind(this);
    }

    connectedCallback() {
      this.inner = this.querySelector('.kf-header__inner') || this;
      this.lastY = window.scrollY;

      this.applyHostState();
      this.measure();
      this.update();

      window.addEventListener('scroll', this.onScroll, { passive: true });

      if ('ResizeObserver' in window) {
        this.resizeObserver = new ResizeObserver(KF.debounce(this.measure, 100));
        this.resizeObserver.observe(this);
      } else {
        window.addEventListener('resize', KF.debounce(this.measure, 150), { passive: true });
      }
    }

    disconnectedCallback() {
      window.removeEventListener('scroll', this.onScroll);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      document.documentElement.style.removeProperty('--kf-sticky-offset');

      var host = this.parentElement;
      if (host) {
        host.classList.remove('kf-header-host--sticky', 'kf-header-host--transparent');
      }
    }

    get stickyMode() {
      return this.dataset.sticky || 'none';
    }

    get isTransparent() {
      return this.dataset.transparent === 'true';
    }

    /**
     * Sticky and transparent positioning must sit on the Shopify section
     * wrapper, not on this element: a sticky child is clamped by its parent
     * box, and that parent is exactly the header's height, so it could never
     * move. Marking the wrapper is also what lets a transparent header leave
     * the flow entirely.
     */
    applyHostState() {
      var host = this.parentElement;
      if (!host) return;
      host.classList.toggle('kf-header-host--sticky', this.stickyMode !== 'none');
      host.classList.toggle('kf-header-host--transparent', this.isTransparent);
    }

    measure() {
      var height = Math.round(this.getBoundingClientRect().height);
      if (!height) return;

      var root = document.documentElement;
      root.style.setProperty('--kf-header-height', height + 'px');
      root.style.setProperty(
        '--kf-sticky-offset',
        this.stickyMode === 'none' ? '0px' : height + 'px'
      );
    }

    update() {
      var y = window.scrollY;

      this.classList.toggle('is-scrolled', y > SCROLL_THRESHOLD);

      if (this.stickyMode !== 'reveal') {
        this.lastY = y;
        return;
      }

      // Never hide while something inside the header has focus or a menu is
      // open — that would move the target out from under a keyboard user.
      if (this.contains(document.activeElement) && document.activeElement !== document.body) {
        this.setHidden(false);
        this.lastY = y;
        return;
      }

      var goingDown = y > this.lastY;
      var pastThreshold = y > REVEAL_THRESHOLD;

      if (goingDown && pastThreshold) {
        this.setHidden(true);
      } else if (!goingDown) {
        this.setHidden(false);
      }

      this.lastY = y;
    }

    setHidden(shouldHide) {
      if (this.hidden_ === shouldHide) return;
      this.hidden_ = shouldHide;
      this.classList.toggle('is-hidden', shouldHide);
    }
  }

  KF.define('kf-header', KFHeaderElement);
})();
