/* ==========================================================================
   <kf-marquee>
   --------------------------------------------------------------------------
   The scrolling itself is pure CSS — `@keyframes kf-marquee` in kf-motion.css,
   over two tracks duplicated in the markup. That runs with no JavaScript at
   all, and this element never touches it. What it adds is the two things CSS
   cannot do on its own:

   1. A pause control. WCAG 2.2 SC 2.2.2 requires a way to stop any motion that
      starts on its own and runs for more than five seconds. Pause-on-hover is
      not that mechanism — it does nothing for a keyboard or touch visitor. The
      button is rendered `hidden` in Liquid and revealed here, because a button
      that cannot work without this file should not be offered.

   2. Enough repeats to fill the viewport. `.kf-marquee__track` carries
      `min-width: 100%`, so a short item list gets stretched to the container
      and leaves a dead gap trailing it on every pass. Repeating the items
      until they span the container keeps the spacing even.

   Repeats are `inert` and `aria-hidden`: the items are announced once, and a
   link that appears four times must not collect four tab stops.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  /* A runaway `gap` or a hairline item could otherwise ask for thousands of
     clones. Nothing legitimate needs more than this. */
  var MAX_COPIES = 24;

  function contentWidth(track) {
    var kids = track.children;
    if (!kids.length) return 0;
    // `scrollWidth` would report the stretched track, not the items, because
    // of the `min-width: 100%`. Measure the span the items actually occupy.
    var first = kids[0].getBoundingClientRect();
    var last = kids[kids.length - 1].getBoundingClientRect();
    return last.right - first.left;
  }

  class KFMarqueeElement extends HTMLElement {
    constructor() {
      super();
      this.paused = false;
      this.lastWidth = 0;
      this.onToggle = this.onToggle.bind(this);
      this.onResize = this.onResize.bind(this);
    }

    connectedCallback() {
      this.viewport = this.querySelector('[data-kf-marquee]');
      this.tracks = Array.prototype.slice.call(this.querySelectorAll('[data-kf-marquee-track]'));
      this.button = this.querySelector('[data-kf-marquee-toggle]');

      if (!this.viewport || !this.tracks.length) return;

      // The authored items, kept aside so each refit rebuilds from the same
      // base rather than compounding the previous one.
      this.template = Array.prototype.map.call(this.tracks[0].children, function (node) {
        return node.cloneNode(true);
      });
      if (!this.template.length) return;

      this.fit();

      this.resize = new ResizeObserver(KF.debounce(this.onResize, 150));
      this.resize.observe(this);

      if (this.button) {
        this.button.hidden = false;
        this.button.addEventListener('click', this.onToggle);
      }

      // Flow Mode off or reduced motion means it should not be moving. The
      // stylesheet already stops the animation under reduced motion; this also
      // puts the button in the right state so it reads "Play", not "Pause".
      this.setPaused(!KF.motionAllowed());
    }

    disconnectedCallback() {
      if (this.resize) this.resize.disconnect();
      if (this.button) this.button.removeEventListener('click', this.onToggle);
    }

    onResize() {
      this.fit();
    }

    /* ------------------------------------------------------------- Filling */

    fit() {
      var width = this.viewport.clientWidth;
      // The width guard is not just an optimisation: this method rewrites the
      // subtree the ResizeObserver is watching, so without it a refit could
      // schedule the next one.
      if (!width || width === this.lastWidth) return;
      this.lastWidth = width;

      var base = this.template;

      this.tracks.forEach(function (track) {
        while (track.firstChild) track.removeChild(track.firstChild);
        base.forEach(function (node) {
          track.appendChild(node.cloneNode(true));
        });
      });

      var natural = contentWidth(this.tracks[0]);
      if (natural <= 0) return;

      // One copy already exists, so this is how many the track should end up
      // holding. Anything at or wider than the viewport needs no repeats.
      var copies = Math.min(Math.ceil(width / natural), MAX_COPIES);
      if (copies < 2) return;

      // Every track must get the SAME count, or the two stop lining up and the
      // loop visibly jumps when the animation restarts.
      this.tracks.forEach(function (track) {
        for (var c = 1; c < copies; c++) {
          base.forEach(function (node) {
            var clone = node.cloneNode(true);
            clone.setAttribute('aria-hidden', 'true');
            clone.setAttribute('inert', '');
            track.appendChild(clone);
          });
        }
      });
    }

    /* -------------------------------------------------------------- Paused */

    onToggle() {
      this.setPaused(!this.paused);
    }

    setPaused(paused) {
      this.paused = paused;

      // The shared rule in kf-motion.css keys off the element carrying
      // `.kf-marquee`, which is the inner viewport rather than this host.
      this.viewport.toggleAttribute('data-paused', paused);
      this.toggleAttribute('data-paused', paused);

      if (!this.button) return;
      var label = paused ? this.button.dataset.playLabel : this.button.dataset.pauseLabel;
      if (label) this.button.setAttribute('aria-label', label);
    }
  }

  KF.define('kf-marquee', KFMarqueeElement);
})();
