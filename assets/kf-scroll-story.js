/* ==========================================================================
   <kf-scroll-story>
   --------------------------------------------------------------------------
   Marks which story step is currently being read, so the pinned media can
   cross-fade to match.

   Explicitly NOT scroll-jacking. The page scrolls at its own speed, `position:
   sticky` does the pinning, and this element only sets `data-active`. Nothing
   here intercepts the wheel, fakes momentum or drives scrollTop — those break
   keyboard paging, trackpads and screen readers, and they are the reason
   scrollytelling has a bad reputation.

   Activation uses a band across the middle of the viewport (via rootMargin),
   so a step becomes active as it crosses the centre rather than the moment it
   peeks in from the bottom. That keeps the media in step with what is actually
   being read.

   Degradation: with no JavaScript the CSS never switches to the pinned layout
   at all — each step shows its own media inline, in order. Nothing depends on
   this file running.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFScrollStoryElement extends HTMLElement {
    constructor() {
      super();
      this.active = -1;
    }

    connectedCallback() {
      this.steps = Array.prototype.slice.call(this.querySelectorAll('[data-kf-story-step]'));
      this.frames = Array.prototype.slice.call(this.querySelectorAll('[data-kf-story-frame]'));

      if (this.steps.length === 0 || this.frames.length === 0) return;

      this.observe();
      this.setActive(0);

      // Theme Editor: selecting a step in the sidebar should show its media,
      // otherwise a merchant editing step 3 is looking at step 1's image.
      var self = this;
      this.releaseBlockSelect = KF.onBlockSelect(function (block) {
        if (!self.contains(block)) return;
        var index = self.steps.indexOf(block.closest('[data-kf-story-step]'));
        if (index > -1) self.setActive(index);
      });
    }

    disconnectedCallback() {
      if (this.observer) this.observer.disconnect();
      if (this.releaseBlockSelect) this.releaseBlockSelect();
    }

    observe() {
      var self = this;

      this.observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var index = self.steps.indexOf(entry.target);
            if (index > -1) self.setActive(index);
          });
        },
        // A thin band across the middle of the viewport.
        { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
      );

      this.steps.forEach(function (step) {
        self.observer.observe(step);
      });
    }

    setActive(index) {
      if (index === this.active) return;
      this.active = index;

      this.frames.forEach(function (frame, i) {
        frame.toggleAttribute('data-active', i === index);
      });

      this.steps.forEach(function (step, i) {
        step.toggleAttribute('data-active', i === index);
      });
    }
  }

  KF.define('kf-scroll-story', KFScrollStoryElement);
})();
