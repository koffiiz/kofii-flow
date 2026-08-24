/* ==========================================================================
   <kf-tabs>
   --------------------------------------------------------------------------
   The WAI-ARIA tabs pattern: one panel visible at a time, arrow keys moving
   between tabs, and a roving tabindex so the tablist is a single stop in the
   page's tab order rather than one stop per tab.

   The no-JavaScript state is the reason the markup looks the way it does.
   Every panel renders visible, each under its own heading, and the tablist is
   hidden by CSS until this element marks itself ready. So without the script a
   visitor gets a plain stacked document with headings — everything readable,
   nothing behind a control that cannot work. Only once the element boots does
   the tablist appear, the headings step aside and the panels start hiding.

   That order matters: this element never reveals content, it only ever hides
   what a working control can bring back.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFTabsElement extends HTMLElement {
    constructor() {
      super();
      this.index = 0;
      this.onClick = this.onClick.bind(this);
      this.onKeydown = this.onKeydown.bind(this);
    }

    connectedCallback() {
      this.tabs = Array.prototype.slice.call(this.querySelectorAll('[role="tab"]'));
      this.panels = Array.prototype.slice.call(this.querySelectorAll('[role="tabpanel"]'));

      // Nothing to drive, or the two lists disagree — leave the stacked
      // fallback exactly as it is rather than half-applying the pattern.
      if (!this.tabs.length || this.tabs.length !== this.panels.length) return;

      this.addEventListener('click', this.onClick);
      this.addEventListener('keydown', this.onKeydown);

      // The CSS gate. Until this lands the tablist is hidden and every panel
      // is showing, which is the state a visitor without JavaScript keeps.
      this.setAttribute('data-kf-tabs-ready', '');

      this.select(0, false);
    }

    disconnectedCallback() {
      this.removeEventListener('click', this.onClick);
      this.removeEventListener('keydown', this.onKeydown);
    }

    select(index, moveFocus) {
      if (index < 0 || index >= this.tabs.length) return;
      this.index = index;

      this.tabs.forEach(function (tab, i) {
        var selected = i === index;
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        // Roving tabindex: only the selected tab is reachable with Tab, so
        // Tab leaves the tablist instead of walking every tab in it.
        tab.tabIndex = selected ? 0 : -1;
      });

      this.panels.forEach(function (panel, i) {
        panel.hidden = i !== index;
      });

      if (moveFocus) this.tabs[index].focus();
    }

    onClick(event) {
      if (!(event.target instanceof Element)) return;
      var tab = event.target.closest('[role="tab"]');
      if (!tab || !this.contains(tab)) return;

      var index = this.tabs.indexOf(tab);
      if (index > -1) this.select(index, true);
    }

    onKeydown(event) {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('[role="tab"]')) return;

      var last = this.tabs.length - 1;
      var next = null;

      switch (event.key) {
        case 'ArrowRight':
          next = this.index === last ? 0 : this.index + 1;
          break;
        case 'ArrowLeft':
          next = this.index === 0 ? last : this.index - 1;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = last;
          break;
        default:
          return;
      }

      // Only now, once a key we handle has matched — otherwise this would
      // swallow Tab, Enter and everything else aimed at the tab.
      event.preventDefault();
      this.select(next, true);
    }
  }

  KF.define('kf-tabs', KFTabsElement);
})();
