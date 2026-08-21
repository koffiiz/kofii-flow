/* ==========================================================================
   <kf-product-gallery>
   --------------------------------------------------------------------------
   Product media viewer: thumbnails, keyboard navigation, video handling,
   pointer-tracked zoom and a lightbox.

   Design decisions worth knowing before editing:

   - The viewer is a CSS scroll-snap track in every layout, on every screen
     size. Selection is *observed* from scroll position rather than driven by
     transforms, so native touch swipe, trackpad scroll, keyboard and the
     thumbnails all end up in the same state with no competing animation.
   - The lightbox is a native <dialog>. showModal() gives a focus trap, Escape
     handling and background inertness for free — correct by construction
     instead of re-implemented here.
   - Variant changes arrive as `kf:variant:change`; the gallery listens rather
     than being called, so the variant picker knows nothing about it.

   Without JavaScript the track is still a scrollable, swipeable list of every
   product image.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFProductGalleryElement extends HTMLElement {
    constructor() {
      super();
      this.index = 0;
      this.onClick = this.onClick.bind(this);
      this.onKeydown = this.onKeydown.bind(this);
      this.onVariantChange = this.onVariantChange.bind(this);
      this.onPointerMove = this.onPointerMove.bind(this);
      this.onPointerLeave = this.onPointerLeave.bind(this);
    }

    connectedCallback() {
      this.viewer = this.querySelector('[data-kf-gallery-viewer]');
      this.slides = Array.prototype.slice.call(this.querySelectorAll('[data-kf-gallery-slide]'));
      this.thumbs = Array.prototype.slice.call(this.querySelectorAll('[data-kf-gallery-thumb]'));
      this.counter = this.querySelector('[data-kf-gallery-counter]');
      this.lightbox = this.querySelector('[data-kf-gallery-lightbox]');

      if (!this.viewer || this.slides.length === 0) return;

      this.addEventListener('click', this.onClick);
      this.addEventListener('keydown', this.onKeydown);
      this.releaseVariant = KF.on(KF.events.variantChange, this.onVariantChange);

      this.observeSlides();
      this.setupZoom();
      this.select(0, false);
    }

    disconnectedCallback() {
      this.removeEventListener('click', this.onClick);
      this.removeEventListener('keydown', this.onKeydown);
      if (this.releaseVariant) this.releaseVariant();
      if (this.slideObserver) this.slideObserver.disconnect();
    }

    get zoomMode() {
      return this.dataset.zoom || 'none';
    }

    /* ------------------------------------------------------------ Selection */

    /**
     * Watches the scroll track and reports whichever slide is most visible.
     * This is the single source of truth for `index` — every input path
     * (swipe, thumb, arrow key) works by scrolling, then this reacts.
     */
    observeSlides() {
      var self = this;

      this.slideObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) {
              self.pauseMedia(entry.target);
              return;
            }
            var index = self.slides.indexOf(entry.target);
            if (index > -1 && index !== self.index) {
              self.index = index;
              self.syncUi();
            }
          });
        },
        { root: this.viewer, threshold: 0.6 }
      );

      this.slides.forEach(function (slide) {
        self.slideObserver.observe(slide);
      });
    }

    select(index, animate) {
      var clamped = Math.min(Math.max(index, 0), this.slides.length - 1);
      var slide = this.slides[clamped];
      if (!slide) return;

      this.index = clamped;

      if (this.viewer.scrollWidth > this.viewer.clientWidth) {
        this.viewer.scrollTo({
          left: slide.offsetLeft - this.viewer.offsetLeft,
          behavior: animate === false || !KF.motionAllowed() ? 'auto' : 'smooth'
        });
      } else {
        // Stacked layout: the track does not scroll horizontally.
        slide.scrollIntoView({
          block: 'nearest',
          behavior: animate === false || !KF.motionAllowed() ? 'auto' : 'smooth'
        });
      }

      this.syncUi();
    }

    selectByMediaId(mediaId) {
      var index = this.slides.findIndex(function (slide) {
        return slide.dataset.mediaId === String(mediaId);
      });
      if (index > -1) this.select(index);
    }

    syncUi() {
      var self = this;

      this.thumbs.forEach(function (thumb, index) {
        var isActive = index === self.index;
        thumb.setAttribute('aria-current', isActive ? 'true' : 'false');
        // Roving tabindex: one stop for the whole thumbnail strip.
        thumb.tabIndex = isActive ? 0 : -1;
      });

      if (this.counter) {
        this.counter.textContent = this.index + 1 + ' / ' + this.slides.length;
      }

      var prev = this.querySelector('[data-kf-gallery-prev]');
      var next = this.querySelector('[data-kf-gallery-next]');
      if (prev) prev.toggleAttribute('disabled', this.index === 0);
      if (next) next.toggleAttribute('disabled', this.index === this.slides.length - 1);
    }

    pauseMedia(slide) {
      var video = slide.querySelector('video');
      if (video && !video.paused) video.pause();
    }

    /* --------------------------------------------------------------- Input */

    onClick(event) {
      if (!(event.target instanceof Element)) return;

      var thumb = event.target.closest('[data-kf-gallery-thumb]');
      if (thumb) {
        event.preventDefault();
        this.select(this.thumbs.indexOf(thumb));
        return;
      }

      if (event.target.closest('[data-kf-gallery-prev]')) {
        this.select(this.index - 1);
        return;
      }

      if (event.target.closest('[data-kf-gallery-next]')) {
        this.select(this.index + 1);
        return;
      }

      if (event.target.closest('[data-kf-lightbox-close]')) {
        this.closeLightbox();
        return;
      }

      if (this.zoomMode === 'lightbox' && event.target.closest('[data-kf-gallery-zoom]')) {
        this.openLightbox();
      }
    }

    onKeydown(event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (!event.target.closest('[data-kf-gallery-thumb], [data-kf-gallery-viewer]')) return;

      event.preventDefault();
      var next = event.key === 'ArrowRight' ? this.index + 1 : this.index - 1;
      this.select(next);

      var thumb = this.thumbs[this.index];
      if (thumb) thumb.focus();
    }

    onVariantChange(event) {
      var variant = event.detail.variant;
      if (!variant || !variant.featured_media_id) return;
      this.selectByMediaId(variant.featured_media_id);
    }

    /* ---------------------------------------------------------------- Zoom */

    setupZoom() {
      if (this.zoomMode !== 'hover') return;
      if (!window.matchMedia('(hover: hover)').matches) return;

      this.addEventListener('pointermove', this.onPointerMove);
      this.addEventListener('pointerleave', this.onPointerLeave);
    }

    onPointerMove(event) {
      var frame = event.target.closest('[data-kf-gallery-zoom]');
      if (!frame) return;

      var rect = frame.getBoundingClientRect();
      var x = ((event.clientX - rect.left) / rect.width) * 100;
      var y = ((event.clientY - rect.top) / rect.height) * 100;

      frame.style.setProperty('--kf-zoom-x', x.toFixed(2) + '%');
      frame.style.setProperty('--kf-zoom-y', y.toFixed(2) + '%');
      frame.setAttribute('data-zooming', '');
    }

    onPointerLeave() {
      Array.prototype.forEach.call(
        this.querySelectorAll('[data-kf-gallery-zoom]'),
        function (frame) {
          frame.removeAttribute('data-zooming');
        }
      );
    }

    /* ------------------------------------------------------------ Lightbox */

    openLightbox() {
      if (!this.lightbox || typeof this.lightbox.showModal !== 'function') return;
      // Guard against a second open: lockScroll is reference counted, so a
      // double open would leave the page permanently unscrollable.
      if (this.lightbox.open) return;

      var target = this.lightbox.querySelectorAll('[data-kf-lightbox-slide]')[this.index];
      this.lightbox.showModal();
      KF.lockScroll();

      if (target) target.scrollIntoView({ block: 'center', behavior: 'auto' });

      var self = this;
      this.lightbox.addEventListener(
        'close',
        function () {
          KF.unlockScroll();
          var thumb = self.thumbs[self.index];
          if (thumb) thumb.focus({ preventScroll: true });
        },
        { once: true }
      );
    }

    closeLightbox() {
      if (this.lightbox && this.lightbox.open) this.lightbox.close();
    }
  }

  KF.define('kf-product-gallery', KFProductGalleryElement);
})();
