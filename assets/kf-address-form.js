/* ==========================================================================
   <kf-address-form>
   --------------------------------------------------------------------------
   Turns the province text input into a select once a country's provinces are
   known, and keeps the two in step when the country changes.

   The direction matters. Liquid can render the country list — Shopify's
   `country_option_tags` provides it — but it cannot render the provinces for
   whichever country is selected, because they arrive as a JSON blob on each
   country's option element. Every theme therefore needs script for this.

   So the markup ships a plain TEXT input for the province. Without this file a
   customer can still type "Ontario" and save a complete address; the field is
   simply less convenient. Building it the other way round — an empty <select>
   that JavaScript fills — would leave a no-script visitor with a province
   field they cannot answer at all, on a form that requires it.

   The swap preserves the server-rendered value, so an address being edited
   keeps its province, and a form that comes back with errors does not quietly
   drop it.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFAddressFormElement extends HTMLElement {
    constructor() {
      super();
      this.onCountryChange = this.onCountryChange.bind(this);
    }

    connectedCallback() {
      this.country = this.querySelector('[data-kf-country]');
      this.provinceInput = this.querySelector('[data-kf-province]');
      this.provinceField = this.querySelector('[data-kf-province-field]');
      if (!this.country || !this.provinceInput) return;

      this.fieldName = this.provinceInput.name;
      this.fieldId = this.provinceInput.id;
      this.initialValue = this.provinceInput.value;

      this.country.addEventListener('change', this.onCountryChange);

      // `country_option_tags` always marks the SHOP's country as selected, so
      // an address saved against a different one comes back showing the wrong
      // country until this puts it right.
      var saved = this.country.dataset.default;
      if (saved) this.country.value = saved;

      this.sync(this.initialValue);
    }

    disconnectedCallback() {
      if (this.country) this.country.removeEventListener('change', this.onCountryChange);
    }

    onCountryChange() {
      // A different country's provinces never include the old value, so the
      // selection starts empty rather than carrying something impossible.
      this.sync('');
    }

    provincesForSelected() {
      var option = this.country.options[this.country.selectedIndex];
      if (!option) return [];
      try {
        return JSON.parse(option.getAttribute('data-provinces') || '[]');
      } catch (error) {
        return [];
      }
    }

    sync(selectedValue) {
      var provinces = this.provincesForSelected();

      // Countries with no provinces hide the field entirely rather than
      // showing an empty control the customer cannot complete.
      if (!provinces.length) {
        this.replaceWith_(null);
        if (this.provinceField) this.provinceField.hidden = true;
        return;
      }

      if (this.provinceField) this.provinceField.hidden = false;

      var select = document.createElement('select');
      select.className = 'kf-select';
      select.name = this.fieldName;
      select.id = this.fieldId;
      select.setAttribute('data-kf-province', '');
      select.setAttribute('autocomplete', 'address-level1');

      provinces.forEach(function (province) {
        var option = document.createElement('option');
        option.value = province[0];
        option.textContent = province[1];
        if (province[0] === selectedValue) option.selected = true;
        select.appendChild(option);
      });

      this.replaceWith_(select);
    }

    replaceWith_(node) {
      var current = this.querySelector('[data-kf-province]');
      if (!current) return;

      if (!node) {
        // Keep a field with the right name in the form so the province is
        // simply empty rather than absent from the submission.
        if (current.tagName === 'INPUT') return;
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = this.fieldName;
        input.setAttribute('data-kf-province', '');
        current.replaceWith(input);
        return;
      }

      current.replaceWith(node);
    }
  }

  KF.define('kf-address-form', KFAddressFormElement);
})();
