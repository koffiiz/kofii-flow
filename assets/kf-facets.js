/* ==========================================================================
   <kf-facets>
   --------------------------------------------------------------------------
   Shopify native storefront filtering and sorting.

   The filter UI is a real <form> whose inputs are named after Shopify's own
   filter parameters (filter.v.option.color, filter.v.price.gte, sort_by).
   Submitting it normally produces a correctly filtered collection URL — so
   with JavaScript disabled the whole feature still works through page loads,
   and the Apply button is only hidden once `.kf-js` is present.

   With JavaScript, the same form is serialised, fetched through the Section
   Rendering API, and the results and filter regions are swapped. Filtering
   logic, counts and available values are always computed by Shopify. The
   theme never decides what matches a filter.

   Regions swapped on every update, marked `[data-kf-facet-region]`:
     results   the product grid and its pagination
     filters   the filter form itself (counts and availability change)
     count     the "N products" summary

   On small screens the same form — not a copy of it — becomes a slide-over
   panel, using KF.trapFocus and KF.lockScroll from the core runtime.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  var PRICE_DEBOUNCE = 500;

  class KFFacetsElement extends HTMLElement {
    constructor() {
      super();
      this.controller = null;
      this.releaseFocus = null;

      this.onChange = this.onChange.bind(this);
      this.onInput = this.onInput.bind(this);
      this.onSubmit = this.onSubmit.bind(this);
      this.onClick = this.onClick.bind(this);
      this.onPopState = this.onPopState.bind(this);
      this.onKeydown = this.onKeydown.bind(this);

      this.debouncedApply = KF.debounce(this.apply.bind(this), PRICE_DEBOUNCE);
    }

    connectedCallback() {
      this.sectionId = this.dataset.sectionId;
      this.panel = this.querySelector('[data-kf-facet-panel]');

      this.addEventListener('change', this.onChange);
      this.addEventListener('input', this.onInput);
      this.addEventListener('submit', this.onSubmit);
      this.addEventListener('click', this.onClick);
      this.addEventListener('keydown', this.onKeydown);
      window.addEventListener('popstate', this.onPopState);
    }

    disconnectedCallback() {
      window.removeEventListener('popstate', this.onPopState);
      this.abort();
      this.closePanel();
    }

    get form() {
      return this.querySelector('[data-kf-facet-form]');
    }

    abort() {
      if (this.controller) {
        this.controller.abort();
        this.controller = null;
      }
    }

    /* -------------------------------------------------------------- Input */

    /**
     * True when a control belongs to the facet form — whether it is nested
     * inside it or associated with it by the `form` attribute.
     *
     * `closest()` alone is not enough: the sort select lives in the toolbar,
     * outside the form, and is bound to it with form="…". Form association is
     * not DOM containment, so it has to be checked through `element.form`.
     */
    ownedByForm(element) {
      var owner = element.form || element.closest('[data-kf-facet-form]');
      return Boolean(owner && owner.matches('[data-kf-facet-form]'));
    }

    onChange(event) {
      if (!(event.target instanceof Element)) return;
      // Price inputs are handled on `input` with a debounce; reacting to their
      // change event as well would fire a second, identical request.
      if (event.target.closest('[data-kf-facet-price]')) return;
      if (!this.ownedByForm(event.target)) return;

      this.apply();
    }

    onInput(event) {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('[data-kf-facet-price]')) return;
      this.debouncedApply();
    }

    onSubmit(event) {
      // The form is real and would navigate. With JS present, intercept it.
      if (!event.target.matches('[data-kf-facet-form]')) return;
      event.preventDefault();
      this.apply();
    }

    onClick(event) {
      if (!(event.target instanceof Element)) return;

      var toggle = event.target.closest('[data-kf-facet-toggle]');
      if (toggle) {
        event.preventDefault();
        this.togglePanel();
        return;
      }

      if (event.target.closest('[data-kf-facet-close]')) {
        event.preventDefault();
        this.closePanel();
        return;
      }

      // Remove-filter chips and "clear all" are real links; follow them
      // through the AJAX path instead of navigating.
      var remove = event.target.closest('[data-kf-facet-remove]');
      if (remove) {
        event.preventDefault();
        this.render(remove.getAttribute('href'));
      }
    }

    onKeydown(event) {
      if (event.key !== 'Escape' || !this.hasAttribute('data-panel-open')) return;
      event.stopPropagation();
      this.closePanel();
    }

    onPopState() {
      // Back and forward must reflect the filters that were applied, so the
      // page is re-rendered from the URL rather than from form state.
      this.render(window.location.href, false);
    }

    /* ------------------------------------------------------------- Applying */

    /**
     * Serialises the form into a collection URL. Empty values are dropped so
     * an untouched price field cannot leave `filter.v.price.gte=` in the URL.
     */
    buildUrl() {
      var form = this.form;
      if (!form) return window.location.href;

      var data = new FormData(form);
      var params = new URLSearchParams();

      data.forEach(function (value, key) {
        if (String(value).trim() === '') return;
        params.append(key, value);
      });

      var query = params.toString();
      return form.getAttribute('action') + (query ? '?' + query : '');
    }

    apply() {
      this.render(this.buildUrl());
    }

    render(url, pushState) {
      this.abort();
      this.controller = new AbortController();
      this.setAttribute('data-loading', '');

      var fetchUrl = url + (url.indexOf('?') > -1 ? '&' : '?') + 'section_id=' + this.sectionId;
      var self = this;

      KF.fetchSection(fetchUrl, this.controller.signal)
        .then(function (doc) {
          self.swap(doc);

          if (pushState !== false) {
            window.history.pushState({ kfFacets: true }, '', url);
          }

          self.announce();
        })
        .catch(function (error) {
          if (error.name === 'AbortError') return;
          // Never leave a filtered UI showing unfiltered products: fall back
          // to a real navigation so the shopper still gets correct results.
          window.location.href = url;
        })
        .finally(function () {
          self.removeAttribute('data-loading');
          self.controller = null;
        });
    }

    swap(doc) {
      var regions = document.querySelectorAll('[data-kf-facet-region]');

      Array.prototype.forEach.call(regions, function (region) {
        var key = region.getAttribute('data-kf-facet-region');
        var incoming = doc.querySelector('[data-kf-facet-region="' + key + '"]');
        if (incoming) region.innerHTML = incoming.innerHTML;
      });

      if (KF.motion) KF.motion.scan(document);
    }

    announce() {
      var node = this.querySelector('[data-kf-facet-count]');
      if (node) KF.announce(node.textContent.trim());
    }

    /* --------------------------------------------------------- Mobile panel */

    togglePanel() {
      if (this.hasAttribute('data-panel-open')) {
        this.closePanel();
      } else {
        this.openPanel();
      }
    }

    openPanel() {
      if (!this.panel || this.hasAttribute('data-panel-open')) return;

      this.trigger = this.querySelector('[data-kf-facet-toggle]');
      this.setAttribute('data-panel-open', '');

      // No `inert` here on purpose: whether the panel is reachable depends on
      // the viewport, and CSS `visibility: hidden` already removes it from the
      // tab order and the accessibility tree at mobile widths — without JS
      // having to know the breakpoint.
      KF.lockScroll();
      this.releaseFocus = KF.trapFocus(this.panel, { returnFocusTo: this.trigger });

      if (this.trigger) this.trigger.setAttribute('aria-expanded', 'true');
    }

    closePanel() {
      if (!this.hasAttribute('data-panel-open')) return;

      this.removeAttribute('data-panel-open');
      KF.unlockScroll();

      if (this.releaseFocus) {
        this.releaseFocus();
        this.releaseFocus = null;
      }

      if (this.trigger) this.trigger.setAttribute('aria-expanded', 'false');
    }
  }

  KF.define('kf-facets', KFFacetsElement);
})();
