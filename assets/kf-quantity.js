/* ==========================================================================
   <kf-quantity>
   --------------------------------------------------------------------------
   Increment / decrement around a native <input type="number">.

   The input is the source of truth and remains fully usable without
   JavaScript — the buttons are progressive enhancement and are the only thing
   this element adds. Respects min, max and step, including Shopify's
   quantity rules when the Liquid sets them.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFQuantityElement extends HTMLElement {
    constructor() {
      super();
      this.onClick = this.onClick.bind(this);
      this.onInputChange = this.onInputChange.bind(this);
    }

    connectedCallback() {
      this.input = this.querySelector('input[type="number"]');
      if (!this.input) return;

      this.addEventListener('click', this.onClick);
      this.input.addEventListener('change', this.onInputChange);
      this.refreshButtons();
    }

    disconnectedCallback() {
      this.removeEventListener('click', this.onClick);
      if (this.input) this.input.removeEventListener('change', this.onInputChange);
    }

    get step() {
      return KF.parseNumber(this.input.step, 1) || 1;
    }

    get min() {
      return KF.parseNumber(this.input.min, 1);
    }

    get max() {
      // An empty max attribute means unlimited, not zero.
      return this.input.max === '' ? Infinity : KF.parseNumber(this.input.max, Infinity);
    }

    onClick(event) {
      if (!(event.target instanceof Element)) return;
      var button = event.target.closest('[data-kf-quantity-step]');
      if (!button) return;

      event.preventDefault();
      var direction = button.dataset.kfQuantityStep === 'up' ? 1 : -1;
      var next = KF.parseNumber(this.input.value, this.min) + direction * this.step;

      this.setValue(next);
    }

    onInputChange() {
      this.setValue(KF.parseNumber(this.input.value, this.min));
    }

    setValue(value) {
      var clamped = Math.min(Math.max(value, this.min), this.max);
      if (String(clamped) === this.input.value) {
        this.refreshButtons();
        return;
      }

      this.input.value = clamped;
      this.refreshButtons();
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    refreshButtons() {
      var value = KF.parseNumber(this.input.value, this.min);
      var down = this.querySelector('[data-kf-quantity-step="down"]');
      var up = this.querySelector('[data-kf-quantity-step="up"]');

      if (down) down.toggleAttribute('disabled', value <= this.min);
      if (up) up.toggleAttribute('disabled', value >= this.max);
    }
  }

  KF.define('kf-quantity', KFQuantityElement);
})();
