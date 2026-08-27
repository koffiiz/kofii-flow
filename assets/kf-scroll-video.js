/* ==========================================================================
   <kf-scroll-video>
   --------------------------------------------------------------------------
   Scroll drives the video's timeline. NOT scroll-jacking: sticky does the
   pinning, this only reads scroll and writes `currentTime`, and playback is
   never left running so no pause control is needed.

   THE CSS DECIDES whether any of it happens — `syncMode()` reads the stage's
   position and drives nothing unless pinned. `fail()` covers the other end,
   when the file never loads. Only ONE SEEK is in flight; see requestSeek.

   The reasoning for all of this is recorded in CLAUDE.md.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  /* Roughly one frame at 30fps. Below this a seek costs a decode and returns
     an identical picture, so it is skipped. */
  var MIN_SEEK_DELTA = 0.033;

  /* One frame at 60Hz, the reference the smoothing rate is expressed against. */
  var FRAME_MS = 1000 / 60;

  /* Under a twentieth of a percent of the timeline. Past this the easing is
     chasing a difference no frame could show, so it stops. */
  var SETTLED = 0.0005;

  /* Quiet before the video counts as at rest — longer than the gap between
     two wheel notches, so a steady scroll is not read as a series of stops. */
  var IDLE_MS = 150;

  /* Below this the drift has nothing left to give back. */
  var DRIFT_SETTLED = 0.001;

  /* Wait for a duration before giving the video back as a plain player.
     Generous: a slow connection should not lose the effect. */
  var READY_TIMEOUT = 6000;

  class KFScrollVideoElement extends HTMLElement {
    constructor() {
      super();
      this.onScroll = this.onScroll.bind(this);
      this.tick = this.tick.bind(this);
      this.onReady = this.onReady.bind(this);
      this.onSeeked = this.onSeeked.bind(this);

      this.frame = null;
      this.lastFrame = 0;
      this.pendingTime = null;
      this.seeking = false;
      this.duration = 0;
      this.startTime = 0;
      this.span = 0;
      this.active = -1;

      // Where the scroll is, and where the picture has eased to so far.
      this.target = 0;
      this.current = 0;
      this.retain = 0;

      // Seconds of playback added on top of the scroll position while at rest.
      this.drift = 0;
      this.driftCap = 0;
      this.lastScrollAt = 0;

      // Whether the CSS actually pinned this. Nothing is driven until it did.
      this.pinned = false;
    }

    connectedCallback() {
      /* `video_tag` takes no arbitrary data attributes, so the player is
         found by tag, with the data hook preferred if it is ever added. */
      this.video = this.querySelector('[data-kf-scrub-video]') || this.querySelector('video');
      this.region = this.querySelector('[data-kf-scrub-region]');
      this.stage = this.querySelector('[data-kf-scrub-stage]');
      this.captions = Array.prototype.slice.call(
        this.querySelectorAll('[data-kf-scrub-caption]')
      );

      if (!this.video || !this.region || !this.stage) return;

      /* Reduced motion, or Flow Mode off. The CSS has already declined to pin
         anything; leaving the controls on is what makes it a usable video. */
      if (!KF.motionAllowed()) return;

      /* Retention per 60Hz frame: 0 follows exactly, 0.9 is the heaviest
         follow. Clamped below 1, which would never arrive. */
      this.retain = Math.min(0.95, Math.max(0, KF.parseNumber(this.dataset.smoothing, 0) / 100));

      // Merchant setting in milliseconds; everything below works in seconds.
      this.driftCap = Math.max(0, KF.parseNumber(this.dataset.rest, 0)) / 1000;

      this.starts = this.captions.map(function (caption) {
        return Math.min(100, Math.max(0, KF.parseNumber(caption.dataset.start, 0))) / 100;
      });

      this.video.addEventListener('loadedmetadata', this.onReady);
      this.video.addEventListener('seeked', this.onSeeked);
      if (this.video.readyState >= 1) this.onReady();

      /* Buffering up front would put a video on the critical path of a page
         nobody has scrolled to. The rest is pulled in as the region nears. */
      this.warm();

      /* If no duration arrives, `fail()` puts the section back to an ordinary
         player rather than leaving a pinned, frozen one. */
      var self = this;
      this.failTimer = setTimeout(function () {
        if (!self.duration) self.fail();
      }, READY_TIMEOUT);

      window.addEventListener('scroll', this.onScroll, { passive: true });
      this.onResize = KF.debounce(this.syncMode.bind(this), 200);
      window.addEventListener('resize', this.onResize, { passive: true });
      this.onScroll();

      this.releaseBlockSelect = KF.onBlockSelect(function (block) {
        if (!self.contains(block)) return;
        var caption = block.closest('[data-kf-scrub-caption]');
        var index = self.captions.indexOf(caption);
        if (index === -1) return;

        /* Show the merchant the frame their caption belongs to. Deliberately
           without scrolling the page — the editor owns that. */
        self.setActive(index);
        if (self.duration) self.requestSeek(self.timeAt(self.starts[index]));
      });
    }

    disconnectedCallback() {
      window.removeEventListener('scroll', this.onScroll);
      if (this.onResize) window.removeEventListener('resize', this.onResize);
      if (this.video) {
        this.video.removeEventListener('loadedmetadata', this.onReady);
        this.video.removeEventListener('seeked', this.onSeeked);
      }
      if (this.frame) cancelAnimationFrame(this.frame);
      if (this.failTimer) clearTimeout(this.failTimer);
      if (this.warmer) this.warmer.disconnect();
      if (this.releaseBlockSelect) this.releaseBlockSelect();
    }

    /* --------------------------------------------------------------- Buffer */

    warm() {
      var self = this;

      if (!('IntersectionObserver' in window)) {
        this.video.preload = 'auto';
        return;
      }

      this.warmer = new IntersectionObserver(
        function (entries) {
          if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
          self.video.preload = 'auto';
          self.prime();
          // Buffering only needs asking for once.
          self.warmer.disconnect();
          self.warmer = null;
        },
        // A viewport of lead time, so the buffer is warm before it is needed.
        { rootMargin: '100% 0px' }
      );

      this.warmer.observe(this.region);
    }

    /**
     * Forces the fetch. `preload` is advisory and Safari on a phone ignores
     * it, leaving readyState 0 and nothing to seek in. A muted inline video
     * may autoplay without a gesture, so play-then-pause loads it — the one
     * place this file starts playback, and it stops in the same breath.
     */
    prime() {
      if (this.video.readyState >= 1) return;

      var attempt = this.video.play();
      if (!attempt || !attempt.then) return;

      var video = this.video;
      attempt
        .then(function () { video.pause(); })
        .catch(function () {
          /* Refused. The failure timer is what recovers from here. */
        });
    }

    /**
     * Give up and hand back an ordinary video. Pinning is CSS, so the
     * attribute is what releases it — `[data-scrub-failed]` in the stylesheet.
     * Without it a video that never loads stays pinned for the full scroll
     * length, holding one frame with no controls.
     */
    fail() {
      this.video.controls = true;
      var root = this.closest('.kf-scrub');
      if (root) root.setAttribute('data-scrub-failed', '');
    }

    onReady() {
      // A stream still reports Infinity here; there is nothing to map onto.
      if (!isFinite(this.video.duration) || this.video.duration <= 0) return;
      this.duration = this.video.duration;
      this.resolveTrim();
      this.syncMode();

      if (this.failTimer) {
        clearTimeout(this.failTimer);
        this.failTimer = null;
      }

      this.setAttribute('data-ready', '');
      this.update();
    }

    /**
     * Takes the video over only when the CSS has actually pinned it.
     *
     * Pinning is a stylesheet decision — width, reduced motion, a merchant
     * opt-in — that the script cannot infer, so it asks by reading the stage's
     * position. Without this it drives a video the CSS is showing as an
     * ordinary stacked player: controls stripped and frames changing under a
     * scroll that pins nothing. Re-run on resize.
     */
    syncMode() {
      if (!this.stage || !this.video) return;

      var pinned = getComputedStyle(this.stage).position === 'sticky';
      if (pinned === this.pinned) return;
      this.pinned = pinned;

      // Only a pinned video has a timeline the scroll drives; anywhere else
      // the controls are the only way to play it.
      this.video.controls = !pinned;
      if (pinned && this.duration) this.update();
    }

    /**
     * Which stretch of the video the scroll is spread over. Cannot be settled
     * in Liquid: the duration to clamp the merchant's seconds against only
     * arrives with the metadata. Captions are keyed to progress rather than
     * absolute time, so a trim needs no adjustment there.
     */
    resolveTrim() {
      var duration = this.duration;

      var start = KF.parseNumber(this.dataset.trimStart, 0);
      var end = KF.parseNumber(this.dataset.trimEnd, duration);

      start = Math.min(Math.max(start, 0), duration);
      end = Math.min(Math.max(end, 0), duration);

      /* An inverted or collapsed trim would pin the video to a single frame
         for the whole scroll, which reads as broken rather than as trimmed.
         A merchant who mistypes gets the untrimmed video instead. */
      if (end - start < 0.1) {
        start = 0;
        end = duration;
      }

      this.startTime = start;
      this.span = end - start;
    }

    /** Absolute time for a 0..1 position along the scrubbed stretch. */
    timeAt(progress) {
      return this.startTime + progress * this.span;
    }

    /* --------------------------------------------------------------- Scroll */

    onScroll() {
      /* Stamped from the same clock rAF hands to tick(), so "how long since
         the last scroll" is a straight subtraction. */
      this.lastScrollAt = performance.now();
      this.measure();
      this.run();
    }

    /** Where the scroll says we are: 0 at the top of the pinned stretch, 1 at
     *  the end of it. The stage occupies the last viewport-height of the
     *  region, so that is exactly the distance the video is spread over. */
    measure() {
      var rect = this.region.getBoundingClientRect();

      /* The STAGE, not `window.innerHeight`. On mobile they disagree: the
         region is sized in `svh` while `innerHeight` grows as browser chrome
         hides mid-scroll, which would shrink the travel during the gesture. */
      var travel = rect.height - this.stage.offsetHeight;

      if (travel <= 0) {
        this.target = 0;
        return;
      }

      this.target = Math.min(1, Math.max(0, -rect.top / travel));
    }

    run() {
      if (this.frame) return;
      this.lastFrame = 0;
      this.frame = requestAnimationFrame(this.tick);
    }

    /**
     * Eases the shown position toward the scroll position — scroll input is
     * discrete, so anything pinned rigidly to it inherits that staircase.
     * FRAME-RATE INDEPENDENT: retention raised to the power of
     * elapsed-over-one-frame, so 60Hz and 120Hz settle in the same time. A
     * long frame is clamped so a backgrounded tab does not jump on return.
     */
    tick(now) {
      this.frame = null;
      if (!this.duration || !this.pinned) return;

      var elapsed = this.lastFrame ? Math.min(now - this.lastFrame, 100) : FRAME_MS;
      this.lastFrame = now;

      var factor = this.retain > 0
        ? 1 - Math.pow(this.retain, elapsed / FRAME_MS)
        : 1;

      this.current += (this.target - this.current) * factor;

      // Close enough that another frame would not change a pixel.
      if (Math.abs(this.target - this.current) < SETTLED) this.current = this.target;

      var drifting = this.advanceDrift(now, elapsed, factor);

      this.apply(this.current);

      if (this.current === this.target && !drifting) {
        this.lastFrame = 0;
        return;
      }

      this.frame = requestAnimationFrame(this.tick);
    }

    /**
     * Plays on briefly at rest, then gives that time back on the next scroll.
     * IT MUST BE GIVEN BACK — scroll is the source of truth, and an offset
     * left to accumulate would drift the video away from it. Returns whether
     * there is still work to do, so the loop knows to run on.
     */
    advanceDrift(now, elapsed, factor) {
      if (this.driftCap <= 0) return false;

      var atRest = now - this.lastScrollAt > IDLE_MS;

      if (!atRest) {
        // Hand it back. At smoothing 0 the factor is 1 and this is immediate,
        // which is consistent with the rest of the element having no easing.
        this.drift -= this.drift * factor;
        if (this.drift < DRIFT_SETTLED) this.drift = 0;
        return this.drift > 0;
      }

      // Real time, so the footage runs at the rate it was shot at.
      this.drift = Math.min(this.driftCap, this.drift + elapsed / 1000);
      return this.drift < this.driftCap;
    }

    /** Snap straight to the scroll position, with no easing. Used once the
     *  video is ready, where easing in from zero would look like a glitch. */
    update() {
      this.measure();
      this.current = this.target;
      this.drift = 0;
      this.apply(this.current);
    }

    apply(progress) {
      /* The rail reports the SCROLL, not the drift — it answers "how much of
         this section is left", which the drift does not change. */
      this.style.setProperty('--kf-scrub-progress', progress.toFixed(4));

      /* Clamped to the trimmed end so playing on at the last frame cannot run
         past the stretch the merchant chose. */
      var end = this.startTime + this.span;
      this.requestSeek(Math.min(this.timeAt(progress) + this.drift, end));

      // Captions follow the scroll too; the drift is a few frames of footage,
      // not a move through the story.
      this.syncCaptions(progress);
    }

    /* ----------------------------------------------------------- Seeking */

    requestSeek(time) {
      this.pendingTime = time;
      if (this.seeking) return;
      this.performSeek();
    }

    performSeek() {
      var time = this.pendingTime;
      this.pendingTime = null;
      if (time === null) return;

      if (Math.abs(time - this.video.currentTime) < MIN_SEEK_DELTA) return;

      this.seeking = true;
      try {
        this.video.currentTime = time;
      } catch (error) {
        // Not seekable yet. The next scroll will ask again.
        this.seeking = false;
      }
    }

    onSeeked() {
      this.seeking = false;
      // A newer position may have arrived while that seek was in flight.
      this.performSeek();
    }

    /* --------------------------------------------------------- Captions */

    syncCaptions(progress) {
      if (!this.captions.length) return;

      var index = 0;
      for (var i = 0; i < this.starts.length; i++) {
        if (progress >= this.starts[i]) index = i;
      }

      this.setActive(index);
    }

    setActive(index) {
      if (index === this.active) return;
      this.active = index;

      this.captions.forEach(function (caption, i) {
        caption.toggleAttribute('data-active', i === index);
      });
    }
  }

  KF.define('kf-scroll-video', KFScrollVideoElement);
})();
