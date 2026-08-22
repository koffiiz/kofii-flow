/* ==========================================================================
   <kf-quick-add>
   --------------------------------------------------------------------------
   Add to cart from a product card.

   Two paths, chosen in Liquid:

     Single variant   the card carries data-variant-id, so the click adds
                      straight to the cart with no interruption
     Multiple variants  a panel opens with the real variant picker and buy
                      buttons, fetched from `sections/quick-add.liquid`

   The panel is a native <dialog> created once and reused. showModal() gives a
   focus trap, Escape and background inertness by construction rather than
   re-implemented here, and one shared dialog means the markup is not repeated
   for every card in a grid.

   Nothing is duplicated from the product page: the panel renders the same
   variant picker and buy button snippets, and the add itself goes through
   KF.cart.add — the one add-to-cart implementation.

   Progressive enhancement: the card's link to the product page is untouched,
   so with scripting off the shopper simply goes to the product.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  var dialog = null;

  /**
   * One dialog per document, created on first use.
   *
   * `closeLabel` comes from the element that opened it, because this markup is
   * built in JavaScript and cannot reach the theme's translations directly —
   * hardcoding English here would be the one untranslated string in the theme.
   */
  function getDialog(closeLabel) {
    if (dialog && document.body.contains(dialog)) return dialog;

    dialog = document.createElement('dialog');
    dialog.className = 'kf-quick-add-panel kf-scheme kf-scheme--scheme-1';
    dialog.setAttribute('data-kf-quick-add-dialog', '');
    dialog.innerHTML =
      '<button type="button" class="kf-icon-button kf-quick-add-panel__close" data-kf-quick-add-close>' +
      '<svg class="kf-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '<span class="kf-visually-hidden"></span></button>' +
      '<div class="kf-quick-add-panel__body" data-kf-quick-add-body></div>';

    dialog.querySelector('.kf-visually-hidden').textContent = closeLabel || 'Close';

    dialog.addEventListener('click', function (event) {
      if (!(event.target instanceof Element)) return;
      // Backdrop click: the dialog element itself is the backdrop area.
      if (event.target === dialog || event.target.closest('[data-kf-quick-add-close]')) {
        dialog.close();
      }
    });

    dialog.addEventListener('close', function () {
      KF.unlockScroll();
      dialog.querySelector('[data-kf-quick-add-body]').innerHTML = '';
      if (dialog.returnFocusTo && document.contains(dialog.returnFocusTo)) {
        dialog.returnFocusTo.focus({ preventScroll: true });
      }
    });

    document.body.appendChild(dialog);
    return dialog;
  }

  class KFQuickAddElement extends HTMLElement {
    constructor() {
      super();
      this.onClick = this.onClick.bind(this);
      this.onCartUpdate = this.onCartUpdate.bind(this);
    }

    connectedCallback() {
      this.button = this.querySelector('[data-kf-quick-add]');
      if (!this.button) return;
      this.addEventListener('click', this.onClick);
    }

    disconnectedCallback() {
      this.removeEventListener('click', this.onClick);
      if (this.releaseCart) this.releaseCart();
    }

    get variantId() {
      return this.dataset.variantId;
    }

    onClick(event) {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('[data-kf-quick-add]')) return;

      event.preventDefault();

      if (this.variantId) {
        this.addDirect();
      } else {
        this.openPanel();
      }
    }

    /* ---------------------------------------------------------- Direct add */

    addDirect() {
      if (!KF.cart) {
        window.location.href = this.dataset.productUrl;
        return;
      }

      var self = this;
      this.setLoading(true);

      KF.cart
        .add({ items: [{ id: Number(this.variantId), quantity: 1 }] })
        .then(function (result) {
          KF.announce((self.dataset.productTitle || 'Item') + ' added to cart.');
          if (!result.opensDrawer) self.flashAdded();
        })
        .catch(function (error) {
          // Stock limits and similar are real answers, not failures to hide.
          KF.announce(error.message, true);
          KF.emit(KF.events.cartError, { message: error.message });
        })
        .finally(function () {
          self.setLoading(false);
        });
    }

    setLoading(isLoading) {
      this.toggleAttribute('data-loading', isLoading);
      this.button.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    }

    /** Brief confirmation for when no drawer opens to acknowledge the add. */
    flashAdded() {
      var self = this;
      this.setAttribute('data-added', '');
      window.clearTimeout(this.addedTimer);
      this.addedTimer = window.setTimeout(function () {
        self.removeAttribute('data-added');
      }, 2000);
    }

    /* ----------------------------------------------------------- The panel */

    openPanel() {
      var url = this.dataset.productUrl;
      if (!url) return;

      var panel = getDialog(this.dataset.closeLabel);
      if (typeof panel.showModal !== 'function') {
        window.location.href = url;
        return;
      }

      var body = panel.querySelector('[data-kf-quick-add-body]');
      var self = this;

      panel.returnFocusTo = this.button;
      this.setLoading(true);

      KF.fetchSection(url + '?section_id=quick-add')
        .then(function (doc) {
          var incoming = doc.querySelector('[data-kf-quick-add-content]');
          if (!incoming) throw new Error('Quick add returned no content');

          body.innerHTML = incoming.innerHTML;
          panel.showModal();
          KF.lockScroll();

          // Close once the item is in the cart; the drawer or the cart count
          // is the confirmation from that point on.
          self.releaseCart = KF.on(KF.events.cartUpdate, self.onCartUpdate);
        })
        .catch(function () {
          // Never strand the shopper: fall back to the product page.
          window.location.href = url;
        })
        .finally(function () {
          self.setLoading(false);
        });
    }

    onCartUpdate() {
      if (dialog && dialog.open) dialog.close();
      if (this.releaseCart) {
        this.releaseCart();
        this.releaseCart = null;
      }
    }
  }

  KF.define('kf-quick-add', KFQuickAddElement);
})();
