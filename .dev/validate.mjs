/**
 * Kofii Flow — local theme validator
 * ---------------------------------------------------------------------------
 * Shopify Theme Check is the authority (`npm run check`), but it needs the
 * Shopify CLI installed. This script needs nothing but Node, and catches the
 * mistakes that actually break a theme upload:
 *
 *   1. Invalid JSON in config/, templates/ and section groups
 *   2. Invalid JSON inside {% schema %} blocks
 *   3. asset_url references to files that do not exist
 *   4. {% render 'x' %} references to snippets that do not exist
 *   5. Section and block types referenced by templates that do not exist
 *   6. Translation keys that are missing from locales/en.default.json
 *   7. settings.* references that are not declared in settings_schema.json
 *   8. Duplicate setting ids inside one schema
 *
 * Run: node .dev/validate.mjs   (or: npm run validate)
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];

const fail = (file, message) => errors.push(`${file}: ${message}`);
const warn = (file, message) => warnings.push(`${file}: ${message}`);

/* ----------------------------------------------------------------- helpers */

function listFiles(dir, ext) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((name) => statSync(join(full, name)).isFile())
    .filter((name) => (ext ? extname(name) === ext : true))
    .map((name) => join(dir, name).replaceAll('\\', '/'));
}

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

function parseJson(relPath, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(relPath, `invalid JSON — ${error.message}`);
    return null;
  }
}

function extractSchema(relPath, source) {
  const match = source.match(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/);
  if (!match) return null;
  return parseJson(relPath, match[1]);
}

function flattenLocaleKeys(node, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // A pluralization group is a leaf, not a namespace.
      const pluralForms = ['zero', 'one', 'two', 'few', 'many', 'other'];
      const isPlural = Object.keys(value).every((k) => pluralForms.includes(k));
      out.add(path);
      if (!isPlural) flattenLocaleKeys(value, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

/**
 * Shopify rejects a theme upload when a range setting is malformed, and the
 * error message is not always specific about which setting is at fault.
 * Rules: min < max, step > 0, (max - min) must be divisible by step, at least
 * 3 and at most 101 steps, and the default must sit inside the range.
 *
 * The lower bound is the one that is easy to miss. A two-position range looks
 * perfectly reasonable in a schema — "1 or 2 columns on mobile" — and Shopify
 * rejects the whole theme for it. Use a `select` for a two-way choice, which
 * is what the rest of this theme does for mobile column counts.
 */
function checkRange(setting, relPath, scope) {
  const { id, min, max, step, default: value } = setting;
  const where = `${scope} range "${id}"`;

  if (typeof min !== 'number' || typeof max !== 'number' || typeof step !== 'number') {
    fail(relPath, `${where} needs numeric min, max and step`);
    return;
  }
  if (min >= max) fail(relPath, `${where} has min >= max`);
  if (step <= 0) fail(relPath, `${where} has a step of ${step}`);

  const span = max - min;
  // Compare against a small epsilon so decimal steps do not trip on float error.
  if (step > 0 && Math.abs(span / step - Math.round(span / step)) > 1e-9) {
    fail(relPath, `${where}: (max - min) = ${span} is not divisible by step ${step}`);
  }
  if (step > 0 && span / step > 101) {
    fail(relPath, `${where} has ${Math.round(span / step)} steps; Shopify allows at most 101`);
  }
  // Positions, not intervals: a min/max/step of 1/2/1 is two positions.
  if (step > 0 && span / step + 1 < 3) {
    fail(
      relPath,
      `${where} has ${Math.round(span / step) + 1} steps; Shopify requires at least 3 — use a select for a two-way choice`
    );
  }
  if (typeof value === 'number' && (value < min || value > max)) {
    fail(relPath, `${where} has default ${value} outside ${min}–${max}`);
  }

  // Being inside the range is not enough — the default has to land ON one of
  // the steps. min 40 / max 90 / step 5 offers 40, 45 … 70; a default of 68 is
  // in range, looks entirely reasonable, and is rejected on upload with
  // "default must be a step in the range".
  if (typeof value === 'number' && step > 0 && value >= min && value <= max) {
    const offset = (value - min) / step;
    if (Math.abs(offset - Math.round(offset)) > 1e-9) {
      const below = min + Math.floor(offset) * step;
      fail(
        relPath,
        `${where} has default ${value}, which is not a step of ${step} from ${min} — use ${below} or ${below + step}`
      );
    }
  }
}

/**
 * `role` maps color scheme definition ids onto the roles Shopify uses to draw
 * the scheme preview and to color native elements.
 *
 * All ten are documented as Required, and any key outside the set is rejected
 * on upload. `shadow` is the common false friend: a legitimate *definition* id
 * (Shopify's own reference example has one) but never a role.
 *
 * Definition ids that are not role-mapped are fine — Kofii Flow reads `heading`
 * and `shadow` directly in Liquid via `scheme.settings.*`.
 */
const COLOR_SCHEME_ROLES = new Set([
  'background',
  'text',
  'links',
  'icons',
  'primary_button',
  'on_primary_button',
  'primary_button_border',
  'secondary_button',
  'on_secondary_button',
  'secondary_button_border'
]);

function checkColorSchemeGroup(setting, relPath) {
  const allowedTypes = new Set(['header', 'color', 'color_background']);
  const definedIds = new Set();

  for (const entry of setting.definition || []) {
    if (!allowedTypes.has(entry.type)) {
      fail(
        relPath,
        `color_scheme_group definition cannot contain "${entry.type}" — only header, color and color_background`
      );
    }
    if (entry.id) definedIds.add(entry.id);
  }

  const roles = setting.role || {};

  for (const required of COLOR_SCHEME_ROLES) {
    if (!(required in roles)) {
      fail(relPath, `color scheme role "${required}" is required but missing`);
    }
  }

  for (const [role, target] of Object.entries(roles)) {
    if (!COLOR_SCHEME_ROLES.has(role)) {
      fail(
        relPath,
        `"${role}" is not a valid color scheme role (valid: ${[...COLOR_SCHEME_ROLES].join(', ')})`
      );
      continue;
    }
    const targets = typeof target === 'string' ? [target] : Object.values(target);
    for (const targetId of targets) {
      if (!definedIds.has(targetId)) {
        fail(relPath, `role "${role}" points at "${targetId}", which is not in the definition`);
      }
    }
  }
}

/**
 * Preset blocks are only exercised when a merchant adds the section from the
 * picker, so a bad type here fails in the Theme Editor rather than at upload —
 * exactly the kind of error that is easy to ship unnoticed.
 *
 * Handles both shapes Shopify accepts (an array of blocks, or an object keyed
 * by block id) and recurses into nested blocks.
 */
function checkPresetBlocks(blocks, schema, relPath, scope) {
  if (!blocks) return;

  const declared = new Set((schema.blocks || []).map((b) => b.type));
  const acceptsTheme = declared.has('@theme');
  const list = Array.isArray(blocks) ? blocks : Object.values(blocks);

  for (const block of list) {
    if (!block || !block.type) continue;

    const known =
      declared.has(block.type) ||
      (acceptsTheme && blockNames.has(block.type)) ||
      block.type.startsWith('@');

    if (!known) {
      fail(relPath, `${scope} uses block type "${block.type}", which this section does not accept`);
      continue;
    }

    // A nested preset block is owned by the block file, not this schema.
    const childSchema = blockNames.has(block.type)
      ? schemasByFile.get(block.type) || { blocks: [] }
      : schema;

    checkPresetBlocks(block.blocks, childSchema, relPath, `${scope} > "${block.type}"`);
  }
}

function collectSettingIds(schemaSettings, into, relPath, scope) {
  const seen = new Set();
  for (const setting of schemaSettings || []) {
    if (setting.type === 'range') checkRange(setting, relPath, scope);
    if (setting.type === 'color_scheme_group') checkColorSchemeGroup(setting, relPath);

    if (!setting.id) continue;
    if (seen.has(setting.id)) {
      fail(relPath, `duplicate setting id "${setting.id}" in ${scope}`);
    }
    seen.add(setting.id);
    if (into) into.add(setting.id);
  }
}

/* -------------------------------------------------------------- inventories */

const assetFiles = new Set(listFiles('assets').map((p) => basename(p)));
const snippetNames = new Set(listFiles('snippets', '.liquid').map((p) => basename(p, '.liquid')));
const sectionNames = new Set(listFiles('sections', '.liquid').map((p) => basename(p, '.liquid')));
const blockNames = new Set(listFiles('blocks', '.liquid').map((p) => basename(p, '.liquid')));

const localeKeys = (() => {
  const relPath = 'locales/en.default.json';
  if (!existsSync(join(ROOT, relPath))) {
    fail(relPath, 'missing');
    return new Set();
  }
  const data = parseJson(relPath, read(relPath));
  return data ? flattenLocaleKeys(data) : new Set();
})();

const globalSettingIds = (() => {
  const relPath = 'config/settings_schema.json';
  const data = parseJson(relPath, read(relPath));
  const ids = new Set();
  if (!Array.isArray(data)) return ids;
  for (const group of data) {
    // Same structural checks the section schemas get: ranges, color scheme
    // roles and duplicate ids all block a theme upload.
    collectSettingIds(group.settings, ids, relPath, `group "${group.name}"`);
  }
  return ids;
})();

/* ------------------------------------------------------------ 1. JSON files */

for (const relPath of [
  ...listFiles('config', '.json'),
  ...listFiles('templates', '.json'),
  ...listFiles('sections', '.json'),
  ...listFiles('locales', '.json')
]) {
  parseJson(relPath, read(relPath));
}

/* ---------------------------------------------- 2-8. Liquid file inspection */

const liquidFiles = [
  ...listFiles('layout', '.liquid'),
  ...listFiles('sections', '.liquid'),
  ...listFiles('snippets', '.liquid'),
  ...listFiles('blocks', '.liquid')
];

const schemasByFile = new Map();
const presetQueue = [];

for (const relPath of liquidFiles) {
  const source = read(relPath);

  // 2b. Unterminated output tags.
  //
  // Shopify ends a `{{ ... }}` at the FIRST `}` it sees — the scanner regex is
  // `/\}\}?/` — so one literal closing brace inside an output tag truncates it
  // and the upload is rejected with "not properly terminated". It is legal
  // Liquid everywhere else, so nothing local catches it: the theme validates,
  // Theme Check passes, and it fails at `shopify theme push`.
  //
  // Put the value in a `{% liquid %}` tag instead, where the scanner looks for
  // `%}` and a bare `}` is harmless. JSON-LD `{search_term_string}` templates
  // are the usual way to meet this.
  for (let i = source.indexOf('{{'); i !== -1; ) {
    const close = source.indexOf('}', i + 2);
    if (close === -1 || source[close + 1] !== '}') {
      const line = source.slice(0, i).split(/\r?\n/).length;
      const snippet = source.slice(i, close === -1 ? i + 60 : close + 1);
      fail(
        relPath,
        `line ${line}: output tag has a literal "}" inside it and will not upload — ${snippet.trim()}`
      );
      break;
    }
    i = source.indexOf('{{', close + 1);
  }

  // 3. asset_url references
  for (const match of source.matchAll(/'([^']+\.(?:css|js|svg|png|jpg|woff2?))'\s*\|\s*asset_url/g)) {
    if (!assetFiles.has(match[1])) fail(relPath, `asset not found: ${match[1]}`);
  }

  // 4. snippet renders
  for (const match of source.matchAll(/\{%-?\s*(?:render|include)\s+'([^']+)'/g)) {
    if (!snippetNames.has(match[1])) fail(relPath, `snippet not found: ${match[1]}`);
  }

  // 6. translation keys
  for (const match of source.matchAll(/'([a-z0-9_]+(?:\.[a-z0-9_?]+)+)'\s*\|\s*t\b/g)) {
    if (!localeKeys.has(match[1])) fail(relPath, `missing translation key: ${match[1]}`);
  }

  // 7. global settings references
  for (const match of source.matchAll(/(?<![.\w])settings\.([a-z0-9_]+)/g)) {
    if (!globalSettingIds.has(match[1])) {
      fail(relPath, `settings.${match[1]} is not declared in settings_schema.json`);
    }
  }

  // 2 + 8. schema
  if (relPath.startsWith('sections/') || relPath.startsWith('blocks/')) {
    const schema = extractSchema(relPath, source);
    if (schema) {
      schemasByFile.set(basename(relPath, '.liquid'), schema);
      collectSettingIds(schema.settings, null, relPath, 'settings');
      for (const block of schema.blocks || []) {
        if (block.settings) collectSettingIds(block.settings, null, relPath, `block "${block.type}"`);
      }
      if (schema.presets) {
        for (const preset of schema.presets) {
          if (!preset.name) fail(relPath, 'a preset is missing "name"');
          // Deferred: sections are parsed before blocks, so nested block
          // schemas are not all loaded yet.
          presetQueue.push({
            blocks: preset.blocks,
            schema,
            relPath,
            scope: `preset "${preset.name}"`
          });
        }
      }
    }
  }
}

/* Presets run once every block schema is known. */
for (const item of presetQueue) {
  checkPresetBlocks(item.blocks, item.schema, item.relPath, item.scope);
}

/* ------------------------------- 5. templates and section groups reference real sections */

function checkSectionUsage(relPath, sectionsNode) {
  for (const [key, config] of Object.entries(sectionsNode || {})) {
    const type = config.type;
    if (!type) {
      fail(relPath, `section "${key}" has no type`);
      continue;
    }
    if (!sectionNames.has(type)) {
      fail(relPath, `section "${key}" references missing section: ${type}`);
      continue;
    }

    const schema = schemasByFile.get(type);
    if (!schema) continue;

    const declared = new Set((schema.blocks || []).map((b) => b.type));
    const acceptsTheme = declared.has('@theme');

    for (const [blockKey, block] of Object.entries(config.blocks || {})) {
      const blockType = block.type;
      if (declared.has(blockType)) continue;
      if (acceptsTheme && blockNames.has(blockType)) continue;
      fail(
        relPath,
        `section "${key}" block "${blockKey}" uses type "${blockType}", which ${type} does not accept`
      );
    }
  }
}

for (const relPath of listFiles('templates', '.json')) {
  const data = parseJson(relPath, read(relPath));
  if (data) checkSectionUsage(relPath, data.sections);
}

for (const relPath of listFiles('sections', '.json')) {
  const data = parseJson(relPath, read(relPath));
  if (data) checkSectionUsage(relPath, data.sections);
}

/* ------------------------------------------------- required theme structure */

const required = [
  'layout/theme.liquid',
  'config/settings_schema.json',
  'config/settings_data.json',
  'locales/en.default.json'
];

for (const relPath of required) {
  if (!existsSync(join(ROOT, relPath))) fail(relPath, 'required file is missing');
}

const layout = read('layout/theme.liquid');
for (const token of ['content_for_header', 'content_for_layout']) {
  if (!layout.includes(token)) fail('layout/theme.liquid', `missing {{ ${token} }}`);
}

/* -------------------------------------------------------------------- report */

const label = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

if (warnings.length) {
  console.log(`\n${label(warnings.length, 'warning')}:`);
  warnings.forEach((w) => console.log(`  ! ${w}`));
}

if (errors.length) {
  console.log(`\n${label(errors.length, 'error')}:`);
  errors.forEach((e) => console.log(`  x ${e}`));
  console.log('');
  process.exit(1);
}

console.log(
  `\nKofii Flow validated: ${liquidFiles.length} Liquid files, ${schemasByFile.size} schemas, ` +
    `${assetFiles.size} assets, ${localeKeys.size} translation keys. No errors.\n`
);
