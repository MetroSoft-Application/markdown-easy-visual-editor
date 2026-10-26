import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyRules, normalizeConfig } from "../lib/core.mjs";

describe("applyRules", () => {
  it("replaces every match even when flags are omitted", () => {
    const result = applyRules("foo foo foo", {
      rules: [{ pattern: "foo", replacement: "bar" }],
    });
    assert.equal(result.text, "bar bar bar");
    assert.equal(result.totalMatches, 3);
    assert.equal(result.changed, true);
  });

  it("omits matched text when replacement is empty", () => {
    const result = applyRules("public [SECRET]hidden[/SECRET] public", {
      rules: [
        {
          pattern: "\\[SECRET\\][\\s\\S]*?\\[/SECRET\\]",
          flags: "i",
          replacement: "",
        },
      ],
    });
    assert.equal(result.text, "public  public");
    assert.equal(result.totalMatches, 1);
  });

  it("supports JavaScript replacement capture references", () => {
    const result = applyRules("Version: 1.2.3", {
      rules: [
        {
          pattern: "(Version:)\\s+(\\d+\\.\\d+\\.\\d+)",
          replacement: "$1 v$2",
        },
      ],
    });
    assert.equal(result.text, "Version: v1.2.3");
  });

  it("applies rules sequentially", () => {
    const result = applyRules("alpha", {
      rules: [
        { pattern: "alpha", replacement: "beta" },
        { pattern: "beta", replacement: "gamma" },
      ],
    });
    assert.equal(result.text, "gamma");
    assert.equal(result.totalMatches, 2);
  });

  it("skips disabled rules", () => {
    const result = applyRules("secret", {
      rules: [
        {
          name: "disabled",
          enabled: false,
          pattern: "secret",
          replacement: "",
        },
      ],
    });
    assert.equal(result.text, "secret");
    assert.deepEqual(result.rules, [
      { name: "disabled", matches: 0, skipped: true },
    ]);
  });

  it("rejects invalid regular expressions before transformation", () => {
    assert.throws(
      () =>
        normalizeConfig({
          rules: [{ pattern: "(", replacement: "" }],
        }),
      /invalid regular expression/i,
    );
  });

  it("rejects unsupported regular-expression flags", () => {
    assert.throws(
      () =>
        normalizeConfig({
          rules: [{ pattern: "x", flags: "q", replacement: "" }],
        }),
      /unsupported flag/i,
    );
  });
});
