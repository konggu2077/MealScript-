'use client';

import Editor, { type Monaco } from '@monaco-editor/react';

/** Monaco Monarch definition for MealScript v0.1. */
export function registerMeal(monaco: Monaco) {
  if (monaco.languages.getLanguages().some((l) => l.id === 'meal')) return;

  monaco.languages.register({ id: 'meal', extensions: ['.meal'], aliases: ['MealScript', 'meal'] });

  monaco.languages.setMonarchTokensProvider('meal', {
    keywords: [
      'meal',
      'location',
      'mode',
      'budget',
      'require_keyword',
      'exclude_keywords',
      'min_items',
      'max_items',
      'optimize',
      'execution',
    ],
    literals: ['pickup', 'delivery', 'dry_run', 'min', 'total_price', 'CNY'],
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*[\s\S]*?\*\//, 'comment'],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@literals': 'number',
              '@default': 'identifier',
            },
          },
        ],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/<=-?\d+(?:\.\d+)?|-?\d+(?:\.\d+)?/, 'number'],
        [/[{}()[\];:,]/, 'delimiter'],
        [/<=|</, 'operator'],
      ],
    },
  });

  monaco.editor.defineTheme('meal-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'F0C75E', fontStyle: 'bold' },
      { token: 'string', foreground: '9FE1CB' },
      { token: 'number', foreground: '85B7EB' },
      { token: 'comment', foreground: '6B6B75', fontStyle: 'italic' },
      { token: 'identifier', foreground: 'E7E7EA' },
      { token: 'delimiter', foreground: '8A8A94' },
      { token: 'operator', foreground: 'EF9F27' },
    ],
    colors: {
      'editor.background': '#121215',
      'editor.foreground': '#E7E7EA',
      'editorLineNumber.foreground': '#4A4A54',
      'editorCursor.foreground': '#F0C75E',
      'editor.selectionBackground': '#2A2A31',
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
