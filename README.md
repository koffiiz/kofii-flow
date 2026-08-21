# Kofii Flow

A premium, animation-rich Shopify Online Store 2.0 theme.

**Beautiful storefronts that flow.**

Kofii Flow pairs Shopify's commerce platform with Webflow-grade interaction quality, built on a real design system: two-layer design tokens, one animation engine, one product card, one button, one media frame. No React, no Tailwind, no GSAP, no jQuery — Liquid, modern CSS, and vanilla Custom Elements.

> **Status: Phase 3a complete.** The design system, motion engine, header, footer, hero, search, page, 404, the full product page and the cart (drawer + page) are production-quality. Collection, blog and the wider marketing section library are not built yet. See [CLAUDE.md § 10](CLAUDE.md#10-current-state-and-roadmap) for the exact list.

---

## Installation

### Requirements

- [Node.js](https://nodejs.org) 18 or newer (for the local validator only — the theme itself ships zero dependencies)
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) 3.x
- A Shopify development store

### Shopify CLI setup

```bash
npm install -g @shopify/cli@latest
```

```bash
shopify auth login
```

### Get the theme

```bash
git clone <your-repo-url> kofii-flow
```

```bash
cd kofii-flow
```

---

## Development

Start a local development server with hot reload against your store:

```bash
shopify theme dev --store your-store.myshopify.com
```

Open the printed URL. Edits to Liquid, CSS and JS reload automatically. Add `--theme-editor-sync` to also pull Theme Editor changes back down.

### Push and pull

Upload as a new unpublished theme:

```bash
shopify theme push --unpublished --theme "Kofii Flow"
```

Update an existing theme:

```bash
shopify theme push
```

Pull a merchant's Theme Editor changes back into the repo:

```bash
shopify theme pull --only templates --only config/settings_data.json
```

> Pull selectively. A blanket `shopify theme pull` will overwrite your source files with the version on the store.

### Checks

```bash
npm run validate
```

Local validator (`.dev/validate.mjs`). No Shopify CLI required. Verifies JSON and `{% schema %}` validity, and that every `asset_url`, `{% render %}`, section type, block type, translation key and `settings.*` reference actually resolves.

```bash
npm run check
```

Shopify Theme Check. Requires the CLI.

```bash
npm run check:all
```

Stricter audit using every available Theme Check rule (`.dev/theme-check-all.yml`). Not part of `verify` — some of its findings are deliberate architectural choices. Read them, do not blindly satisfy them.

```bash
npm run verify
```

`validate` then `check`. Run this before every commit. Both currently pass with zero offenses.

---

## Architecture

```
assets/       CSS and JS. Globals are kf-*; section and component styles load on demand.
blocks/       Theme blocks — reusable content primitives (heading, text, button, …)
config/       Global theme settings (Layer B design tokens) and their defaults
layout/       theme.liquid
locales/      Storefront strings
sections/     Sections and section groups
snippets/     Developer-facing reusable Liquid
templates/    JSON templates
.dev/         Local tooling, not uploaded to the store
```

### Design system

Tokens live in two layers:

| Layer | File | Role |
| --- | --- | --- |
| A | `assets/kf-tokens.css` | Declares every token with a static default |
| B | `snippets/kf-css-variables.liquid` | Overrides the merchant-controlled subset, inline in `<head>` |

The theme therefore renders correctly even when a setting is blank, and Theme Editor changes repaint instantly with no extra request.

Scales are multiplicative. One spacing slider moves every spacing token; one heading-size slider moves the whole heading ramp. Merchants get real control without forty sliders.

### Color schemes

Sections choose a **scheme**, never a color. Schemes are defined once in Theme settings → Colors and applied as `.kf-scheme--<id>`. Derived tokens (borders, muted text, surfaces, shadows) are computed from the scheme roles with `color-mix()`, so a new scheme needs eight colors and produces a complete, coherent palette.

### CSS

`kf-tokens` → `kf-base` → `kf-components` → `kf-motion` → `kf-utilities` load globally. Section and component sheets load only with the section that needs them. Class names are `kf-block__element--modifier`, at most two levels deep.

### JavaScript

`kf-core.js` (the `KF` namespace) and `kf-motion.js` are the only globally loaded scripts. Everything else is a Custom Element in its own `defer`-loaded file, requested by the section that uses it and registered idempotently, so repeated sections cannot double-register.

---

## Kofii Motion

The theme's animation system. Declarative, CSS-first, one engine.

```liquid
<div {% render 'kf-motion-attrs', motion: section.settings %}>
```

which produces:

```html
<div data-kf-animate="fade-up"
     style="--kf-a-duration:700ms;--kf-a-delay:0ms;--kf-a-easing:var(--kf-ease-smooth);--kf-a-distance:28px;">
```

JavaScript adds `data-kf-inview` when the element should play. Every keyframe, easing and initial state lives in `assets/kf-motion.css`.

### Presets

`fade` · `fade-up` · `fade-down` · `fade-left` · `fade-right` · `scale-up` · `scale-down` · `zoom-in` · `blur-in` · `rotate-in` · `slide-up` · `clip-up` · `clip-left` · `clip-right` · `reveal`

Plus continuous effects: `data-kf-parallax`, `data-kf-float`, and the marquee keyframes used by the announcement bar.

Direction names describe the direction of travel — `fade-up` rises, so it starts below.

### Flow Mode

A theme-level dial in Theme settings → Motion:

| Mode | Effect |
| --- | --- |
| Off | Motion engine disabled entirely |
| Subtle | 55% distance, 80% duration |
| Balanced | Baseline |
| Expressive | 160% distance, 120% duration |

It is two CSS multipliers on the existing system, not a second animation path.

### Accessibility and resilience

Elements waiting to animate are hidden only under `.kf-motion` on `<html>`, which an inline `<head>` script adds **only** when motion is allowed — and a 2.5-second failsafe removes it if the engine never boots. With JavaScript disabled, blocked, broken, or with `prefers-reduced-motion: reduce`, every element is fully visible. Content visibility never depends on JavaScript succeeding.

---

## Adding a section

1. Create `sections/kf-your-section.liquid`.
2. Load only what it needs:

```liquid
{{ 'section-your-section.css' | asset_url | stylesheet_tag }}
<script src="{{ 'kf-your-component.js' | asset_url }}" defer></script>
```

3. Compute classes in one `{%- liquid -%}` block, then open the section:

```liquid
<div {% render 'kf-section-attrs', s: section.settings, extra_class: 'kf-your-section' %}>
  <div class="kf-container">
    {% content_for 'blocks' %}
  </div>
</div>
```

4. Render shared components — `kf-media`, `kf-button`, `kf-product-card`, `kf-price`, `kf-icon`. Do not hand-write their markup.
5. Add motion with `{% render 'kf-motion-attrs', motion: section.settings %}`.
6. Write the schema in this order: **Content → Layout → Media → Motion → Appearance → Blocks → Presets**. Include `color_scheme`, `padding_top`, `padding_bottom`.
7. Give it a preset with real default content so it looks finished the moment it is added.
8. `npm run verify`.

## Adding a block

Create `blocks/your-block.liquid` with markup, `{{ block.shopify_attributes }}`, and a schema including a `presets` entry. Prefix with `_` for a private block only usable inside a specific parent. Any section declaring `{ "type": "@theme" }` picks it up automatically.

---

## Coding conventions

| Area | Convention |
| --- | --- |
| Sections | `kf-*.liquid`, except canonical `main-*.liquid` |
| Snippets / assets | `kf-*` |
| CSS classes | `kf-block__element--modifier`, max two levels |
| Custom properties | `--kf-*` |
| Custom elements | `<kf-*>` |
| Liquid | Logic in one `{%- liquid -%}` block at the top; markup stays readable |
| Liquid output | Always `{% render %}`, never `{% include %}` |
| Escaping | `| escape` on all merchant text rendered into attributes or markup |
| Events | `KF.emit` / `KF.on`, names from `KF.events` |

Full architectural rules — including what must never be duplicated — are in [CLAUDE.md](CLAUDE.md).

---

## Browser support

Modern evergreen browsers. The theme uses `color-mix()`, `:has()`, `svh` units, `aspect-ratio`, `clamp()`, `inert` and Custom Elements. Older browsers degrade gracefully rather than breaking: they lose hover polish and sticky behaviour, not content or checkout.

---

## License

Proprietary. All rights reserved.
