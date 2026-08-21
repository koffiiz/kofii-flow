/* ==========================================================================
   <kf-predictive-search>
   --------------------------------------------------------------------------
   Fetches Shopify's predictive search endpoint, rendered through
   `sections/predictive-search.liquid`, and swaps the results in place.

   Implements the WAI-ARIA combobox pattern:
     - the input is role="combobox" with aria-expanded and aria-controls
     - results are role="listbox" containing role="option" items
     - Arrow keys move aria-activedescendant without moving DOM focus
     - Enter opens the active option; Escape closes and clears

   Falls back to a plain GET to /search if fetch fails or JS never loads —
   the form is a real form with a real action.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  var DEBOUNCE = 220;
  var MIN_LENGTH = 2;

  class KFPredictiveSearchElement extends HTMLElement {
    constructor() {
      super();
      this.controller = null;
      this.activeIndex = -1;
      this.onInput = KF.debounce(this.search.bind(this), DEBOUNCE);
      this.onKeydown = this.onKeydown.bind(this);
      this.onReset = this.onReset.bind(this);
    }

    connectedCallback() {
      this.input = this.querySelector('input[type="search"]');
      this.results = this.querySelector('[data-kf-results]');
      this.status = this.querySelector('[data-kf-search-status]');
      this.resetButton = this.querySelector('[data-kf-search-reset]');

      if (!this.input || !this.results) return;

      this.input.addEventListener('input', this.onInput);
      this.input.addEventListener('keydown', this.onKeydown);
      if (this.resetButton) this.resetButton.addEventListener('click', this.onReset);

      this.close();
    }

    disconnectedCallback() {
      this.abort();
      if (this.input) {
        this.input.removeEventListener('input', this.onInput);
        this.input.removeEventListener('keydown', this.onKeydown);
      }
      if (this.resetButton) this.resetButton.removeEventListener('click', this.onReset);
    }

    get query() {
      return this.input.value.trim();
    }

    get sectionId() {
      return this.dataset.sectionId || 'predictive-search';
    }

    get options() {
      return Array.prototype.slice.call(this.results.querySelectorAll('[role="option"]'));
    }

    abort() {
      if (this.controller) {
        this.controller.abort();
        this.controller = null;
      }
    }

    buildUrl(query) {
      var base = (window.routes && window.routes.predictive_search_url) || '/search/suggest';
      var params = new URLSearchParams();
      params.set('q', query);
      params.set('section_id', this.sectionId);
      params.set('resources[limit]', this.dataset.limit || '5');
      params.set('resources[limit_scope]', 'each');
      if (this.dataset.types) params.set('resources[type]', this.dataset.types);
      return base + '?' + params.toString();
    }

    search() {
      var query = this.query;

      if (query.length < MIN_LENGTH) {
        this.close();
        return;
      }

      this.abort();
      this.controller = new AbortController();
      this.setAttribute('data-loading', '');

      var self = this;

      KF.fetchSection(this.buildUrl(query), this.controller.signal)
        .then(function (doc) {
          var incoming = doc.querySelector('[data-kf-results]');
          if (!incoming) throw new Error('Predictive search returned no results container');
          self.render(incoming.innerHTML);
        })
        .catch(function (error) {
          if (error.name === 'AbortError') return;
          // Leave the form usable: submitting still performs a full search.
          self.close();
          if (window.console) console.warn('[Kofii Flow] Predictive search failed', error);
        })
        .finally(function () {
          self.removeAttribute('data-loading');
          self.controller = null;
        });
    }

    render(html) {
      this.results.innerHTML = html;
      this.activeIndex = -1;
      this.input.removeAttribute('aria-activedescendant');
      this.open();

      var count = this.options.length;
      if (this.status) {
        this.status.textContent = count
          ? count + ' suggestions available'
          : 'No results found';
      }
    }

    open() {
      this.setAttribute('open', '');
      this.input.setAttribute('aria-expanded', 'true');
      this.results.removeAttribute('hidden');
    }

    close() {
      this.removeAttribute('open');
      this.input.setAttribute('aria-expanded', 'false');
      this.input.removeAttribute('aria-activedescendant');
      this.results.setAttribute('hidden', '');
      this.activeIndex = -1;
    }

    onReset(event) {
      event.preventDefault();
      this.input.value = '';
      this.abort();
      this.close();
      this.input.focus();
    }

    onKeydown(event) {
      if (event.key === 'Escape') {
        if (this.hasAttribute('open')) {
          event.preventDefault();
          this.close();
        }
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!this.hasAttribute('open')) return;
        event.preventDefault();
        this.move(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (event.key === 'Enter' && this.activeIndex > -1) {
        var option = this.options[this.activeIndex];
        var link = option && (option.matches('a') ? option : option.querySelector('a'));
        if (link) {
          event.preventDefault();
          link.click();
        }
      }
    }

    move(direction) {
      var options = this.options;
      if (!options.length) return;

      options.forEach(function (option) {
        option.setAttribute('aria-selected', 'false');
      });

      this.activeIndex += direction;
      if (this.activeIndex < 0) this.activeIndex = options.length - 1;
      if (this.activeIndex >= options.length) this.activeIndex = 0;

      var active = options[this.activeIndex];
      active.setAttribute('aria-selected', 'true');
      this.input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  KF.define('kf-predictive-search', KFPredictiveSearchElement);
})();
