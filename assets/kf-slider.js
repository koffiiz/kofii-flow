/* ==========================================================================
   <kf-slider>
   --------------------------------------------------------------------------
   The generic carousel: featured collections today, testimonials and logo
   clouds later. Deliberately separate from <kf-product-gallery>, which is
   product media specific (zoom, lightbox, variant sync, video handling) and
   would collapse into a grab-bag if it also had to be the general slider.

   The track is a CSS scroll-snap container. Position is read from
   `scrollLeft` against cached slide offsets — NOT from an IntersectionObserver.

   That choice matters: with several slides on screen, an observer fires as
   each one crosses its threshold, so the derived index flickers between
   neighbours during a scroll and the active dot jitters. Scroll position is
   monotonic, so the nearest-snap-point index is stable, and it is the same
   number the progress pill already uses.

   Offsets are measured once and re-measured on resize, so scrolling itself
   costs no layout reads.

   Without JavaScript the track stays a swipeable, scrollable row — the arrows,
   dots and pill are the only things this element adds.

   No autoplay, on purpose: it needs a visible pause control to be accessible,
   and it moves content out from under people who are reading it.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFSliderElement extends HTMLElement {
    constructor() {
      super();
      this.index = 0;
      this.offsets = [];
      this.maxScroll = 0;
      this.step = 1;
      this.lastIndex = 0;

      this.onClick = this.onClick.bind(this);
      this.onKeydown = this.onKeydown.bind(this);
    }

    connectedCallback() {
      this.track = this.querySelector('[data-kf-slider-track]');
      this.slides = Array.prototype.slice.call(this.querySelectorAll('[data-kf-slider-slide]'));
      this.dots = Array.prototype.slice.call(this.querySelectorAll('[data-kf-slider-dot]'));
      this.progress = this.querySelector('[data-kf-slider-progress]');

      if (!this.track || this.slides.length === 0) return;

      this.onScroll = KF.raf(this.readScroll.bind(this));
      this.onResize = KF.debounce(this.measure.bind(this), 150);

      this.addEventListener('click', this.onClick);
      this.addEventListener('keydown', this.onKeydown);
      this.track.addEventListener('scroll', this.onScroll, { passive: true });

      if ('ResizeObserver' in window) {
        this.resizeObserver = new ResizeObserver(this.onResize);
        this.resizeObserver.observe(this.track);
      } else {
        window.addEventListener('resize', this.onResize, { passive: true });
      }

      this.measure();
    }

    disconnectedCallback() {
      this.removeEventListener('click', this.onClick);
      this.removeEventListener('keydown', this.onKeydown);
      if (this.track && this.onScroll) this.track.removeEventListener('scroll', this.onScroll);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      else window.removeEventListener('resize', this.onResize);
    }

    /* ----------------------------------------------------------- Measuring */

    /**
     * Caches everything scrolling needs, so the scroll handler is arithmetic
     * only. Re-run whenever the track resizes — images loading and font swaps
     * both change slide widths after first paint.
     */
    measure() {
      if (!this.slides.length) return;

      var origin = this.slides[0].offsetLeft;
      var self = this;

      this.offsets = this.slides.map(function (slide) {
        return slide.offsetLeft - origin;
      });

      this.maxScroll = Math.max(0, this.track.scrollWidth - this.track.clientWidth);

      // How many slides fit at once — the paging step for the arrows.
      var fits = 0;
      for (var i = 0; i < this.offsets.length; i++) {
        if (this.offsets[i] < this.track.clientWidth - 1) fits++;
        else break;
      }
      this.step = Math.max(1, fits);

      // The last slide that can sit at the start of the track. Derived from
      // real geometry, because `slides.length - step` disagrees with the
      // browser once gaps are involved, and the mismatch shows up as an active
      // dot hidden as unreachable.
      this.lastIndex = this.offsets.length - 1;
      for (var j = 0; j < this.offsets.length; j++) {
        if (this.offsets[j] >= this.maxScroll - 1) {
          this.lastIndex = j;
          break;
        }
      }

      this.readScroll();
      void self;
    }

    /* ------------------------------------------------------------ Position */

    /** Nearest snap point to the current scroll offset. Stable by construction. */
    readScroll() {
      if (!this.offsets.length) return;

      var pos = this.track.scrollLeft;
      var best = 0;
      var bestDistance = Infinity;

      for (var i = 0; i <= this.lastIndex; i++) {
        var distance = Math.abs(this.offsets[i] - pos);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }

      this.index = best;
      this.syncUi();
    }

    goTo(index) {
      var clamped = Math.min(Math.max(index, 0), this.lastIndex);
      this.track.scrollTo({
        left: this.offsets[clamped] || 0,
        behavior: KF.motionAllowed() ? 'smooth' : 'auto'
      });
    }

    /* --------------------------------------------------------------- Input */

    onClick(event) {
      if (!(event.target instanceof Element)) return;

      if (event.target.closest('[data-kf-slider-prev]')) {
        this.goTo(this.index - this.step);
        return;
      }

      if (event.target.closest('[data-kf-slider-next]')) {
        this.goTo(this.index + this.step);
        return;
      }

      var dot = event.target.closest('[data-kf-slider-dot]');
      if (dot) this.goTo(this.dots.indexOf(dot) * this.step);
    }

    onKeydown(event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (!event.target.closest('[data-kf-slider-track], [data-kf-slider-dot]')) return;

      event.preventDefault();
      this.goTo(this.index + (event.key === 'ArrowRight' ? 1 : -1));
    }

    /* ------------------------------------------------------------------ UI */

    syncUi() {
      var isStatic = this.maxScroll <= 1;
      this.toggleAttribute('data-static', isStatic);

      var prev = this.querySelector('[data-kf-slider-prev]');
      var next = this.querySelector('[data-kf-slider-next]');
      if (prev) prev.toggleAttribute('disabled', this.index <= 0);
      if (next) next.toggleAttribute('disabled', this.index >= this.lastIndex);

      // Dots represent PAGES, not slides. Liquid renders one per slide because
      // it cannot know how many fit; the surplus is hidden here.
      //
      // One dot per slide would mean 8 products at 4 across giving 5 dots for
      // 2 screenfuls, where the trailing ones step by a single card and show
      // almost the same thing. Pages are what a shopper actually perceives.
      var pages = Math.max(1, Math.ceil(this.slides.length / this.step));
      var current = this.index >= this.lastIndex
        ? pages - 1
        : Math.floor(this.index / this.step);

      this.dots.forEach(function (dot, index) {
        dot.hidden = index >= pages;

        var isActive = index === current;
        dot.setAttribute('aria-current', isActive ? 'true' : 'false');
        dot.tabIndex = isActive ? 0 : -1;
      });

      this.updateProgress();
    }

    /**
     * Sizes the pill thumb to the visible fraction of the track and positions
     * it by scroll progress. Both are custom properties, so CSS owns the
     * visual entirely.
     */
    updateProgress() {
      if (!this.progress) return;

      var fraction = this.track.clientWidth / this.track.scrollWidth;
      var position = this.maxScroll > 0 ? this.track.scrollLeft / this.maxScroll : 0;

      this.progress.style.setProperty('--kf-progress-size', (fraction * 100).toFixed(2) + '%');
      this.progress.style.setProperty('--kf-progress-pos', position.toFixed(4));
    }
  }

  KF.define('kf-slider', KFSliderElement);
})();
