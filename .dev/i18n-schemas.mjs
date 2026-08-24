/**
 * Kofii Flow — schema label extraction
 * ---------------------------------------------------------------------------
 * Moves every merchant-facing string out of `{% schema %}` blocks and into
 * `locales/en.default.schema.json`, leaving a `t:` reference behind. The Theme
 * Store requires this; Shopify reads the schema locale to translate the editor.
 *
 * Safe to run again. Any value that already starts with `t:` is left alone, so
 * running it after adding a section only picks up the new strings.
 *
 * What is translated: `name`, `label`, `info`, `content`, `placeholder`, and
 * the label of every select/radio option.
 *
 * What is NOT: `default`. A default is content the merchant will replace, not
 * chrome — Shopify keeps it literal, and translating it would put sample copy
 * into the translation file.
 *
 * Key shape follows Shopify's own convention so a translator sees a familiar
 * tree:
 *   sections.<file>.name
 *   sections.<file>.settings.<id>.label
 *   sections.<file>.settings.<id>.options__1.label
 *   sections.<file>.blocks.<type>.settings.<id>.label
 *   sections.<file>.presets.name
 *
 * Headers and paragraphs have no id, so they are numbered in document order —
 * `header__1`, `paragraph__2` — which is the same thing Dawn does.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_RE = /(\{%\s*schema\s*%\})([\s\S]*?)(\{%\s*endschema\s*%\})/;

const LOCALE_PATH = join(ROOT, 'locales/en.default.schema.json');

const locale = { sections: {}, blocks: {}, settings_schema: {} };
let moved = 0;
let carried = 0;

/**
 * The locale file is rebuilt from scratch on every run, so a schema that is
 * ALREADY translated has to have its string copied across from the previous
 * file — otherwise the second run writes a locale containing only whatever was
 * new, and every existing `t:` reference points at nothing. That is not
 * hypothetical: it is exactly what happened the first time this ran twice.
 */
let previous = {};
try {
  previous = JSON.parse(readFileSync(LOCALE_PATH, 'utf8'));
} catch {
  previous = {};
}

function read(source, path) {
  let node = source;
  for (const part of path) {
    if (!node || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function write(path, value) {
  let node = locale;
  for (const part of path.slice(0, -1)) {
    node[part] = node[part] || {};
    node = node[part];
  }
  node[path[path.length - 1]] = value;
}

/** Records a string and returns the `t:` reference that replaces it. */
function put(path, value) {
  if (typeof value !== 'string' || value.trim() === '') return value;

  if (value.startsWith('t:')) {
    // Carry it forward under the key it actually points at, so the reference
    // stays valid even if the generated path has since changed shape.
    const referenced = value.slice(2).split('.');
    const prior = read(previous, referenced);
    if (prior !== undefined) {
      write(referenced, prior);
      carried++;
    } else {
      console.error(`  ! ${value} has no string in the existing locale`);
      process.exitCode = 1;
    }
    return value;
  }

  write(path, value);
  moved++;
  return 't:' + path.join('.');
}

/** Settings arrays appear on sections, blocks and theme blocks alike. */
function walkSettings(settings, path) {
  if (!Array.isArray(settings)) return;

  let anonymous = 0;
  for (const setting of settings) {
    if (!setting || typeof setting !== 'object') continue;

    // header and paragraph carry no id, so they are numbered in place.
    let key = setting.id;
    if (!key) {
      anonymous++;
      key = `${setting.type || 'item'}__${anonymous}`;
    }

    const here = [...path, key];
    if (setting.label) setting.label = put([...here, 'label'], setting.label);
    if (setting.info) setting.info = put([...here, 'info'], setting.info);
    if (setting.content) setting.content = put([...here, 'content'], setting.content);
    if (setting.placeholder) setting.placeholder = put([...here, 'placeholder'], setting.placeholder);

    if (Array.isArray(setting.options)) {
      setting.options.forEach((option, index) => {
        if (option && option.label) {
          option.label = put([...here, `options__${index + 1}`, 'label'], option.label);
        }
      });
    }
  }
}

function walkSchema(schema, base) {
  if (schema.name) schema.name = put([...base, 'name'], schema.name);
  walkSettings(schema.settings, [...base, 'settings']);

  if (Array.isArray(schema.blocks)) {
    for (const block of schema.blocks) {
      // `{ "type": "@theme" }` and `{ "type": "@app" }` have nothing to translate.
      if (!block || !block.type || block.type.startsWith('@')) continue;
      const blockBase = [...base, 'blocks', block.type];
      if (block.name) block.name = put([...blockBase, 'name'], block.name);
      walkSettings(block.settings, [...blockBase, 'settings']);
    }
  }

  if (Array.isArray(schema.presets)) {
    schema.presets.forEach((preset, index) => {
      if (!preset || !preset.name) return;
      // One preset is by far the common case and reads better unnumbered.
      const key = schema.presets.length === 1 ? 'name' : `name__${index + 1}`;
      preset.name = put([...base, 'presets', key], preset.name);
    });
  }
}

function processDirectory(dir, group) {
  const files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.liquid'));

  for (const file of files) {
    const relPath = `${dir}/${file}`;
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    const match = source.match(SCHEMA_RE);
    if (!match) continue;

    let schema;
    try {
      schema = JSON.parse(match[2]);
    } catch (error) {
      console.error(`  ! ${relPath}: schema is not valid JSON — ${error.message}`);
      process.exitCode = 1;
      continue;
    }

    walkSchema(schema, [group, basename(file, '.liquid')]);

    const rewritten = source.replace(
      SCHEMA_RE,
      `$1\n${JSON.stringify(schema, null, 2)}\n$3`
    );
    writeFileSync(join(ROOT, relPath), rewritten);
  }
}

/**
 * `config/settings_schema.json` is translated the same way, under its own
 * `settings_schema` root. Group names have no id, so the key is a handle made
 * from the name — which is what Shopify's own themes do.
 *
 * `theme_info` is left completely alone: Shopify reads `theme_name`,
 * `theme_author` and the support URLs from it literally, and a `t:` reference
 * there would show up in the admin as the raw key.
 */
function processThemeSettings() {
  const relPath = 'config/settings_schema.json';
  const groups = JSON.parse(readFileSync(join(ROOT, relPath), 'utf8'));

  for (const group of groups) {
    if (!group || group.name === 'theme_info') continue;

    const handle = String(group.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    const base = ['settings_schema', handle];
    if (group.name) group.name = put([...base, 'name'], group.name);
    walkSettings(group.settings, [...base, 'settings']);
  }

  writeFileSync(join(ROOT, relPath), JSON.stringify(groups, null, 2) + '\n');
}

processDirectory('sections', 'sections');
processDirectory('blocks', 'blocks');
processThemeSettings();

writeFileSync(
  LOCALE_PATH,
  JSON.stringify(locale, null, 2) + '\n'
);

const count = (node) =>
  Object.values(node).reduce(
    (total, value) => total + (typeof value === 'string' ? 1 : count(value)),
    0
  );

console.log(`moved ${moved} new strings, carried ${carried} existing ones forward`);
console.log(`locales/en.default.schema.json now holds ${count(locale)} strings`);
