/* ==========================================================================
   <kf-product-form>
   --------------------------------------------------------------------------
   AJAX add-to-cart around Shopify's native product form.

   The form is a real <form action="/cart/add" method="post">, so with
   JavaScript disabled it still adds to the cart through a normal page load.
   This element only intercepts the submit to avoid the reload.

   On success it emits `kf:cart:update` with the current cart, which the header
   count listens for today and the cart drawer will listen for later — no
   component needs to know about any other component.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFProductFormElement extends HTMLElement {
    constructor() {
      super();
      this.onSubmit = this.onSubmit.bind(this);
    }

    connectedCallback() {
      this.form = this.querySelector('form');
      if (!this.form) return;

      this.submitButton = this.querySelector('[data-kf-add-button]');
      this.errorTarget = this.querySelector('[data-kf-form-error]');

      this.form.addEventListener('submit', this.onSubmit);
    }

    disconnectedCallback() {
      if (this.form) this.form.removeEventListener('submit', this.onSubmit);
    }

    onSubmit(event) {
      if (this.submitButton && this.submitButton.hasAttribute('disabled')) {
        event.preventDefault();
        return;
      }

      event.preventDefault();

      if (!KF.cart) {
        // kf-cart.js owns the single add-to-cart implementation. Without it,
        // let the browser submit the form normally rather than silently doing
        // nothing — the shopper still reaches the cart.
        this.form.submit();
        return;
      }

      this.setLoading(true);
      this.clearError();

      var self = this;

      KF.cart
        .add(new FormData(this.form))
        .then(function (result) {
          self.announceSuccess(result.added, result.cart, result.opensDrawer);
        })
        .catch(function (error) {
          self.showError(error.message);
          KF.emit(KF.events.cartError, { message: error.message });
        })
        .finally(function () {
          self.setLoading(false);
        });
    }

    announceSuccess(addedItem, cart, opensDrawer) {
      // When the drawer opens, it is the confirmation — an inline "Added to
      // cart" underneath would be a second, redundant message.
      var status = this.querySelector('[data-kf-form-status]');
      if (status && !opensDrawer) {
        status.hidden = false;
        var link = status.querySelector('a');
        if (link) link.href = window.routes.cart_url;
      }

      KF.announce(
        (addedItem.product_title || addedItem.title) +
          ' added to cart. ' +
          cart.item_count +
          ' items in cart.'
      );
    }

    setLoading(isLoading) {
      this.toggleAttribute('data-loading', isLoading);
      if (!this.submitButton) return;
      this.submitButton.setAttribute('aria-busy', isLoading ? 'true' : 'false');
      // Not `disabled`: that would move focus off the button mid-interaction.
      this.submitButton.classList.toggle('is-loading', isLoading);
    }

    showError(message) {
      if (!this.errorTarget) return;
      this.errorTarget.textContent = message;
      this.errorTarget.hidden = false;
    }

    clearError() {
      if (!this.errorTarget) return;
      this.errorTarget.textContent = '';
      this.errorTarget.hidden = true;

      var status = this.querySelector('[data-kf-form-status]');
      if (status) status.hidden = true;
    }
  }

  KF.define('kf-product-form', KFProductFormElement);

  /* --------------------------------------------------------------------------
     Header cart count.
     Registered once, globally, so any component that emits `kf:cart:update`
     keeps the header in sync without knowing the header exists.
     -------------------------------------------------------------------------- */

  if (!document.documentElement.hasAttribute('data-kf-cart-bound')) {
    document.documentElement.setAttribute('data-kf-cart-bound', '');

    KF.on(KF.events.cartUpdate, function (event) {
      var cart = event.detail.cart;
      if (!cart) return;

      Array.prototype.forEach.call(
        document.querySelectorAll('[data-kf-cart-count]'),
        function (node) {
          node.textContent = cart.item_count;
          node.hidden = cart.item_count === 0;
        }
      );

      Array.prototype.forEach.call(
        document.querySelectorAll('[data-kf-cart-count-label]'),
        function (node) {
          node.textContent = cart.item_count + ' items in cart';
        }
      );
    });
  }
})();
