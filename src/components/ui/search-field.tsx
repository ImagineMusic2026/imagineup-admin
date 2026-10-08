"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";

/**
 * Busca de uma lista: `<form role="search">`, busca no Enter ou no botão, e o
 * resultado anunciado numa região viva que já existe ("3 fãs encontrados").
 * "Limpar busca" volta para a lista de antes.
 */
export function SearchField({
  label,
  placeholder,
  hint,
  busy = false,
  result,
  active,
  onSearch,
  onClear,
}: {
  label: string;
  placeholder?: string;
  hint?: React.ReactNode;
  busy?: boolean;
  /** O que a busca achou, por extenso; também vai para a região viva. */
  result: string;
  /** Há uma busca valendo (mostra "Limpar busca"). */
  active: boolean;
  onSearch: (text: string) => void;
  onClear: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      role="search"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        const value = text.trim();
        if (value) onSearch(value);
      }}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <Field label={label} hint={hint} className="min-w-[220px] flex-1">
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              describedBy={describedBy}
              type="search"
              value={text}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
              className="h-10"
            />
          )}
        </Field>
        <Button type="submit" variant="secondary" busy={busy} className="h-10">
          <Search aria-hidden="true" className="size-4" />
          {busy ? "Buscando..." : "Buscar"}
        </Button>
        {active ? (
          <Button
            variant="ghost"
            className="h-10"
            onClick={() => {
              setText("");
              onClear();
            }}
          >
            <X aria-hidden="true" className="size-4" />
            Limpar busca
          </Button>
        ) : null}
      </div>
      <p aria-live="polite" className="m-0 text-[12.5px] text-fg/65 empty:hidden">
        {result}
      </p>
    </form>
  );
}
