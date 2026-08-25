/* ==========================================================================
   <kf-video>
   --------------------------------------------------------------------------
   A click-to-play facade over a video.

   WHY A FACADE AND NOT JUST AN EMBED.
   A YouTube or Vimeo iframe pulls roughly a megabyte of script and cookies
   before anyone has decided to watch. On a marketing page that is usually the
   single largest thing on the route, and it lands squarely on the Lighthouse
   performance score the Theme Store measures. So the page ships a poster image
   and a button, and the player is built only once someone asks for it.

   The player markup lives in a <template>. That is the mechanism, not a
   convenience: content inside a template is inert — an <iframe src> in there
   makes no request and a <video> loads nothing — so Liquid can render the real
   player up front and still cost nothing until it is cloned out.

   Playing is therefore always user-initiated, which is also what makes sound
   allowed: the click grants the document the user activation that autoplay
   policies require. Nothing here ever starts on its own.

   Without JavaScript the poster and the button remain, and the button falls
   back to a link to the video's own page — see the section for that.
   ========================================================================== */

(function () {
  'use strict';

  if (!window.KF) return;
  var KF = window.KF;

  class KFVideoElement extends HTMLElement {
    constructor() {
      super();
      this.onActivate = this.onActivate.bind(this);
      this.playing = false;
    }

    connectedCallback() {
      this.trigger = this.querySelector('[data-kf-video-play]');
      this.frame = this.querySelector('[data-kf-video-frame]');
      this.template = this.querySelector('[data-kf-video-player]');

      if (!this.trigger || !this.frame || !this.template) return;

      // The button is a link until this runs, so that a no-script visitor is
      // sent somewhere real rather than left with a control that does nothing.
      // Now that there is something to play, it becomes a button.
      this.trigger.setAttribute('role', 'button');
      this.trigger.addEventListener('click', this.onActivate);
    }

    disconnectedCallback() {
      if (this.trigger) this.trigger.removeEventListener('click', this.onActivate);
    }

    onActivate(event) {
      event.preventDefault();
      if (this.playing) return;
      this.playing = true;

      var player = this.template.content.cloneNode(true);

      // Read the element back out of the fragment before it is appended —
      // appending empties the fragment, so querying it afterwards finds
      // nothing.
      var media = player.querySelector('video, iframe');

      this.frame.appendChild(player);
      this.setAttribute('data-playing', '');

      // The poster and the button are gone from view; make sure neither is
      // still reachable by keyboard behind the player.
      this.trigger.setAttribute('hidden', '');

      if (!media) return;

      if (media.tagName === 'VIDEO') {
        // Autoplay can still be refused — a low-power device, or a policy this
        // click did not satisfy. The controls are there either way, so a
        // refusal leaves a paused video the visitor can start themselves.
        var attempt = media.play();
        if (attempt && typeof attempt.catch === 'function') attempt.catch(function () {});
      }

      // Focus moves to the player so a keyboard visitor is not left on a
      // button that has just disappeared.
      if (media.focus) media.focus({ preventScroll: true });

      KF.announce(this.getAttribute('data-playing-label') || 'Video playing');
    }
  }

  KF.define('kf-video', KFVideoElement);
})();
