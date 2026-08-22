/* ==========================================================================
   <kf-lookbook>
   --------------------------------------------------------------------------
   Two interaction modes over the same image and pins.

   Hotspots (default)
     Each pin is a real <a href> to its product. This element intercepts the
     click to reveal a small product card instead — so with no JavaScript the
     pins are simply links, which is a perfectly good lookbook. That is also
     why `aria-expanded` is added here rather than in Liquid: a plain link that
     never expands anything should not claim it does.

     Not a modal. Focus is not trapped and the page is not locked; the card is
     the next thing in DOM order, so tabbing into it just works.

   Guided tour
     The stage pins and the image pans and zooms to each product as its step
     scrolls past. All this element does is write the active hotspot's
     coordinates and the zoom onto the frame as custom properties; the CSS
     turns those into a single `transform`, so the move between hotspots is one
     interpolated transition on one compositor-friendly property.

     Changing a custom property that a transitioned property reads through
     var() does start a transition — verified, along with the interpolation
     itself. Writing `transform-origin` instead would need that property added
     to the transition list, and it does not run on the compositor.

     Still not scroll-jacking: the page scrolls at its own speed, `position:
     sticky` does the pinning, and this element only marks which step is
     active.

   The tour never runs when motion is not allowed. The zoom is exactly the kind
   of movement that causes vestibular discomfort, so under reduced motion the
   steps still advance but the image stays put.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFLookbookElement extends HTMLElement {
    constructor() {
      super();
      this.activeStep = -1;
      this.onClick = this.onClick.bind(this);
      this.onKeydown = this.onKeydown.bind(this);
      this.onDocumentClick = this.onDocumentClick.bind(this);
    }

    connectedCallback() {
      this.hotspots = Array.prototype.slice.call(this.querySelectorAll('[data-kf-hotspot]'));
      this.frame = this.querySelector('[data-kf-lookbook-frame]');
      this.steps = Array.prototype.slice.call(this.querySelectorAll('[data-kf-tour-step]'));

      if (!this.hotspots.length) return;

      this.addEventListener('click', this.onClick);
      this.addEventListener('keydown', this.onKeydown);

      if (this.isTour) {
        this.startTour();
      } else {
        // Only now do the pins become disclosures; without this file they stay
        // plain links.
        this.hotspots.forEach(function (hotspot) {
          hotspot.setAttribute('aria-expanded', 'false');
        });
        document.addEventListener('click', this.onDocumentClick);
      }
    }

    disconnectedCallback() {
      this.removeEventListener('click', this.onClick);
      this.removeEventListener('keydown', this.onKeydown);
      document.removeEventListener('click', this.onDocumentClick);
      if (this.observer) this.observer.disconnect();
      if (this.releaseBlockSelect) this.releaseBlockSelect();
    }

    get isTour() {
      return this.dataset.mode === 'tour' && this.steps.length > 0 && Boolean(this.frame);
    }

    /* ============================================================== Tour */

    startTour() {
      var self = this;

      this.observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var index = self.steps.indexOf(entry.target);
            if (index > -1) self.setStep(index);
          });
        },
        // A thin band across the middle of the viewport, so a product becomes
        // current as it is read rather than as it appears.
        { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
      );

      this.steps.forEach(function (step) {
        self.observer.observe(step);
      });

      this.setStep(0);

      // Theme Editor: selecting a hotspot should frame it, otherwise a
      // merchant positioning pin 3 is looking at pin 1.
      this.releaseBlockSelect = KF.onBlockSelect(function (block) {
        if (!self.contains(block)) return;
        var index = self.hotspots.indexOf(block.querySelector('[data-kf-hotspot]'));
        if (index > -1) self.setStep(index);
      });
    }

    setStep(index) {
      if (index === this.activeStep) return;
      this.activeStep = index;

      var step = this.steps[index];
      if (!step) return;

      if (KF.motionAllowed()) {
        // Unitless fractions, not the percentages the pins are placed with —
        // the CSS multiplies them by the zoom. Leaving these unset is what
        // makes the frame collapse to an identity transform, which is exactly
        // what should happen when motion is not allowed.
        this.frame.style.setProperty('--kf-tour-x', step.dataset.x || '0.5');
        this.frame.style.setProperty('--kf-tour-y', step.dataset.y || '0.5');
        this.frame.style.setProperty('--kf-tour-zoom', this.dataset.zoom || '1');
      }

      this.steps.forEach(function (node, i) {
        node.toggleAttribute('data-active', i === index);
      });

      this.hotspots.forEach(function (hotspot, i) {
        var wrap = hotspot.closest('.kf-lookbook__hotspot');
        if (wrap) wrap.toggleAttribute('data-active', i === index);
      });
    }

    /* ========================================================== Hotspots */

    panelFor(hotspot) {
      var id = hotspot.getAttribute('aria-controls');
      return id ? this.querySelector('#' + CSS.escape(id)) : null;
    }

    onClick(event) {
      if (!(event.target instanceof Element)) return;

      var hotspot = event.target.closest('[data-kf-hotspot]');
      if (!hotspot || !this.contains(hotspot)) return;

      var panel = this.panelFor(hotspot);
      // In tour mode there is no panel — let the link do its job.
      if (!panel) return;

      event.preventDefault();

      var isOpen = hotspot.getAttribute('aria-expanded') === 'true';
      this.closeAll();
      if (!isOpen) this.open(hotspot, panel);
    }

    onKeydown(event) {
      if (event.key !== 'Escape') return;

      var open = this.querySelector('[data-kf-hotspot][aria-expanded="true"]');
      if (!open) return;

      event.stopPropagation();
      this.closeAll();
      open.focus();
    }

    onDocumentClick(event) {
      if (!(event.target instanceof Element)) return;
      if (this.contains(event.target)) return;
      this.closeAll();
    }

    open(hotspot, panel) {
      hotspot.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
      hotspot.closest('.kf-lookbook__hotspot').setAttribute('data-open', '');
    }

    closeAll() {
      var self = this;
      this.hotspots.forEach(function (hotspot) {
        if (hotspot.hasAttribute('aria-expanded')) {
          hotspot.setAttribute('aria-expanded', 'false');
        }
        var panel = self.panelFor(hotspot);
        if (panel) panel.hidden = true;
        var wrap = hotspot.closest('.kf-lookbook__hotspot');
        if (wrap) wrap.removeAttribute('data-open');
      });
    }
  }

  KF.define('kf-lookbook', KFLookbookElement);
})();
