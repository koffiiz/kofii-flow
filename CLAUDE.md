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
- Animate only `transform`, `opacity`, `filter`, `clip-path`. Never animate layout properties.
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

**Phase 1 — foundation (complete).** Design tokens, color schemes, typography, spacing, base CSS, component CSS, Kofii Motion, `KF` core, drawer/disclosure/header/predictive-search elements, theme blocks, header (with mega menus, mobile nav, predictive search), footer, hero, search page, page, 404, apps section, `index`/`page`/`search`/`404` templates.

**Not built yet — do not pretend otherwise:**

- Templates: `product`, `collection`, `cart`, `blog`, `article`, `list-collections`, `gift_card`, `password`, customer templates.
- Sections: `main-product`, `main-collection-product-grid`, `main-cart`, `main-blog`, `main-article`, and the marketing library (bento, marquee, image-with-text, featured collection, product spotlight, testimonials, logo cloud, comparison, before/after, video, lookbook, FAQ, tabs, timeline, stats, scrolling story, image reveal, newsletter, rich text, spacer, custom Liquid).
- Components: cart drawer, product gallery, variant picker, quick add, slider, marquee element, tabs, accordion.
- Product card quick-add (the card itself is complete and in use).
- Art-directed mobile images in `kf-media` (focal point covers the common case today).
- Schema label translation (`locales/*.schema.json`). Schema labels are currently authored in English inline.

**Phase order:** 2 — product + collection + cart. 3 — marketing section library. 4 — Theme Store readiness (schema i18n, remaining templates, full locale set).
