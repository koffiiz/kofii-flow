/* ==========================================================================
   <kf-compare>
   --------------------------------------------------------------------------
   Drives the divider position of a before/after comparison.

   The control is a native <input type="range">, stretched invisibly across the
   whole image. That single decision buys mouse drag, touch drag, click-to-jump
   and full keyboard support — arrows, Home, End, Page Up/Down — plus a real
   accessible name and an announced value, none of which a div with pointer
   handlers would have without reimplementing all of it badly.

   This element does exactly one thing: copy the range's value into a custom
   property. Everything visual is CSS reading that property.

   Without JavaScript the range is hidden by CSS rather than left as a dead
   control, and the comparison settles at whatever start position the merchant
   chose — both images visible, split, which is a reasonable static image.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFCompareElement extends HTMLElement {
    constructor() {
      super();
      this.onInput = this.onInput.bind(this);
    }

    connectedCallback() {
      this.range = this.querySelector('[data-kf-compare-range]');
      if (!this.range) return;

      // `input` rather than `change`: change only fires when the drag ends, so
      // the divider would jump to its final place instead of following.
      this.range.addEventListener('input', this.onInput);
      this.apply();
    }

    disconnectedCallback() {
      if (this.range) this.range.removeEventListener('input', this.onInput);
    }

    onInput() {
      this.apply();
    }

    apply() {
      this.style.setProperty('--kf-compare-pos', this.range.value + '%');
    }
  }

  KF.define('kf-compare', KFCompareElement);
})();
