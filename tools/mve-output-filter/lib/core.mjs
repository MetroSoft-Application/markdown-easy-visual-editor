/**
 * Pure transformation core for mve-output-filter.
 * This module has no VS Code or browser dependencies and is safe to use from CI scripts.
 */

const ALLOWED_FLAGS = new Set(["d", "g", "i", "m", "s", "u", "v", "y"]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function normalizeFlags(flags, index) {
  const source = flags == null || flags === "" ? "g" : String(flags);
  for (const flag of source) {
    if (!ALLOWED_FLAGS.has(flag)) {
      throw new TypeError(`rules[${index}].flags contains unsupported flag "${flag}".`);
    }
  }

  const unique = [...new Set(source.split(""))];
  if (!unique.includes("g")) unique.push("g");
  return unique.join("");
}

export function normalizeConfig(config) {
  assertObject(config, "config");
  if (!Array.isArray(config.rules)) {
    throw new TypeError("config.rules must be an array.");
  }

  return {
    rules: config.rules.map((rule, index) => {
      assertObject(rule, `rules[${index}]`);

      if (rule.enabled === false) {
        return {
          name: typeof rule.name === "string" && rule.name ? rule.name : `rule-${index + 1}`,
          enabled: false,
          pattern: "",
          flags: "g",
          replacement: "",
        };
      }

      if (typeof rule.pattern !== "string" || rule.pattern.length === 0) {
        throw new TypeError(`rules[${index}].pattern must be a non-empty string.`);
      }
      if (typeof rule.replacement !== "string") {
        throw new TypeError(`rules[${index}].replacement must be a string.`);
      }

      const flags = normalizeFlags(rule.flags, index);
      try {
        // Validate eagerly so CI fails before touching an output file.
        new RegExp(rule.pattern, flags);
      } catch (error) {
        throw new SyntaxError(
          `rules[${index}] has an invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return {
        name: typeof rule.name === "string" && rule.name ? rule.name : `rule-${index + 1}`,
        enabled: true,
        pattern: rule.pattern,
        flags,
        replacement: rule.replacement,
      };
    }),
  };
}

function countMatches(text, regexp) {
  let count = 0;
  for (const _match of text.matchAll(regexp)) count += 1;
  return count;
}

export function applyRules(input, config) {
  if (typeof input !== "string") {
    throw new TypeError("input must be a string.");
  }

  const normalized = normalizeConfig(config);
  let text = input;
  const rules = [];
  let totalMatches = 0;

  for (const rule of normalized.rules) {
    if (!rule.enabled) {
      rules.push({ name: rule.name, matches: 0, skipped: true });
      continue;
    }

    const regexp = new RegExp(rule.pattern, rule.flags);
    const matches = countMatches(text, regexp);
    totalMatches += matches;

    if (matches > 0) {
      text = text.replace(new RegExp(rule.pattern, rule.flags), rule.replacement);
    }

    rules.push({ name: rule.name, matches, skipped: false });
  }

  return {
    text,
    changed: text !== input,
    totalMatches,
    rules,
  };
}
