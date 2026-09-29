"use client";

import { Ellipsis, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { cx } from "@/components/ui/cx";

export interface MenuAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  tone?: "default" | "danger";
}

/**
 * Botão de menu (padrão "menu button" do WAI-ARIA): Enter, Espaço ou seta
 * abrem; setas, Home e End andam; Esc fecha e devolve o foco ao botão; Tab ou
 * clique fora fecham. Ao escolher, o foco volta ao botão antes da ação, para o
 * diálogo que a ação abrir devolver o foco ao lugar certo.
 */
export function ActionsMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    itemRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function openAt(index: number) {
    setFocusIndex(index);
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function onButtonKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAt(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(actions.length - 1);
    }
  }

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = actions.length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusIndex((index) => (index >= last ? 0 : index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusIndex((index) => (index <= 0 ? last : index - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setFocusIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setFocusIndex(last);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onButtonKeyDown}
        className="grid size-9 place-items-center rounded-lg text-fg/70 transition-colors hover:bg-fg/[0.07] hover:text-fg aria-expanded:bg-fg/[0.07] aria-expanded:text-fg"
      >
        <Ellipsis aria-hidden="true" className="size-5" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-30 mt-1.5 min-w-[236px] rounded-xl border border-line-strong bg-raised p-1.5 shadow-[0_18px_48px_rgb(0_0_0/0.5)]"
        >
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitem"
                tabIndex={index === focusIndex ? 0 : -1}
                onClick={() => {
                  close(true);
                  action.onSelect();
                }}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-offset-[-2px]",
                  action.tone === "danger" ? "text-danger hover:bg-danger/10 focus:bg-danger/10" : "text-fg/90 hover:bg-fg/[0.07] focus:bg-fg/[0.07]",
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {action.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
