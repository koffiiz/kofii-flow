/* ==========================================================================
   <kf-variant-picker>
   --------------------------------------------------------------------------
   Owns variant selection for the product page.

   Approach: the picker never renders prices, inventory or buy buttons itself.
   On change it asks Shopify to re-render the section with the new variant
   (Section Rendering API) and swaps the regions marked
   `[data-kf-variant-region]`. That keeps every piece of variant-dependent
   presentation in Liquid, where it belongs — there is no second, drifting
   implementation of price or inventory logic in JavaScript.

   Markup contract:
     <div data-kf-product-root data-kf-section-id="{{ section.id }}">
       <kf-variant-picker data-product-url="{{ product.url }}" data-update-url="true">
         <script type="application/json" data-kf-variant-data>[...]</script>
         <fieldset data-option-index="0"> ...inputs... </fieldset>
       </kf-variant-picker>
       <div data-kf-variant-region="price">...</div>
     </div>

   The section id is read from the `[data-kf-product-root]` ancestor rather
   than from a block setting, because theme blocks have no access to the
   parent `section` object.

   Progressive enhancement: without JavaScript the inputs are a real <form>
   control set and the page still works through a full reload, because each
   swatch is a radio inside the product form.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFVariantPickerElement extends HTMLElement {
    constructor() {
      super();
      this.controller = null;
      this.onChange = this.onChange.bind(this);
    }

    connectedCallback() {
      this.root = this.closest('[data-kf-product-root]') || document;
      this.sectionId = this.dataset.sectionId || this.root.dataset.kfSectionId;
      this.productUrl = this.dataset.productUrl;

      if (!this.sectionId || !this.productUrl) {
        // Without both, a re-render would fetch the wrong markup. Leaving the
        // native form untouched is better than showing a wrong price.
        if (window.console) {
          console.warn('[Kofii Flow] Variant picker is missing its section id or product URL');
        }
        return;
      }

      this.variants = this.readVariants();
      this.addEventListener('change', this.onChange);

      this.refreshAvailability();
    }

    disconnectedCallback() {
      this.removeEventListener('change', this.onChange);
      this.abort();
    }

    readVariants() {
      var script = this.querySelector('[data-kf-variant-data]');
      if (!script) return [];
      try {
        return JSON.parse(script.textContent);
      } catch (error) {
        if (window.console) console.warn('[Kofii Flow] Invalid variant data', error);
        return [];
      }
    }

    /** The currently selected value for each option, by option index. */
    get selectedOptions() {
      return Array.prototype.map.call(
        this.querySelectorAll('[data-option-index]'),
        function (group) {
          var checked = group.querySelector('input:checked');
          if (checked) return checked.value;
          var select = group.querySelector('select');
          return select ? select.value : null;
        }
      );
    }

    findVariant(options) {
      return this.variants.filter(function (variant) {
        return options.every(function (value, index) {
          return variant.options[index] === value;
        });
      })[0];
    }

    /**
     * Marks option values that cannot be reached from the current selection.
     * A value is unavailable when no variant exists that combines it with the
     * other currently selected options — which is what a shopper actually
     * needs to know before clicking.
     */
    refreshAvailability() {
      var selected = this.selectedOptions;
      var self = this;

      Array.prototype.forEach.call(this.querySelectorAll('[data-option-index]'), function (group) {
        var index = parseInt(group.dataset.optionIndex, 10);

        Array.prototype.forEach.call(group.querySelectorAll('[data-option-value]'), function (node) {
          var value = node.dataset.optionValue;
          var probe = selected.slice();
          probe[index] = value;

          var match = self.variants.filter(function (variant) {
            return probe.every(function (candidate, i) {
              // Ignore options the shopper has not chosen yet.
              return candidate == null || variant.options[i] === candidate;
            });
          });

          var exists = match.length > 0;
          var inStock = match.some(function (variant) {
            return variant.available;
          });

          node.toggleAttribute('data-unavailable', !exists || !inStock);

          var input = node.matches('input, option') ? node : node.querySelector('input, option');
          if (input && input.tagName === 'OPTION') {
            input.disabled = !exists;
          }
        });
      });
    }

    onChange() {
      this.refreshAvailability();

      var variant = this.findVariant(this.selectedOptions);
      KF.emit(KF.events.variantChange, { variant: variant || null, sectionId: this.sectionId });

      if (!variant) {
        this.setUnavailable();
        return;
      }

      this.updateUrl(variant);
      this.updateFormInputs(variant);
      this.renderSection(variant);
    }

    setUnavailable() {
      Array.prototype.forEach.call(
        this.root.querySelectorAll('[data-kf-add-button]'),
        function (button) {
          button.setAttribute('disabled', '');
          var label = button.querySelector('.kf-button__label');
          if (label && button.dataset.unavailableText) {
            label.textContent = button.dataset.unavailableText;
          }
        }
      );
    }

    updateUrl(variant) {
      if (this.dataset.updateUrl === 'false') return;
      var url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url.toString());
    }

    /** Keeps every product form on the page pointed at the chosen variant. */
    updateFormInputs(variant) {
      Array.prototype.forEach.call(
        this.root.querySelectorAll('input[name="id"]'),
        function (input) {
          input.value = variant.id;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      );
    }

    abort() {
      if (this.controller) {
        this.controller.abort();
        this.controller = null;
      }
    }

    renderSection(variant) {
      this.abort();
      this.controller = new AbortController();
      this.root.setAttribute('data-kf-updating', '');

      var url =
        this.productUrl +
        '?variant=' + variant.id +
        '&section_id=' + this.sectionId;

      var self = this;

      KF.fetchSection(url, this.controller.signal)
        .then(function (doc) {
          self.swapRegions(doc);
        })
        .catch(function (error) {
          if (error.name === 'AbortError') return;
          // A failed refresh must not leave a stale price next to a live
          // add-to-cart button, so fall back to a full navigation.
          if (window.console) console.warn('[Kofii Flow] Variant refresh failed', error);
          window.location.search = '?variant=' + variant.id;
        })
        .finally(function () {
          self.root.removeAttribute('data-kf-updating');
          self.controller = null;
        });
    }

    swapRegions(doc) {
      var regions = this.root.querySelectorAll('[data-kf-variant-region]');

      Array.prototype.forEach.call(regions, function (region) {
        var key = region.getAttribute('data-kf-variant-region');
        var incoming = doc.querySelector('[data-kf-variant-region="' + key + '"]');
        if (incoming) region.innerHTML = incoming.innerHTML;
      });

      // Newly injected markup may contain animated elements.
      if (KF.motion) KF.motion.scan(this.root);
    }
  }

  KF.define('kf-variant-picker', KFVariantPickerElement);
})();
