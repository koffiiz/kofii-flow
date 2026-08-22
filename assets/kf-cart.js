/* ==========================================================================
   Kofii Flow — Cart
   --------------------------------------------------------------------------
   Two custom elements plus one global listener:

     <kf-cart-items>  line quantity changes and removals
     <kf-cart-note>   debounced order note saving
     (global)         applies re-rendered sections and opens the drawer

   How updates work
     Every mutation asks Shopify to re-render the cart sections in the same
     request (`sections` on the Cart AJAX API) and swaps the returned HTML in.
     Totals, discounts, the free-shipping bar and the empty state are therefore
     always rendered by Liquid — the same rule the product page follows. There
     is no money maths anywhere in this file.

   The response returns the full `<div id="shopify-section-…">` wrapper, so the
   swap targets an inner `[data-kf-cart-content]` anchor inside it rather than
   replacing the wrapper itself.

   Without JavaScript the cart page is a real <form> that posts to /cart with
   named quantity inputs and a submit button, so it stays fully usable.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF || window.KF.cart) return;
  var KF = window.KF;

  var NOTE_DEBOUNCE = 600;

  /* ------------------------------------------------------------- Utilities */

  /** Section ids the cart asks Shopify to re-render on every mutation. */
  function sectionIds() {
    var ids = [];
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-kf-cart-section]'),
      function (node) {
        var id = node.getAttribute('data-kf-cart-section');
        if (id && ids.indexOf(id) === -1) ids.push(id);
      }
    );
    return ids;
  }

  /**
   * Replaces the contents of every cart section present on the page with the
   * freshly rendered markup returned by the Cart AJAX API.
   */
  function applySections(sections) {
    if (!sections) return;

    Object.keys(sections).forEach(function (id) {
      var live = document.querySelector('[data-kf-cart-section="' + id + '"]');
      if (!live) return;

      var parsed = new DOMParser().parseFromString(sections[id], 'text/html');
      var incoming = parsed.querySelector('[data-kf-cart-content]');
      var target = live.querySelector('[data-kf-cart-content]');

      if (incoming && target) {
        target.innerHTML = incoming.innerHTML;
      }
    });

    if (KF.motion) KF.motion.scan(document);
  }

  /**
   * The error element lives in the cart summary, which is a sibling of
   * <kf-cart-items> rather than a descendant — so it has to be looked up from
   * the enclosing cart section, not from the element that triggered the change.
   */
  function errorTarget(scope) {
    if (!scope) return null;
    var section = scope.closest('[data-kf-cart-section]') || document;
    return section.querySelector('[data-kf-cart-error]');
  }

  /** Shared error surface so a failed mutation is never silent. */
  function showError(scope, message) {
    var target = errorTarget(scope);
    if (target) {
      target.textContent = message;
      target.hidden = false;
    }
    KF.announce(message, true);
    KF.emit(KF.events.cartError, { message: message });
  }

  function clearError(scope) {
    var target = errorTarget(scope);
    if (target) {
      target.textContent = '';
      target.hidden = true;
    }
  }

  /**
   * POSTs to a cart endpoint, asking for re-rendered sections in the same
   * round trip, then broadcasts the new cart.
   */
  function mutate(url, body, scope) {
    var payload = Object.assign({}, body, {
      sections: sectionIds().join(','),
      sections_url: window.location.pathname
    });

    if (scope) scope.setAttribute('data-kf-cart-busy', '');
    clearError(scope);

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          throw new Error(result.data.description || result.data.message || 'Cart update failed');
        }
        applySections(result.data.sections);
        KF.emit(KF.events.cartUpdate, { cart: result.data, sections: result.data.sections });
        return result.data;
      })
      .catch(function (error) {
        showError(scope, error.message);
      })
      .finally(function () {
        if (scope) scope.removeAttribute('data-kf-cart-busy');
      });
  }

  /**
   * The one add-to-cart implementation. Used by the product form and by quick
   * add, so the two can never drift on error handling, section refreshing or
   * the events they emit.
   *
   * Accepts a FormData (a real product form) or a plain object
   * ({ items: [{ id, quantity }] }) and adds the cart sections to either, so
   * the drawer is already rendered by the time it opens.
   *
   * Resolves with { added, cart }. Rejects with Shopify's own message — its
   * `description` is written for shoppers ("You can only add 2 to the cart"),
   * so it is surfaced rather than replaced.
   */
  function add(body) {
    var ids = sectionIds().join(',');
    var request = { method: 'POST', headers: { Accept: 'application/json' } };

    if (body instanceof FormData) {
      if (ids) {
        body.append('sections', ids);
        body.append('sections_url', window.location.pathname);
      }
      request.body = body;
    } else {
      request.headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(
        Object.assign({}, body, ids ? { sections: ids, sections_url: window.location.pathname } : {})
      );
    }

    return fetch(window.routes.cart_add_url + '.js', request)
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          throw new Error(result.data.description || result.data.message || 'Add to cart failed');
        }

        applySections(result.data.sections);

        return fetch(window.routes.cart_url + '.js', { headers: { Accept: 'application/json' } })
          .then(function (response) {
            return response.json();
          })
          .then(function (cart) {
            var opensDrawer = document.documentElement.dataset.kfCartType === 'drawer';

            KF.emit(KF.events.cartUpdate, {
              cart: cart,
              sections: result.data.sections,
              added: result.data,
              open: opensDrawer
            });

            return { added: result.data, cart: cart, opensDrawer: opensDrawer };
          });
      });
  }

  /* ----------------------------------------------------------- Cart items */

  class KFCartItemsElement extends HTMLElement {
    constructor() {
      super();
      this.onClick = this.onClick.bind(this);
      this.onChange = this.onChange.bind(this);
    }

    connectedCallback() {
      this.addEventListener('click', this.onClick);
      this.addEventListener('change', this.onChange);
    }

    disconnectedCallback() {
      this.removeEventListener('click', this.onClick);
      this.removeEventListener('change', this.onChange);
    }

    onClick(event) {
      if (!(event.target instanceof Element)) return;
      var remove = event.target.closest('[data-kf-cart-remove]');
      if (!remove) return;

      event.preventDefault();
      var line = remove.getAttribute('data-kf-cart-remove');
      this.change(line, 0, remove.getAttribute('data-kf-item-title'));
    }

    onChange(event) {
      if (!(event.target instanceof Element)) return;
      var input = event.target.closest('[data-kf-cart-quantity]');
      if (!input) return;

      var line = input.getAttribute('data-kf-cart-quantity');
      this.change(line, KF.parseNumber(input.value, 1));
    }

    change(line, quantity, title) {
      var self = this;

      mutate(window.routes.cart_change_url + '.js', { line: Number(line), quantity: quantity }, this).then(
        function (cart) {
          if (!cart) return;
          if (quantity === 0 && title) {
            KF.announce(title + ' removed from your cart.');
          }
          // Focus would otherwise be lost on the removed row.
          if (quantity === 0) {
            var focusTarget = self.querySelector('[data-kf-cart-quantity], [data-kf-cart-remove]');
            if (focusTarget) focusTarget.focus({ preventScroll: true });
          }
        }
      );
    }
  }

  /* ------------------------------------------------------------ Cart note */

  class KFCartNoteElement extends HTMLElement {
    constructor() {
      super();
      this.save = KF.debounce(this.save.bind(this), NOTE_DEBOUNCE);
      this.onInput = this.onInput.bind(this);
    }

    connectedCallback() {
      this.textarea = this.querySelector('textarea');
      this.status = this.querySelector('[data-kf-note-status]');
      if (!this.textarea) return;
      this.textarea.addEventListener('input', this.onInput);
    }

    disconnectedCallback() {
      if (this.textarea) this.textarea.removeEventListener('input', this.onInput);
    }

    onInput() {
      this.save();
    }

    save() {
      var self = this;
      var note = this.textarea.value;

      // The note does not change any rendered total, so this deliberately
      // skips the section re-render that other mutations request.
      fetch(window.routes.cart_update_url + '.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ note: note })
      })
        .then(function (response) {
          if (!response.ok) throw new Error('Could not save the note');
          if (self.status) {
            self.status.hidden = false;
            window.clearTimeout(self.statusTimer);
            self.statusTimer = window.setTimeout(function () {
              self.status.hidden = true;
            }, 2500);
          }
        })
        .catch(function (error) {
          if (window.console) console.warn('[Kofii Flow] ' + error.message);
        });
    }
  }

  /* ------------------------------------------------------ Recommendations */

  /**
   * Fetches Shopify's product recommendations for the first item in the cart
   * and renders them through `sections/cart-recommendations.liquid`. Uses the
   * default related intent rather than complementary, which returns nothing
   * unless a merchant has configured it in Search & Discovery.
   *
   * Deliberately silent on failure: recommendations are a nice-to-have, and an
   * error message where an upsell was meant to be is worse than nothing.
   */
  class KFCartRecommendationsElement extends HTMLElement {
    connectedCallback() {
      var productId = this.dataset.productId;
      if (!productId) return;

      var params = new URLSearchParams();
      params.set('product_id', productId);
      params.set('limit', this.dataset.limit || '3');
      params.set('section_id', 'cart-recommendations');

      var self = this;

      KF.fetchSection('/recommendations/products?' + params.toString())
        .then(function (doc) {
          var incoming = doc.querySelector('[data-kf-recommendations]');
          if (!incoming || !incoming.children.length) return;
          self.innerHTML = incoming.outerHTML;
        })
        .catch(function () {
          /* no recommendations, no message */
        });
    }
  }

  KF.define('kf-cart-items', KFCartItemsElement);
  KF.define('kf-cart-note', KFCartNoteElement);
  KF.define('kf-cart-recommendations', KFCartRecommendationsElement);

  KF.cart = {
    add: add,
    mutate: mutate,
    applySections: applySections,
    sectionIds: sectionIds
  };

  /* ---------------------------------------------- Open the drawer on add */

  KF.on(KF.events.cartUpdate, function (event) {
    if (!event.detail.open) return;

    var drawer = document.getElementById('kf-CartDrawer');
    if (!drawer || typeof drawer.open !== 'function') return;
    drawer.open();
  });
})();
