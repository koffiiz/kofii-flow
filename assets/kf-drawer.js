/* ==========================================================================
   <kf-drawer> — accessible drawer / modal surface
   --------------------------------------------------------------------------
   Markup contract:

     <kf-drawer id="MenuDrawer" data-position="left">
       <div class="kf-overlay" data-kf-overlay></div>
       <div class="kf-drawer kf-drawer--left" role="dialog" aria-modal="true"
            aria-labelledby="MenuDrawerTitle" tabindex="-1">
         <h2 id="MenuDrawerTitle" class="kf-visually-hidden">Menu</h2>
         <button type="button" data-kf-close>Close</button>
         ...
       </div>
     </kf-drawer>

   Any control anywhere on the page can open it:

     <button type="button" data-kf-drawer-open="MenuDrawer" aria-expanded="false">

   Behaviour: focus trap, focus restore, Escape to close, overlay click to
   close, scroll lock, `inert` while closed so the content is fully removed
   from the accessibility tree and tab order.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFDrawerElement extends HTMLElement {
    constructor() {
      super();
      this.releaseFocus = null;
      this.onKeydown = this.onKeydown.bind(this);
      this.onClick = this.onClick.bind(this);
    }

    connectedCallback() {
      this.panel = this.querySelector('[role="dialog"]') || this.querySelector('.kf-drawer');
      this.overlay = this.querySelector('[data-kf-overlay]');

      if (!this.panel) return;

      this.addEventListener('click', this.onClick);
      this.setClosedState();
    }

    disconnectedCallback() {
      if (this.hasAttribute('open')) this.teardown();
      this.removeEventListener('click', this.onClick);
    }

    get isOpen() {
      return this.hasAttribute('open');
    }

    setClosedState() {
      this.panel.removeAttribute('data-kf-open');
      if (this.overlay) this.overlay.removeAttribute('data-kf-open');
      this.panel.setAttribute('inert', '');
    }

    onClick(event) {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-kf-close]')) {
        event.preventDefault();
        this.close();
        return;
      }
      if (this.overlay && event.target === this.overlay) {
        this.close();
      }
    }

    onKeydown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
    }

    open(trigger) {
      if (this.isOpen) return;

      this.trigger = trigger || null;
      this.setAttribute('open', '');
      this.panel.removeAttribute('inert');

      // Force a reflow so the transition runs from the closed transform
      // instead of jumping straight to the open state.
      void this.panel.offsetWidth;

      this.panel.setAttribute('data-kf-open', '');
      if (this.overlay) this.overlay.setAttribute('data-kf-open', '');

      KF.lockScroll();
      document.addEventListener('keydown', this.onKeydown);

      var initial = this.querySelector('[data-kf-autofocus]');
      this.releaseFocus = KF.trapFocus(this.panel, {
        initialFocus: initial || undefined,
        returnFocusTo: this.trigger
      });

      if (this.trigger) this.trigger.setAttribute('aria-expanded', 'true');
      KF.emit(KF.events.drawerOpen, { id: this.id }, this);
    }

    close() {
      if (!this.isOpen) return;
      this.teardown();
      KF.emit(KF.events.drawerClose, { id: this.id }, this);
    }

    teardown() {
      this.removeAttribute('open');
      this.setClosedState();

      document.removeEventListener('keydown', this.onKeydown);
      KF.unlockScroll();

      if (this.releaseFocus) {
        this.releaseFocus();
        this.releaseFocus = null;
      }

      if (this.trigger) {
        this.trigger.setAttribute('aria-expanded', 'false');
        this.trigger = null;
      }
    }

    toggle(trigger) {
      if (this.isOpen) this.close(); else this.open(trigger);
    }
  }

  KF.define('kf-drawer', KFDrawerElement);

  /* Delegated openers. Registered once, works for markup added later by the
     Theme Editor without any rebinding. */
  if (!document.documentElement.hasAttribute('data-kf-drawer-bound')) {
    document.documentElement.setAttribute('data-kf-drawer-bound', '');

    document.addEventListener('click', function (event) {
      if (!(event.target instanceof Element)) return;
      var trigger = event.target.closest('[data-kf-drawer-open]');
      if (!trigger) return;

      var drawer = document.getElementById(trigger.getAttribute('data-kf-drawer-open'));
      if (!drawer || typeof drawer.toggle !== 'function') return;

      event.preventDefault();
      drawer.toggle(trigger);
    });
  }
})();
