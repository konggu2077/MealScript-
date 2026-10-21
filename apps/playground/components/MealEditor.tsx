'use client';

import Editor, { type Monaco } from '@monaco-editor/react';

/** Monaco Monarch definition for MealScript v0.1. */
export function registerMeal(monaco: Monaco) {
  if (monaco.languages.getLanguages().some((l) => l.id === 'meal')) return;

  monaco.languages.register({ id: 'meal', extensions: ['.meal'], aliases: ['MealScript', 'meal'] });

  monaco.languages.setMonarchTokensProvider('meal', {
    keywords: ['meal'],
    fields: [
      'location',
      'mode',
      'budget',
      'require_keyword',
      'exclude_keywords',
      'min_items',
      'max_items',
      'allow_repeat',
      'optimize',
      'execution',
    ],
    literals: ['pickup', 'delivery', 'dry_run', 'min', 'total_price', 'true', 'false'],
    units: ['CNY'],
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@fields': 'type',
            '@units': 'annotation',
            '@literals': 'identifier',
            '@default': 'identifier',
          },
        }],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/[<>=]=?/, 'operator'],
        [/[{}()[\];:,]/, 'delimiter'],
        [/-?\d+(?:\.\d+)?/, 'number'],
      ],
    },
  });

  // Palette shared with the single-file build (apps/single/template.html).
  monaco.editor.defineTheme('meal-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'F5C242', fontStyle: 'bold' },
      { token: 'type', foreground: '9AA3B2' },
      { token: 'identifier', foreground: 'E8EAF0' },
      { token: 'annotation', foreground: '56D4DD' },
      { token: 'string', foreground: '7EE787' },
      { token: 'number', foreground: '79C0FF' },
      { token: 'operator', foreground: '8B949E' },
      { token: 'delimiter', foreground: '8B949E' },
      { token: 'comment', foreground: '5D6673', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#0E1116',
      'editor.foreground': '#E8EAF0',
      'editorLineNumber.foreground': '#4A4A54',
      'editorCursor.foreground': '#F5C242',
      'editor.selectionBackground': '#333C4D',
      'editor.lineHighlightBackground': '#14181F',
      'editorIndentGuide.background1': '#252C38',
    },
  });
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
}

export default function MealEditor({ value, onChange, onRun }: Props) {
  return (
    <Editor
      language="meal"
      theme="meal-dark"
      value={value}
      onChange={(next) => onChange(next ?? '')}
      beforeMount={registerMeal}
      onMount={(editor, monaco) => {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, onRun);
      }}
      loading={<div className="p-4 text-sm text-[#6b6b75]">正在加载编辑器…</div>}
      options={{
        fontSize: 13,
        lineHeight: 22,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'all',
        tabSize: 2,
        fontLigatures: true,
        padding: { top: 14, bottom: 14 },
        smoothScrolling: true,
        automaticLayout: true,
      }}
    />
  );
}
