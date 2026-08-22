/* ==========================================================================
   <kf-product-recommendations>
   --------------------------------------------------------------------------
   Shopify only populates the `recommendations` object for a request to the
   product recommendations route, so this cannot be rendered inline with the
   product page — the section has to fetch itself a second time. That is why
   this element exists at all, and it is the same shape as the cart's upsell.

   It stays EMPTY until the fetch succeeds. No skeleton, no heading, no
   reserved space: a store with no recommendations set up should show nothing
   rather than a permanently blank band with a title over it.

   On lazy loading and CLAUDE.md rule 2 — an IntersectionObserver here is not
   an animation. Rule 2 is about keeping motion inside Kofii Motion; this is
   deferring a network request until it is nearly needed, on the highest
   traffic page in the store, so it does not compete with the product image
   for bandwidth during load.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFProductRecommendationsElement extends HTMLElement {
    connectedCallback() {
      this.url = this.dataset.url;
      if (!this.url) return;

      // A section re-render in the Theme Editor gives a fresh element, but a
      // plain reconnect must not fire a second request.
      if (this.dataset.loaded === 'true') return;

      var self = this;

      if (!('IntersectionObserver' in window)) {
        this.load();
        return;
      }

      this.observer = new IntersectionObserver(
        function (entries) {
          if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
          self.stopObserving();
          self.load();
        },
        // Start early enough that the row is usually populated by the time it
        // is scrolled to, without pulling it during the initial page load.
        { rootMargin: '0px 0px 600px 0px', threshold: 0 }
      );

      this.observer.observe(this);
    }

    disconnectedCallback() {
      this.stopObserving();
      if (this.controller) this.controller.abort();
    }

    stopObserving() {
      if (!this.observer) return;
      this.observer.disconnect();
      this.observer = null;
    }

    load() {
      var self = this;
      this.controller = new AbortController();

      KF.fetchSection(this.url, this.controller.signal)
        .then(function (doc) {
          var incoming = doc.querySelector('[data-kf-recs-content]');
          // No element means Shopify returned no recommendations — which is a
          // normal outcome, not a failure, and the right response is silence.
          if (!incoming) return;

          self.innerHTML = incoming.outerHTML;
          self.dataset.loaded = 'true';

          // The cards arrive after the motion engine's initial pass, so they
          // would keep their hidden state forever without this. Quick add and
          // the card itself are custom elements and upgrade on their own.
          if (KF.motion && typeof KF.motion.scan === 'function') KF.motion.scan(self);
        })
        .catch(function () {
          /* An upsell that fails to load is not worth telling anyone about. */
        });
    }
  }

  KF.define('kf-product-recommendations', KFProductRecommendationsElement);
})();
