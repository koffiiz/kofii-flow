/* ==========================================================================
   <kf-disclosure> — progressive-enhancement dropdown
   --------------------------------------------------------------------------
   Wraps a native <details>/<summary> pair. With JavaScript disabled it still
   opens and closes, because the browser owns the state. This element only adds
   the things a native disclosure lacks:

     - hover intent on pointer devices (with open/close delays)
     - Escape to close, returning focus to the summary
     - close when focus or the pointer leaves
     - an exit animation, by holding `open` until the transition finishes

   Markup:
     <kf-disclosure data-hover="true" data-close-siblings="true">
       <details>
         <summary>Label</summary>
         <div class="kf-disclosure__panel">...</div>
       </details>
     </kf-disclosure>
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  var OPEN_DELAY = 70;
  var CLOSE_DELAY = 180;
  var EXIT_DURATION = 200;

  class KFDisclosureElement extends HTMLElement {
    constructor() {
      super();
      this.openTimer = null;
      this.closeTimer = null;
      this.exitTimer = null;

      this.onToggle = this.onToggle.bind(this);
      this.onKeydown = this.onKeydown.bind(this);
      this.onFocusOut = this.onFocusOut.bind(this);
      this.onPointerEnter = this.onPointerEnter.bind(this);
      this.onPointerLeave = this.onPointerLeave.bind(this);
      this.onDocumentClick = this.onDocumentClick.bind(this);
    }

    connectedCallback() {
      this.details = this.querySelector('details');
      this.summary = this.querySelector('summary');
      this.panel = this.querySelector('.kf-disclosure__panel, .kf-nav__panel');

      if (!this.details || !this.summary) return;

      this.summary.setAttribute('aria-expanded', this.details.open ? 'true' : 'false');

      this.details.addEventListener('toggle', this.onToggle);
      this.addEventListener('keydown', this.onKeydown);
      this.addEventListener('focusout', this.onFocusOut);

      if (this.hoverEnabled) {
        this.addEventListener('pointerenter', this.onPointerEnter);
        this.addEventListener('pointerleave', this.onPointerLeave);
      }
    }

    disconnectedCallback() {
      this.clearTimers();
      document.removeEventListener('click', this.onDocumentClick);
      if (this.details) this.details.removeEventListener('toggle', this.onToggle);
    }

    get hoverEnabled() {
      return this.dataset.hover === 'true' && window.matchMedia('(hover: hover)').matches;
    }

    get isOpen() {
      return Boolean(this.details && this.details.open);
    }

    clearTimers() {
      window.clearTimeout(this.openTimer);
      window.clearTimeout(this.closeTimer);
      window.clearTimeout(this.exitTimer);
    }

    onToggle() {
      this.summary.setAttribute('aria-expanded', this.details.open ? 'true' : 'false');

      if (this.details.open) {
        this.removeAttribute('data-kf-closing');
        document.addEventListener('click', this.onDocumentClick);
        if (this.dataset.closeSiblings === 'true') this.closeSiblings();
      } else {
        document.removeEventListener('click', this.onDocumentClick);
      }
    }

    closeSiblings() {
      var parent = this.parentElement;
      if (!parent) return;
      Array.prototype.forEach.call(parent.querySelectorAll('kf-disclosure'), function (sibling) {
        if (sibling !== this && sibling.isOpen) sibling.close(true);
      }, this);
    }

    onDocumentClick(event) {
      if (this.contains(event.target)) return;
      this.close(true);
    }

    onKeydown(event) {
      if (event.key !== 'Escape' || !this.isOpen) return;
      event.stopPropagation();
      this.close(true);
      this.summary.focus();
    }

    onFocusOut(event) {
      if (!this.isOpen) return;
      // relatedTarget is null when focus leaves the window entirely — keep the
      // panel open in that case so returning to the tab is not disorienting.
      if (!event.relatedTarget) return;
      if (this.contains(event.relatedTarget)) return;
      this.close(true);
    }

    onPointerEnter() {
      window.clearTimeout(this.closeTimer);
      var self = this;
      this.openTimer = window.setTimeout(function () {
        self.open();
      }, OPEN_DELAY);
    }

    onPointerLeave() {
      window.clearTimeout(this.openTimer);
      var self = this;
      this.closeTimer = window.setTimeout(function () {
        self.close();
      }, CLOSE_DELAY);
    }

    open() {
      this.clearTimers();
      this.removeAttribute('data-kf-closing');
      if (this.details) this.details.open = true;
    }

    /**
     * @param {boolean} immediate Skip the exit animation (used for Escape and
     *   outside clicks, where a lingering panel feels unresponsive).
     */
    close(immediate) {
      this.clearTimers();
      if (!this.details || !this.details.open) return;

      if (immediate || !KF.motionAllowed()) {
        this.details.open = false;
        this.removeAttribute('data-kf-closing');
        return;
      }

      var self = this;
      this.setAttribute('data-kf-closing', '');
      this.exitTimer = window.setTimeout(function () {
        self.details.open = false;
        self.removeAttribute('data-kf-closing');
      }, EXIT_DURATION);
    }
  }

  KF.define('kf-disclosure', KFDisclosureElement);
})();
