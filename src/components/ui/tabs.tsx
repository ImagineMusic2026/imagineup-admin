"use client";

import { useId, useRef, useState } from "react";

import { cx } from "@/components/ui/cx";

export interface TabItem<K extends string> {
  id: K;
  label: React.ReactNode;
  /** O conteúdo só é montado com a aba ativa: a leitura de cada aba é preguiçosa. */
  render: () => React.ReactNode;
}

/**
 * Abas no padrão WAI-ARIA: só a aba ativa entra no Tab, as setas, Home e End
 * trocam de aba (e ativam na hora), e o painel ativo é o único montado.
 * Controlada (`value` e `onChange`) ou não.
 */
export function Tabs<K extends string>({
  label,
  tabs,
  value,
  onChange,
  className,
}: {
  label: string;
  tabs: TabItem<K>[];
  value?: K;
  onChange?: (id: K) => void;
  className?: string;
}) {
  const baseId = useId();
  const [own, setOwn] = useState<K>(tabs[0]?.id as K);
  const selected = value ?? own;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeTab = tabs.find((tab) => tab.id === selected) ?? tabs[0];

  function select(id: K) {
    if (value === undefined) setOwn(id);
    onChange?.(id);
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    select(tabs[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div className={cx("flex min-w-0 flex-col gap-5", className)}>
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
        {tabs.map((tab, index) => {
          const isSelected = tab.id === activeTab?.id;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${baseId}-aba-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-painel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => select(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cx(
                "-mb-px inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-[13.5px] font-semibold whitespace-nowrap transition-colors",
                isSelected ? "border-pink text-fg" : "border-transparent text-fg/60 hover:text-fg",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {activeTab ? (
        <div
          role="tabpanel"
          id={`${baseId}-painel-${activeTab.id}`}
          aria-labelledby={`${baseId}-aba-${activeTab.id}`}
          className="flex min-w-0 flex-col gap-5"
        >
          {activeTab.render()}
        </div>
      ) : null}
    </div>
  );
}
