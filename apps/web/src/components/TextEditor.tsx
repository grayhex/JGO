import { useEffect, useRef, useState } from 'react';
import { TEXT_CONSTRAINT, type TextArea } from '@j2me-web/protocol';
import { t as translateUI } from '../i18n';

/**
 * Editor for the text area the game is asking for (a focused `TextField` or a `TextBox`). The text is sent
 * as it is typed; the game may shorten or filter it and answers with the final text, which replaces ours.
 */
export function TextEditor({ area, onText }: { area: TextArea; onText: (text: string) => void }) {
  const [value, setValue] = useState(area.text);
  // texts we sent a moment ago: the server echoes them back, and an echo must not undo newer typing
  const sent = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<string | null>(null);
  const kind = area.constraints & TEXT_CONSTRAINT.MASK;
  const readOnly = (area.constraints & TEXT_CONSTRAINT.UNEDITABLE) !== 0;
  const password = (area.constraints & TEXT_CONSTRAINT.PASSWORD) !== 0;

  useEffect(() => {
    if (sent.current.includes(area.text)) return;
    setValue(area.text);
  }, [area.text]);

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    const t = pending.current;
    pending.current = null;
    sent.current = [...sent.current.slice(-9), t];
    onText(t);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (t: string) => {
    setValue(t);
    pending.current = t;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 120);
  };

  const common = {
    value,
    readOnly,
    maxLength: area.maxSize > 0 ? area.maxSize : undefined,
    onBlur: flush,
    'aria-label': translateUI('Text input'),
    title: translateUI('Type here; the game receives the text as you type.'),
    autoComplete: 'off',
    autoCapitalize: 'off',
    spellCheck: false,
    className: 'input text-editor-field',
  } as const;
  const inputMode = kind === TEXT_CONSTRAINT.NUMERIC ? 'numeric' : kind === TEXT_CONSTRAINT.DECIMAL ? 'decimal' : kind === TEXT_CONSTRAINT.PHONENUMBER ? 'tel' : kind === TEXT_CONSTRAINT.EMAILADDR ? 'email' : kind === TEXT_CONSTRAINT.URL ? 'url' : 'text';

  return (
    <div className="text-editor" role="group" aria-label={translateUI('Text input')}>
      <div className="text-editor-head">
        <strong>{translateUI('Text input')}</strong>
        <span className="muted">{value.length}{area.maxSize > 0 ? ` / ${area.maxSize}` : ''}</span>
      </div>
      {area.kind === 'box' ? (
        <textarea {...common} rows={4} autoFocus onChange={(e) => change(e.target.value)} />
      ) : (
        <input
          {...common}
          type={password ? 'password' : 'text'}
          inputMode={inputMode}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { flush(); (e.target as HTMLInputElement).blur(); } }}
        />
      )}
    </div>
  );
}
