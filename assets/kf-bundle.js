/* ==========================================================================
   <kf-bundle>
   --------------------------------------------------------------------------
   "Buy together" — a fixed set of products added to the cart in one request.

   It does three things, and deliberately nothing else:

   1. Reveals the add button. It is rendered `hidden` in Liquid because the
      multi-item add has no reliable no-JavaScript path: Shopify documents the
      `items` array for the JSON body only, and form-encoded multi-item field
      naming is not part of the documented contract. Rather than ship a button
      that might silently do nothing, the button appears only once this file
      has. Without it the section is still a usable curated grid — every item
      shows its price and links to its product page.

   2. Swaps each item's displayed price when its variant select changes. Those
      are all pre-rendered by Liquid's `money` filter and toggled with `hidden`,
      so no per-item price is ever computed here.

   3. Sends one `/cart/add.js` request with every selected variant, through
      KF.cart.add — the single add-to-cart implementation in the theme.

   4. Keeps the running total in step with the chosen variants.

   THE ONE DELIBERATE EXCEPTION TO "NO MONEY MATHS IN JAVASCRIPT".
   kf-cart.js states that rule and holds to it absolutely, because a cart total
   the theme computed will eventually disagree with checkout. Here the rule is
   relaxed, narrowly and on purpose: a bundle total that sits still while the
   shopper changes a size reads as broken, and that is the worse failure.

   It is bounded four ways:
     - Liquid renders the opening total with the same `money` filter as every
       other price on the page, so the figure is exact before this file runs
       and stays exact if it never does.
     - The format is the shop's own `money_format`, handed over as a string.
       Nothing here invents a currency convention; it only substitutes an
       amount into the merchant's template.
     - The arithmetic is integer cents, taken from prices Liquid already
       resolved, so market and per-variant pricing are baked in.
     - Nothing downstream reads the result. It is display only — the cart is
       still asked for the real total, and the add request carries variant ids.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;


  /* ---------------------------------------------------------------- Money */

  /**
   * Substitutes an amount into Shopify's `money_format` template.
   *
   * The placeholders are Shopify's own and the set is closed — these seven are
   * everything the platform emits. Each says how to group thousands, which
   * mark separates decimals, and whether to show decimals at all, which is why
   * a shop selling in yen or in kroner formats correctly without this file
   * knowing anything about either.
   */
  var PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/;

  function group(number, separator) {
    return number.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + separator);
  }

  function amount(cents, decimals, thousands, decimalMark) {
    var value = (Number(cents) / 100).toFixed(decimals);
    var parts = value.split('.');
    var whole = group(parts[0], thousands);
    return parts[1] ? whole + decimalMark + parts[1] : whole;
  }

  /**
   * Money formats often carry the symbol as an HTML entity — `&pound;{{amount}}`
   * and `&euro;{{amount}}` are both common. Liquid hands the format over as an
   * attribute, so what arrives here is the entity, and writing it with
   * textContent would print "&pound;12.00" literally.
   *
   * A detached textarea decodes it without parsing markup: its content model
   * is raw text, so nothing in the string can execute.
   */
  function decodeEntities(text) {
    if (text.indexOf('&') === -1) return text;
    var box = document.createElement('textarea');
    box.innerHTML = text;
    return box.value;
  }

  function formatMoney(cents, format) {
    var match = format.match(PLACEHOLDER);
    // No recognisable placeholder means a format this code should not guess
    // at. Returning null leaves the server-rendered figure untouched.
    if (!match) return null;

    switch (match[1]) {
      case 'amount':
        return format.replace(PLACEHOLDER, amount(cents, 2, ',', '.'));
      case 'amount_no_decimals':
        return format.replace(PLACEHOLDER, amount(cents, 0, ',', '.'));
      case 'amount_with_comma_separator':
        return format.replace(PLACEHOLDER, amount(cents, 2, '.', ','));
      case 'amount_no_decimals_with_comma_separator':
        return format.replace(PLACEHOLDER, amount(cents, 0, '.', ','));
      case 'amount_with_apostrophe_separator':
        return format.replace(PLACEHOLDER, amount(cents, 2, "'", '.'));
      case 'amount_with_space_separator':
        return format.replace(PLACEHOLDER, amount(cents, 2, ' ', ','));
      case 'amount_no_decimals_with_space_separator':
        return format.replace(PLACEHOLDER, amount(cents, 0, ' ', ','));
      default:
        return null;
    }
  }

  class KFBundleElement extends HTMLElement {
    constructor() {
      super();
      this.onChange = this.onChange.bind(this);
      this.onSubmit = this.onSubmit.bind(this);
    }

    connectedCallback() {
      this.items = Array.prototype.slice.call(this.querySelectorAll('[data-kf-bundle-item]'));
      this.button = this.querySelector('[data-kf-bundle-add]');
      this.errorTarget = this.querySelector('[data-kf-bundle-error]');
      this.statusTarget = this.querySelector('[data-kf-bundle-status]');
      this.totalTarget = this.querySelector('[data-kf-bundle-total]');
      this.wasTarget = this.querySelector('[data-kf-bundle-was]');
      this.savingsTarget = this.querySelector('[data-kf-bundle-savings]');
      this.moneyFormat = decodeEntities(this.getAttribute('data-money-format') || '');

      if (!this.items.length || !this.button) return;

      // Nothing purchasable means nothing to reveal — Liquid has already said
      // so in the markup.
      if (!this.selections().length) return;

      this.button.hidden = false;
      this.button.addEventListener('click', this.onSubmit);
      this.addEventListener('change', this.onChange);
    }

    disconnectedCallback() {
      if (this.button) this.button.removeEventListener('click', this.onSubmit);
      this.removeEventListener('change', this.onChange);
    }

    /* ------------------------------------------------------------ Selection */

    /** The variant id each item currently offers, skipping the unavailable. */
    selections() {
      var out = [];

      this.items.forEach(function (item) {
        if (item.hasAttribute('data-kf-bundle-unavailable')) return;

        var select = item.querySelector('[data-kf-bundle-variant]');
        var id = select ? select.value : item.getAttribute('data-variant-id');
        if (!id) return;

        out.push({ id: Number(id), quantity: 1 });
      });

      return out;
    }

    onChange(event) {
      var select = event.target.closest('[data-kf-bundle-variant]');
      if (!select) return;

      var item = select.closest('[data-kf-bundle-item]');
      if (!item) return;

      this.showPriceFor(item, select.value);
      this.updateTotal();
      this.clearError();
    }

    /* ------------------------------------------------------------- Totalling */

    /**
     * Sums the chosen variants and rewrites the total, the compare-at figure
     * and the saving badge.
     *
     * Every price is an integer number of cents that Liquid put on the option,
     * so this adds resolved values rather than deriving them. If the shop's
     * money format is missing or unrecognised, nothing is written and the
     * server-rendered total stands — a stale-but-correct figure beats a
     * confidently wrong one.
     */
    updateTotal() {
      if (!this.totalTarget || !this.moneyFormat) return;

      var total = 0;
      var compare = 0;

      this.items.forEach(function (item) {
        if (item.hasAttribute('data-kf-bundle-unavailable')) return;

        var select = item.querySelector('[data-kf-bundle-variant]');
        var source = select ? select.options[select.selectedIndex] : item;
        if (!source) return;

        var price = Number(source.getAttribute('data-price'));
        if (!isFinite(price)) return;

        var was = Number(source.getAttribute('data-compare'));
        total += price;
        compare += isFinite(was) && was > price ? was : price;
      });

      var formatted = formatMoney(total, this.moneyFormat);
      if (formatted === null) return;
      this.totalTarget.textContent = formatted;

      var savings = compare - total;
      var hasSavings = savings > 0;

      if (this.wasTarget) {
        var wasFormatted = hasSavings ? formatMoney(compare, this.moneyFormat) : null;
        this.wasTarget.hidden = !hasSavings || wasFormatted === null;
        if (wasFormatted !== null) this.wasTarget.textContent = wasFormatted;
      }

      if (this.savingsTarget) {
        var savingsFormatted = hasSavings ? formatMoney(savings, this.moneyFormat) : null;
        this.savingsTarget.hidden = !hasSavings || savingsFormatted === null;

        // The sentence around the amount is the merchant's translated string,
        // built by Liquid with a marker where the figure goes.
        var template = this.savingsTarget.getAttribute('data-label');
        if (savingsFormatted !== null && template) {
          this.savingsTarget.textContent = template.replace('[amount]', savingsFormatted);
        }
      }
    }

    /**
     * Reveals the pre-rendered price for one variant and hides the rest. The
     * strings came from Liquid's `money` filter, so a currency, a market or a
     * merchant's money format is already applied correctly.
     */
    showPriceFor(item, variantId) {
      var prices = item.querySelectorAll('[data-kf-bundle-price][data-variant]');
      if (!prices.length) return;

      Array.prototype.forEach.call(prices, function (node) {
        node.hidden = node.getAttribute('data-variant') !== String(variantId);
      });
    }

    /* --------------------------------------------------------------- Adding */

    onSubmit(event) {
      event.preventDefault();

      if (!KF.cart) return;

      var items = this.selections();
      if (!items.length) return;

      this.setLoading(true);
      this.clearError();

      var self = this;

      KF.cart
        .add({ items: items })
        .then(function (result) {
          self.announceSuccess(result.cart, result.opensDrawer);
        })
        .catch(function (error) {
          // Shopify's own message is written for shoppers ("You can only add 2
          // to the cart"), so it is surfaced rather than replaced.
          self.showError(error.message);
          KF.emit(KF.events.cartError, { message: error.message });
        })
        .finally(function () {
          self.setLoading(false);
        });
    }

    announceSuccess(cart, opensDrawer) {
      // When the drawer opens it is the confirmation; an inline message
      // underneath would be a second, redundant one.
      if (this.statusTarget && !opensDrawer) {
        this.statusTarget.hidden = false;
      }

      KF.announce(
        this.getAttribute('data-added-label') +
          '. ' +
          cart.item_count +
          ' items in cart.'
      );
    }

    setLoading(isLoading) {
      this.toggleAttribute('data-loading', isLoading);
      this.button.setAttribute('aria-busy', isLoading ? 'true' : 'false');
      // Not `disabled`: that would move focus off the button mid-interaction.
      this.button.classList.toggle('is-loading', isLoading);
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
    }
  }

  KF.define('kf-bundle', KFBundleElement);
})();
