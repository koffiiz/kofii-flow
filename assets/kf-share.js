/* ==========================================================================
   <kf-share>
   --------------------------------------------------------------------------
   Uses the native Web Share sheet where the browser offers it (most mobile
   browsers), and falls back to copying the URL to the clipboard everywhere
   else. Both paths give the same visible confirmation.

   If neither API is available the element leaves its contents alone — the
   markup includes a real link to the page, so there is always something that
   works.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFShareElement extends HTMLElement {
    constructor() {
      super();
      this.onClick = this.onClick.bind(this);
    }

    connectedCallback() {
      this.button = this.querySelector('[data-kf-share-button]');
      this.feedback = this.querySelector('[data-kf-share-feedback]');
      if (!this.button) return;

      this.addEventListener('click', this.onClick);
    }

    disconnectedCallback() {
      this.removeEventListener('click', this.onClick);
      window.clearTimeout(this.resetTimer);
    }

    get shareUrl() {
      // Read at click time, not at connect time: the variant picker rewrites
      // the URL, and a shopper sharing a blue shirt should not send the red one.
      return this.dataset.url || window.location.href;
    }

    onClick(event) {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('[data-kf-share-button]')) return;

      event.preventDefault();
      var url = this.shareUrl;
      var title = this.dataset.title || document.title;
      var self = this;

      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function (error) {
          // A shopper dismissing the share sheet is not an error.
          if (error && error.name === 'AbortError') return;
          self.copy(url);
        });
        return;
      }

      this.copy(url);
    }

    copy(url) {
      var self = this;

      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        this.notify(this.dataset.errorText || 'Copy this page address to share it');
        return;
      }

      navigator.clipboard
        .writeText(url)
        .then(function () {
          self.notify(self.dataset.copiedText || 'Link copied');
        })
        .catch(function () {
          self.notify(self.dataset.errorText || 'Could not copy the link');
        });
    }

    notify(message) {
      if (this.feedback) {
        this.feedback.textContent = message;
        this.feedback.hidden = false;

        var self = this;
        window.clearTimeout(this.resetTimer);
        this.resetTimer = window.setTimeout(function () {
          self.feedback.hidden = true;
        }, 3000);
      }
      KF.announce(message);
    }
  }

  KF.define('kf-share', KFShareElement);
})();
