import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface KeybindingContribution {
  key?: string;
  command?: string;
  when?: string;
}

interface PackageManifest {
  contributes?: {
    keybindings?: KeybindingContribution[];
    menus?: Record<string, Array<{ when?: string }>>;
  };
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
) as PackageManifest;

describe('custom editor history keybindings', () => {
  it('uses the current VS Code custom-editor context key for undo and redo', () => {
    const historyBindings = (manifest.contributes?.keybindings ?? []).filter((binding) =>
      binding.command === 'markdownEasyVisualEditor.undo'
      || binding.command === 'markdownEasyVisualEditor.redo'
    );

    expect(historyBindings).not.toHaveLength(0);
    for (const binding of historyBindings) {
      expect(binding.when).toContain("activeCustomEditorId == 'markdownEasyVisualEditor.editor'");
      expect(binding.when).not.toContain('activeCustomEditor ==');
    }
  });

  it('uses activeCustomEditorId for custom-editor title commands too', () => {
    const titleItems = manifest.contributes?.menus?.['editor/title'] ?? [];
    expect(titleItems).not.toHaveLength(0);
    for (const item of titleItems) {
      expect(item.when).toContain("activeCustomEditorId == 'markdownEasyVisualEditor.editor'");
      expect(item.when).not.toContain('activeCustomEditor ==');
    }
  });
});
