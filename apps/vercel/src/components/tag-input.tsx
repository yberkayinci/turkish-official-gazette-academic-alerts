"use client";

import { useId, useRef, useState } from "react";

function splitTags(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function TagInput({
  label,
  hint,
  placeholder,
  values,
  onChange,
  maxItems = 30,
  maxItemLength = 100,
  inputMode = "text",
  error,
}: {
  label: string;
  hint: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
  maxItems?: number;
  maxItemLength?: number;
  inputMode?: "text" | "email";
  error?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");

  function addDraft(value = draft) {
    const additions = splitTags(value);
    if (!additions.length) return;

    const seen = new Set(values.map((item) => item.toLocaleLowerCase("tr-TR")));
    const next = [...values];
    additions.forEach((item) => {
      const normalized = item.toLocaleLowerCase("tr-TR");
      if (!seen.has(normalized) && next.length < maxItems) {
        seen.add(normalized);
        next.push(item.slice(0, maxItemLength));
      }
    });

    onChange(next);
    setDraft("");
    setNotice(
      next.length >= maxItems
        ? `Maximum of ${maxItems} items reached.`
        : `${next.length} item${next.length === 1 ? "" : "s"} added.`,
    );
  }

  function removeTag(index: number) {
    const next = values.filter((_, itemIndex) => itemIndex !== index);
    onChange(next);
    setNotice("Item removed.");
  }

  return (
    <div className={`tag-field ${error ? "field--error" : ""}`.trim()}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="tag-input" onClick={() => inputRef.current?.focus()}>
        {values.map((value, index) => (
          <span className="tag" key={`${value}-${index}`}>
            <span>{value}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                removeTag(index);
              }}
              aria-label={`Remove ${value}`}
            >
              {"\u00d7"}
            </button>
          </span>
        ))}
        <input
          id={id}
          ref={inputRef}
          type={inputMode === "email" ? "email" : "text"}
          inputMode={inputMode}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addDraft();
            }
            if (event.key === "Backspace" && !draft && values.length) {
              removeTag(values.length - 1);
            }
          }}
          onBlur={() => addDraft()}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (/[\n,;]/.test(pasted)) {
              event.preventDefault();
              addDraft(pasted);
            }
          }}
          placeholder={values.length ? "Add another..." : placeholder}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : hintId}
        />
      </div>
      {error ? (
        <span className="field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : (
        <span className="field__hint" id={hintId}>{hint}</span>
      )}
      <span className="sr-only" aria-live="polite">
        {notice}
      </span>
    </div>
  );
}
