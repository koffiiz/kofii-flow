/**
 * Kofii Flow — 3D model support
 * ---------------------------------------------------------------------------
 * `model_viewer_tag` emits a <model-viewer> element, but nothing drives it
 * until Shopify's own features are loaded. This file asks for them and wires
 * each element up.
 *
 * Two separate features, requested independently so one failing does not take
 * the other with it:
 *   model-viewer-ui  the in-page viewer — orbit, zoom, the poster/play state
 *   shopify-xr       the "View in your space" button on AR-capable devices
 *
 * Loaded only by a section that actually has a model on the page, so a store
 * with no 3D media never pays for it.
 *
 * Failure is quiet by design. The tag is rendered with `reveal: 'interaction'`,
 * so an unloaded model still shows its poster image: a blocked or failed
 * feature request leaves a picture of the product, not an empty frame.
 */

(function () {
  /** Shopify's loader arrives with content_for_header; it may not be there. */
  function canLoad() {
    return !!(window.Shopify && typeof window.Shopify.loadFeatures === 'function');
  }

  function setupViewers(errors) {
    if (errors || !window.Shopify || !window.Shopify.ModelViewerUI) return;

    document.querySelectorAll('model-viewer').forEach(function (element) {
      // A section re-render in the Theme Editor hands back fresh elements, but
      // a variant swap may not — so each element is only ever wrapped once.
      if (element.dataset.kfModelReady === 'true') return;
      element.dataset.kfModelReady = 'true';

      try {
        new window.Shopify.ModelViewerUI(element);
      } catch (error) {
        // One bad model must not take the rest of the gallery with it.
        delete element.dataset.kfModelReady;
      }
    });
  }

  function setupXR(errors) {
    if (errors || !window.ShopifyXR) return;

    // Every model on the page is registered in one pass; ShopifyXR then finds
    // the buttons itself by `data-shopify-model3d-id`.
    document.querySelectorAll('[data-kf-model-json]').forEach(function (script) {
      try {
        window.ShopifyXR.addModels(JSON.parse(script.textContent));
      } catch (error) {
        /* malformed payload — the button stays hidden, which is the right
           outcome for a model we cannot describe */
      }
    });

    window.ShopifyXR.setupXRElements();
  }

  function load() {
    if (!canLoad()) return;

    window.Shopify.loadFeatures([
      { name: 'model-viewer-ui', version: '1.0', onLoad: setupViewers },
      { name: 'shopify-xr', version: '1.0', onLoad: setupXR },
    ]);
  }

  if (window.KF && window.KF.ready) {
    window.KF.ready(load);
    window.KF.onSectionLoad(load);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
