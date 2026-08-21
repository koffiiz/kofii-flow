/* ==========================================================================
   <kf-sticky-atc>
   --------------------------------------------------------------------------
   Reveals a compact add-to-cart bar once the real buy buttons scroll out of
   view, and hides it again when they come back.

   It contains no form of its own. Its button uses the HTML `form` attribute to
   submit the main product form, so there is exactly one form, one variant
   input and one add-to-cart code path on the page — nothing to keep in sync.

   Hidden entirely from assistive technology while off screen (`inert`), so it
   never adds a duplicate "Add to cart" to the tab order.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFStickyAtcElement extends HTMLElement {
    connectedCallback() {
      var targetId = this.dataset.watch;
      this.target = targetId ? document.getElementById(targetId) : null;

      if (!this.target || !('IntersectionObserver' in window)) {
        // With nothing to watch, the bar would either never show or never
        // hide. Staying hidden is the safe failure.
        this.setVisible(false);
        return;
      }

      var self = this;
      this.observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            // Only reveal below the buy buttons, never above them.
            var scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < 0;
            self.setVisible(scrolledPast);
          });
        },
        { threshold: 0 }
      );

      this.observer.observe(this.target);
      this.setVisible(false);
    }

    disconnectedCallback() {
      if (this.observer) this.observer.disconnect();
    }

    setVisible(visible) {
      this.toggleAttribute('data-visible', visible);
      this.toggleAttribute('inert', !visible);
    }
  }

  KF.define('kf-sticky-atc', KFStickyAtcElement);
})();
