# CLAUDE.md — Kofii Flow

Architectural rules for anyone (human or AI) modifying this theme.
**Read this before writing code. It is not optional context.**

Kofii Flow is a Shopify Online Store 2.0 theme. Philosophy: *beautiful storefronts that flow*.
It is original work — not a fork or reskin of Dawn, Prestige, Impact, Motion, or any other theme.

---

## 1. The rules that matter most

1. **Search before you create.** A component almost certainly exists. Check `snippets/`, `blocks/`, and the CSS in `assets/` before writing new markup. Duplicated components are the single fastest way to ruin this theme.
2. **One motion system.** All animation goes through Kofii Motion (`kf-motion.css`, `kf-motion.js`, `snippets/kf-motion-attrs.liquid`). Never put an `IntersectionObserver`, a scroll listener, or `@keyframes` inside a section.
3. **One product card.** `snippets/kf-product-card.liquid`. Every section that lists products renders it.
4. **One button.** `snippets/kf-button.liquid`. Never hand-write `.kf-button` markup.
5. **One media frame.** `snippets/kf-media.liquid`. Never hand-write `<img>` in a section.
6. **No hardcoded values.** Colors, spacing, radii, durations and easings come from tokens. If a value you need has no token, add a token — do not inline a magic number.
7. **Sections pick a color scheme, never raw colors.**
8. **No new dependencies** without an explicit, written justification. No React, Vue, jQuery, Tailwind, GSAP, Swiper. Native browser APIs only.
9. **Accessibility is not negotiable.** Keyboard, focus, ARIA and contrast come before any visual effect.
10. **Filters are not allowed on `{% render %}` arguments.** Resolve them first with `assign`. This applies to `| t`, `| default`, `| money` — everything. Theme Check catches it; save yourself the round trip.
11. **No placeholder code.** Do not ship `TODO: implement later` for anything a merchant would reasonably expect to work. If something is not built, say so in the roadmap below rather than faking it.
12. **Never put a literal `}` inside `{{ … }}`.** Shopify ends an output tag at the *first* `}` (the scanner is `/\}\}?/`), so one brace inside truncates the tag and the theme is rejected on upload — "not properly terminated". Nothing local catches it: it is legal Liquid, so the validator used to pass and Theme Check still does. Assign the value in a `{% liquid %}` tag instead, where the scanner looks for `%}` and a bare `}` is harmless. JSON-LD `{search_term_string}` templates are the usual way to hit this. `npm run validate` now fails on it.

---

## 2. Architecture map

```
assets/
  kf-tokens.css          Layer A design tokens + color scheme derivations + Flow Mode
  kf-base.css            Reset, typography, container/section/grid/stack primitives
  kf-components.css      Button, badge, media, card, form, drawer, block styles
  kf-motion.css          Kofii Motion presets, parallax, marquee, reduced motion
  kf-utilities.css       Curated utilities only
  component-*.css        Reusable component styles, loaded by the sections that need them
  section-*.css          Section-specific styles, loaded by that section
  kf-core.js             The only always-loaded script. `window.KF`.
  kf-motion.js           The animation engine
  kf-*.js                One Custom Element per file, loaded by the section that needs it

blocks/                  Theme blocks — reusable content primitives (@theme)
  _*.liquid              Private blocks; only usable where explicitly allowed

snippets/                Developer-facing reusable Liquid
sections/                Sections + section groups
templates/               JSON templates
config/                  settings_schema.json (Layer B tokens), settings_data.json
locales/                 Storefront strings
.dev/validate.mjs        Local validator — run it after every change
```

### Two-layer design tokens

- **Layer A** — `assets/kf-tokens.css` declares every token with a static default.
- **Layer B** — `snippets/kf-css-variables.liquid` overrides the merchant-controlled subset inline in `<head>`.

Consequences: the theme renders correctly even with missing settings, the Theme Editor updates live, and nothing needs an extra request. **Only merchant-controllable tokens belong in Layer B.**

Derived color tokens (`--kf-color-border`, `--kf-color-muted`, shadows) are declared on `.kf-scheme` in `kf-tokens.css`, **not** on `:root`. This is deliberate: a custom property is substituted where it is declared, not where it is inherited, so a derived token on `:root` would never pick up a section's scheme colors.

### color_scheme_group constraints

Shopify rejects the theme on upload if these are violated, so they are worth knowing before editing `config/settings_schema.json`:

- `definition` accepts only `header`, `color` and `color_background`.
- `role` accepts **only** these keys: `background`, `text`, `links`, `icons`, `primary_button`, `on_primary_button`, `primary_button_border`, `secondary_button`, `on_secondary_button`, `secondary_button_border`.
- **`shadow` is not a role.** It is a perfectly valid definition *id* — Shopify's own reference example defines one — but mapping it in `role` is an error. Kofii Flow defines `shadow` and reads it in Liquid as `scheme.settings.shadow`, which needs no role mapping.

`npm run validate` enforces all of the above, plus the range rules that also block an upload: `min < max`, `(max - min)` divisible by `step`, at least 3 and at most 101 steps, the default inside the range **and landing on a step**, and `unit` no longer than **3 characters**. The last three are the ones that look fine and still get rejected — a 1-to-2 range, a default of 68 in a 40/90/5 range, or `"unit": "rows"`. `unit` is a suffix drawn beside the value, not a word: when the unit carries the meaning, put the word in the label.

---

## 3. Kofii Motion

Declarative and CSS-first. Liquid emits intent, CSS owns every visual state, JS only adds `data-kf-inview`.

```liquid
<div class="kf-hero__content" {% render 'kf-motion-attrs', motion: section.settings %}>
```

**The parameter is `motion:`, not `settings:`** — passing `settings:` would shadow the global `settings` object and break the theme-level motion defaults.

### Safety model — do not weaken this

- Initial (hidden) states are scoped to `.kf-motion` on `<html>`.
- That class is added by an inline `<head>` script **only** when motion is allowed.
- A 2.5s failsafe removes it if `kf-motion.js` never boots.
- `html:not(.kf-motion) [data-kf-animate]` forces everything visible.

Net effect: no JS, blocked JS, failed JS, reduced motion or Flow Mode off all leave content fully visible. **Never make an element's visibility depend on JavaScript succeeding.**

### Never hide an animated element with `clip-path`

`IntersectionObserver` computes the intersection rect **after** clipping. An element hidden with `clip-path: inset(100% 0 0 0)` therefore has zero area and reports `intersectionRatio: 0`, which is below any non-zero threshold — so the engine never sees it enter the viewport, never adds `data-kf-inview`, and the element stays hidden **permanently**.

Measured in-browser, at `threshold: 0`:

| Hidden by | isIntersecting | ratio |
| --- | --- | --- |
| `clip-path` | true | **0.00** |
| `mask` | true | 1.00 |
| `opacity` | true | 1.00 |
| `transform: scaleY(0)` | true | 1.00 |

The wipe presets (`clip-up`, `clip-left`, `clip-right`, `reveal`) keep their names but are implemented with `mask-size`. A mask also fails safe: with no mask support the element is simply visible, whereas a broken `clip-path` hides content for good. Hide with `opacity`, `transform`, `filter` or `mask` — never `clip-path`.

### Never play in the same frame the element is styled

A reveal must be *painted* in its hidden state before it changes, or the browser resolves both styles in one recalculation and no transition runs. This happens on first load above the fold, and every time the Theme Editor re-renders a section that is on screen.

`kf-motion.js` therefore defers every play by two animation frames (`nextFrames`). Do not remove that indirection to "simplify" the engine.

It is hardest to spot on the wipe presets, where *never animated* and *finished animating* look identical — verify with `transitionstart` / `transitionend` timings, not by whether the element ended up visible.

### Shared animation settings

Copy this block into a section schema to expose the full set. Include only what the section genuinely needs.

```json
{ "type": "header", "content": "Motion" },
{ "type": "select", "id": "animation", "label": "Animation",
  "options": [
    { "value": "none", "label": "None" },
    { "value": "fade", "label": "Fade" },
    { "value": "fade-up", "label": "Fade up" },
    { "value": "fade-down", "label": "Fade down" },
    { "value": "fade-left", "label": "Fade left" },
    { "value": "fade-right", "label": "Fade right" },
    { "value": "scale-up", "label": "Scale" },
    { "value": "blur-in", "label": "Blur" },
    { "value": "clip-up", "label": "Clip reveal" },
    { "value": "reveal", "label": "Editorial reveal" }
  ],
  "default": "none" },
{ "type": "select", "id": "animation_duration", "label": "Duration",
  "options": [
    { "value": "theme", "label": "Theme default" },
    { "value": "fast", "label": "Fast" },
    { "value": "normal", "label": "Normal" },
    { "value": "slow", "label": "Slow" },
    { "value": "custom", "label": "Custom" }
  ],
  "default": "theme" },
{ "type": "range", "id": "animation_duration_custom", "label": "Custom duration",
  "min": 200, "max": 2000, "step": 50, "unit": "ms", "default": 700 },
{ "type": "range", "id": "animation_delay", "label": "Delay",
  "min": 0, "max": 1000, "step": 50, "unit": "ms", "default": 0 },
{ "type": "select", "id": "animation_easing", "label": "Easing",
  "options": [
    { "value": "theme", "label": "Theme default" },
    { "value": "standard", "label": "Standard" },
    { "value": "smooth", "label": "Smooth" },
    { "value": "out", "label": "Ease out" },
    { "value": "spring", "label": "Spring-like" }
  ],
  "default": "theme" },
{ "type": "select", "id": "animation_trigger", "label": "Trigger",
  "options": [
    { "value": "scroll", "label": "On scroll" },
    { "value": "load", "label": "On load" }
  ],
  "default": "scroll" },
{ "type": "select", "id": "animation_replay", "label": "Replay",
  "options": [
    { "value": "once", "label": "Once" },
    { "value": "always", "label": "Every time" }
  ],
  "default": "once" },
{ "type": "checkbox", "id": "animation_stagger", "label": "Stagger children", "default": false },
{ "type": "range", "id": "animation_stagger_delay", "label": "Stagger delay",
  "min": 0, "max": 300, "step": 10, "unit": "ms", "default": 80 },
{ "type": "range", "id": "animation_intensity", "label": "Intensity",
  "min": 50, "max": 200, "step": 10, "unit": "%", "default": 100 }
```

### Stagger

Put `data-kf-stagger` on the **parent** (via `animation_stagger: true`). The engine claims every descendant with `data-kf-animate`, marks them `data-kf-managed`, observes only the parent, and assigns each child `index * step` delay. Children are never observed individually.

**The children must each carry `data-kf-animate`.** If only the parent has it, there are no descendants to claim: the container animates as one block and the stagger setting silently does nothing. In a section that means the list and the items get different attributes:

```liquid
<ul {% render 'kf-motion-attrs', stagger: s.animation_stagger, stagger_delay: s.animation_stagger_delay %}>
  {%- for product in products -%}
    <li {% render 'kf-motion-attrs', animation: s.animation %}>
```

Passing `motion: section.settings` to *both* is the trap — the list would take the animation as well and swallow the sequencing. Verified working output is `--kf-a-delay` of `0ms, 120ms, 240ms…` on the children.

### Flow Mode

`Off | Subtle | Balanced | Expressive` on `<html data-kf-flow>`. It sets two multipliers — `--kf-flow-intensity` (distance) and `--kf-flow-duration` (time). **It is a dial on the existing system, not a second system.** Off disables the engine entirely.

---

## 4. JavaScript

- `kf-core.js` is the only globally loaded module besides `kf-motion.js`. It exposes exactly one global: `window.KF`.
- Everything else is a Custom Element in its own file, loaded with `defer` **by the section that uses it**.
- Register with `KF.define(tag, class)` — it is idempotent, so duplicate script tags from repeated sections are harmless.
- Custom Elements are inherently Theme-Editor-safe: `connectedCallback` re-runs when Shopify re-renders a section. Only use `KF.onSectionLoad` for page-level work (re-scanning for animations, re-measuring).
- Components communicate through `KF.emit` / `KF.on` with names from `KF.events`. No imports between component files.

### Core API

| Method | Purpose |
| --- | --- |
| `KF.define(tag, class)` | Guarded custom element registration |
| `KF.on / off / emit` | Document-level event bus |
| `KF.ready(fn)` | DOM ready |
| `KF.onSectionLoad / Unload / Select` | Theme Editor lifecycle |
| `KF.onBlockSelect / Deselect` | Theme Editor block lifecycle |
| `KF.trapFocus(el, opts)` | Returns a release function — always call it |
| `KF.lockScroll / unlockScroll` | Reference counted, iOS safe |
| `KF.announce(msg)` | Polite live-region announcement |
| `KF.fetchSection(url, signal)` | Fetch a rendered section as a Document |
| `KF.raf(fn) / KF.debounce(fn, ms)` | Scheduling |
| `KF.motionAllowed()` | Reduced motion + Flow Mode check |

---

## 5. Section architecture

Every section follows this shape:

```
1. {%- comment -%} what it does, what it delegates, any non-obvious decision
2. Asset tags: section CSS, component JS (defer)
3. {%- liquid -%} compute classes and derived values up front — no logic in markup
4. Markup: shared snippets + {% content_for 'blocks' %}
5. {% stylesheet %} only for styles nothing else could ever reuse
6. {% schema %} ordered: Content → Layout → Media → Motion → Appearance → Blocks → Presets
```

Open the section with:

```liquid
<div {% render 'kf-section-attrs', s: section.settings, extra_class: 'kf-thing' %}>
```

which requires `color_scheme`, `padding_top`, `padding_bottom` settings (and optionally `section_transition`).

**Where a component's CSS goes.** This has bitten the theme more than once, so the rule is explicit:

| The markup is rendered by | Its CSS belongs in |
| --- | --- |
| One section only | `section-<name>.css`, loaded by that section |
| A snippet or custom element used by **more than one** section | `component-<name>.css`, loaded by **every** section that renders it |
| A generic `@theme` block (placeable in any section) | the block's own `{% stylesheet %}` |
| Markup shared across unrelated components | `kf-components.css` (global) |

Putting a shared component's styles in a section stylesheet is the failure mode to watch for: it looks correct on the section you built it for, and silently renders unstyled everywhere else. `<kf-quantity>` (product + cart), `.kf-stars` (product card + rating block) and the accordion block have all been moved for exactly this reason — do not move them back.

**`position: fixed` does not escape a transformed ancestor.** A non-`none` `transform` (also `filter`, `perspective`, `contain: paint`, `backdrop-filter`, `will-change: transform`) makes that element the containing block for every fixed descendant, so viewport insets quietly resolve against it instead. It breaks in exactly one layout and looks fine everywhere else: the lookbook's mobile sheet rendered 16px wide beside its pin, because the pin wrapper was centred with `translate(-50%, -50%)`. Before writing a full-screen overlay, drawer or sheet, check every ancestor for a transform — and prefer centring the *child* so the positioned wrapper stays untransformed.

**Naming:** marketing sections are `kf-*.liquid`. Shopify template sections keep canonical names (`main-product.liquid`, `main-collection-product-grid.liquid`, `main-cart.liquid`). Snippets and assets are `kf-*`. CSS classes are `kf-block__element--modifier`, max two nesting levels, no descendant chains.

**Empty states:** every section must look intentional in the Theme Editor before configuration. Use `placeholder_svg_tag` through `kf-media`, and never emit a broken `<img>` or a JS error when data is missing.

**Headings:** one `<h1>` per page, supplied by the page content. The header logo is deliberately not a heading. Blocks separate *visual size* from *heading level* — keep that separation.

---

## 6. Theme blocks

Blocks in `/blocks` are reusable content primitives available to any section declaring `{ "type": "@theme" }`. Render them with `{% content_for 'blocks' %}` — never `{% render block %}` (that is only for `@app` blocks and section-local blocks).

Private blocks are prefixed with `_` and only appear where a parent explicitly lists them.

Add a new block when the content unit is genuinely reusable across sections. Add a snippet when the reuse is developer-facing logic with no merchant settings.

---

## 7. Performance rules

- The LCP image is **never** lazy-loaded. Pass `loading: 'eager', priority: true` to `kf-media` for hero and logo images only.
- Everything below the fold is `loading="lazy"` with explicit dimensions (`image_tag` handles this).
- All JS is `defer`. No render-blocking scripts beyond the tiny inline boot script.
- Component JS is requested by the section that needs it, not bundled globally.
- Animate only `transform`, `opacity`, `filter`, `mask-size`. Never animate layout properties, and never hide an animated element with `clip-path` (see the Kofii Motion section).
- **`transition: transform` does not cover a `transform-origin` change.** They are separate properties: change only the origin and the element jumps, with no transition created at all. Express a pan *inside* `transform` — `translate()` with the origin left at `0 0` — rather than adding `transform-origin` to the transition list, which also costs the compositor. The lookbook guided tour is the worked example.
- Changing a **custom property** does start a transition on whatever property reads it through `var()`, and the value interpolates normally. `clamp()` with all-percentage arguments interpolates too, which is what lets a pan be clamped to its own bounds in pure CSS. Both verified in-browser.
- Do not add `will-change` broadly — only for continuously animating elements (parallax).
- **Per-file JS budget: 16 KB raw.** The always-loaded runtime is `kf-core.js` + `kf-motion.js` (22 KB raw / 6.4 KB gzip combined). If a component needs more, split it or load it on interaction — do not raise the threshold in `.theme-check.yml`.

---

## 8. Accessibility rules

- Semantic HTML first; ARIA only where semantics fall short.
- Drawers: `role="dialog"`, `aria-modal`, focus trap, Escape, focus restore, `inert` when closed.
- Disclosures: built on native `<details>` so they work without JS.
- Predictive search: full combobox pattern with `aria-activedescendant`.
- Every interactive control has a visible focus ring and a ≥44px hit area.
- Icons are `aria-hidden`; label the control, not the icon.
- Decorative motion never blocks reading, navigation, or purchase.

---

## 9. Before you call a change done

```bash
npm run validate     # local: JSON, schemas, asset/snippet/section/translation/setting references
npm run check        # Shopify Theme Check (requires the Shopify CLI)
npm run check:all    # Stricter audit pass — expect some findings to be deliberate
```

Then check by hand:

- Desktop and mobile (at least 375px, 768px, 1280px).
- Keyboard only: tab through the new UI end to end.
- Reduced motion on: content still appears, nothing animates.
- JavaScript disabled: content is visible and navigable.
- Theme Editor: add, reorder, remove and re-render the section; components must survive a section re-render.
- Empty state: no image, no products, no menu chosen.

---

## 10. Current state and roadmap

**Phase 4 — marketing library (in progress).** Built so far: rich text, image with text (five layouts), featured collection (grid / carousel / horizontal scroll) with quick add, scrolling story, timeline, lookbook (hotspots or a scroll-driven guided tour that zooms to each product), marquee, stacking cards (pure `position: sticky`, no JavaScript), product recommendations, FAQ with FAQPage structured data, before/after comparison, newsletter, a bento grid, tabs, and testimonials. Shared components added along the way: <kf-slider>, <kf-quick-add>, <kf-scroll-story>, <kf-marquee>, <kf-tabs>, the star rating extracted into `snippets/kf-stars.liquid`, the slider arrows and pagination extracted into `snippets/kf-slider-controls.liquid` and `snippets/kf-slider-pagination.liquid`, and the variant picker / buy buttons extracted into snippets so quick add and the product page share one implementation. Sections are being added one at a time.

**Phase 3b — collection (complete).** `main-collection-product-grid.liquid` with Shopify native storefront filtering and sorting, `main-collection-banner.liquid`, `main-list-collections.liquid`, `<kf-facets>`, and the `collection` / `list-collections` templates. Products render through the shared product card.

**Filtering rules:**

- Filtering is Shopify’s. `collection.filters` decides which filters exist, which values are available and every count. **Never filter products in Liquid or JavaScript** — it would disagree with the server as soon as inventory or pagination changed.
- Filter inputs are named with Shopify’s own `param_name`, so the form submits a valid filter URL with no JavaScript at all. The Apply button is hidden only once `.kf-js` is present.
- **Form association is not DOM containment.** The sort select is bound to the filter form with `form="…"` and is not nested inside it, so `closest()` will not find it — use `element.form`. This silently broke sorting once.
- Anything that must refresh when filters change needs `data-kf-facet-region`. The toolbar is not re-rendered, so the product count carries its own region.

**Phase 3a — cart (complete).** `cart-drawer.liquid` (rendered from the layout, on every page), `main-cart.liquid`, `cart-recommendations.liquid`, `<kf-cart-items>`, `<kf-cart-note>`, `<kf-cart-recommendations>`, free-shipping progress, order note, line and cart level discounts, empty states, and `templates/cart.json`. The drawer and the cart page share one line-item snippet and one summary snippet.

**Cart rules — do not break these:**

- **`data-kf-cart-section` must be `{{ section.id }}`, never a hardcoded name.** A section in a JSON template has the id `template--<theme_id>__main`, so a literal `"main-cart"` silently never re-renders.
- **No money arithmetic in JavaScript, ever.** Every mutation asks Shopify to re-render the cart sections in the same request (`sections` on the Cart AJAX API) and swaps the HTML in. A total the theme calculated itself will eventually disagree with checkout.
- The Cart AJAX API returns the full `<div id="shopify-section-…">` wrapper, so swaps target the inner `[data-kf-cart-content]` anchor.
- Anything rendered in both the drawer and the cart page needs a `scope` prefix on its element ids, or `/cart` ends up with duplicate ids.

**Phase 2 — product page (complete).** `main-product.liquid` with a fully block-driven information column; `<kf-product-gallery>` (thumbnails, keyboard nav, video and external video, hover magnify, native-`<dialog>` lightbox); `<kf-variant-picker>` (Section Rendering API, no duplicated price logic in JS); `<kf-product-form>` (AJAX add, real error surfacing); `<kf-quantity>`; `<kf-accordion>`; `<kf-share>`; `<kf-sticky-atc>`; 13 product theme blocks; Product JSON-LD; `templates/product.json`. Related and complementary products are a section of their own, `kf-product-recommendations.liquid`.

**Phase 1 — foundation (complete).** Design tokens, color schemes, typography, spacing, base CSS, component CSS, Kofii Motion, `KF` core, drawer/disclosure/header/predictive-search elements, theme blocks, header (with mega menus, mobile nav, predictive search), footer, hero, search page, page, 404, apps section, `index`/`page`/`search`/`404` templates.

**Not built yet — do not pretend otherwise:**

- Sections: the rest of the marketing library (product spotlight, logo cloud, comparison, video, stats, image reveal).
- Featured collection has grid, carousel and horizontal-scroll layouts. An editorial layout (oversized first product) is not built.
- Timeline has vertical and alternating layouts. A horizontal (scrolling) timeline is not built — it needs a second spine orientation rather than a reuse of the existing CSS.
- Components: none outstanding.
- Product card quick-add (the card itself is complete and in use).
- Art-directed mobile images in `kf-media` (focal point covers the common case today).
- **Not verified on a real storefront.** Everything below has only ever been checked with Theme Check, `.dev/validate.mjs` and isolated browser repros — the theme has never been rendered by Shopify. The Lighthouse thresholds (performance ≥ 60, accessibility ≥ 90, averaged over home, collection and product, desktop and mobile), the browser matrix, and 3D/AR on a product that actually has a model all need a real preview before they can be claimed.

**Known product-page limitation, by design:** the quantity input is deliberately *outside* the variant region, so a shopper's chosen quantity survives a variant change. The trade-off is that its `max` attribute does not re-render, so an over-order is caught server-side — `<kf-product-form>` surfaces Shopify's own message. Do not "fix" this by recomputing stock limits in JavaScript; that would create a second source of truth for inventory.

**Phase 5 — blog and article (complete).** `main-blog.liquid` with topic filtering, a featured first article, grid and list layouts; `main-article.liquid` with the native comment form, share, topic links, previous/next navigation and BlogPosting JSON-LD; `templates/blog.json` and `templates/article.json`. Articles render through `snippets/kf-article-card.liquid`, the blog equivalent of the product card.

**Phase 6 — Theme Store readiness (in progress).** Every template now exists. All seven customer templates and sections are built: login (recovery form in a native <details>), register, activate, reset, account, order and addresses. Address fields live in `snippets/kf-address-fields.liquid`; `<kf-address-form>` upgrades the province text input to a select and applies the saved country, because `country_option_tags` always preselects the shop's. The password page has its own `layout/password.liquid`, and `templates/gift_card.liquid` is standalone with `layout none`. Schema labels are extracted to `locales/en.default.schema.json` by `.dev/i18n-schemas.mjs` — re-run it after adding a section and it picks up only the new strings. Still outstanding: the full storefront locale set (310 strings exist in `en.default.json` only).

**Shopify-hosted assets, not dependencies.** Three things are loaded from Shopify's own CDN through `shopify_asset_url` rather than bundled, which is why they do not breach rule 8:

| Asset | Loaded by | For |
| --- | --- | --- |
| `component-model-viewer-ui.css` + `Shopify.loadFeatures('model-viewer-ui')` | `main-product.liquid`, only when the product has a model | interactive 3D |
| `Shopify.loadFeatures('shopify-xr')` | same | the "View in your space" button |
| `vendor/qrcode.js` | `templates/gift_card.liquid` | the gift card QR code |

All three fail quiet: the model degrades to its poster image (`reveal: 'interaction'`), the AR button stays hidden (`data-shopify-xr-hidden`), and the QR container is `hidden` until the script fills it — with the gift card code still printed in full underneath.

**Theme Store requirements met in Phase 6.** `templates/page.contact.json` with `sections/kf-contact-form.liquid`; a Custom Liquid *section* alongside the existing block (the requirement names a section specifically); `<shopify-account>` in the header at every width, with the plain drawer link kept as the no-script path; Follow on Shop via `{{ shop | login_button: action: 'follow' }}` in the footer's brand block; the Shop Pay Installments banner via `{{ form | payment_terms }}` inside the product form; `content_for_additional_checkout_buttons` on the cart; `page_image` for the social share image; `shop.password_message` on the password page.

**Phase order:** 4 — marketing section library. 5 — blog + article. 6 — Theme Store readiness (schema i18n, remaining templates, full locale set).
