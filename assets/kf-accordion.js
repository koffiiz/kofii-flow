/* ==========================================================================
   <kf-accordion>
   --------------------------------------------------------------------------
   Animates the open/close of native <details> panels and, optionally, keeps
   only one open at a time.

   Native <details> cannot be transitioned because the panel is display:none
   when closed. Rather than reimplement disclosure in JavaScript — which would
   cost the built-in semantics, Escape behaviour and find-in-page support — the
   element animates the panel height with the Web Animations API and holds the
   `open` attribute until the exit animation finishes.

   With JavaScript disabled the accordion still opens and closes instantly,
   because the browser owns the state.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  var DURATION = 280;

  class KFAccordionElement extends HTMLElement {
    constructor() {
      super();
      this.onClick = this.onClick.bind(this);
    }

    connectedCallback() {
      this.addEventListener('click', this.onClick);
    }

    disconnectedCallback() {
      this.removeEventListener('click', this.onClick);
    }

    get single() {
      return this.dataset.single === 'true';
    }

    onClick(event) {
      if (!(event.target instanceof Element)) return;
      var summary = event.target.closest('summary');
      if (!summary || !this.contains(summary)) return;

      var details = summary.parentElement;
      var panel = summary.nextElementSibling;
      if (!details || !panel) return;

      if (!KF.motionAllowed()) {
        if (this.single && !details.open) this.closeOthers(details);
        return;
      }

      event.preventDefault();

      if (details.open) {
        this.collapse(details, panel);
      } else {
        if (this.single) this.closeOthers(details);
        this.expand(details, panel);
      }
    }

    closeOthers(current) {
      var self = this;
      Array.prototype.forEach.call(this.querySelectorAll('details[open]'), function (details) {
        if (details === current) return;
        var panel = details.querySelector('summary').nextElementSibling;
        if (panel) self.collapse(details, panel);
      });
    }

    expand(details, panel) {
      details.open = true;
      details.setAttribute('data-kf-expanding', '');

      var animation = panel.animate(
        { height: ['0px', panel.scrollHeight + 'px'], opacity: [0, 1] },
        { duration: DURATION, easing: 'cubic-bezier(0.22, 0.61, 0.24, 1)' }
      );

      animation.onfinish = function () {
        details.removeAttribute('data-kf-expanding');
      };
    }

    collapse(details, panel) {
      details.setAttribute('data-kf-collapsing', '');

      var animation = panel.animate(
        { height: [panel.scrollHeight + 'px', '0px'], opacity: [1, 0] },
        { duration: DURATION, easing: 'cubic-bezier(0.32, 0.08, 0.24, 1)' }
      );

      animation.onfinish = function () {
        details.open = false;
        details.removeAttribute('data-kf-collapsing');
      };
    }
  }

  KF.define('kf-accordion', KFAccordionElement);
})();
