"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { cx } from "@/components/ui/cx";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0 && !element.closest("[inert]"),
  );
}

/** Para onde o foco volta se o botão que abriu o diálogo sumiu (ex.: linha removida). */
function fallbackFocusTarget(): HTMLElement | null {
  return document.getElementById("titulo-da-pagina") ?? document.querySelector<HTMLElement>("main");
}

/**
 * Abre o `<dialog>` nativo como modal enquanto `open` for verdadeiro: o resto
 * da página fica inerte, o foco vai para `[data-autofocus]` (ou o primeiro
 * campo) e volta para quem abriu ao fechar.
 */
function useModalDialog(ref: React.RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const preferred =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      dialog.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]):not([readonly]), select:not([disabled]), textarea:not([disabled])') ??
      focusablesIn(dialog)[0];
    preferred?.focus();
    return () => {
      if (dialog.open) dialog.close();
      const target = previous?.isConnected ? previous : fallbackFocusTarget();
      target?.focus();
    };
  }, [open, ref]);
}

/** Tab e Shift+Tab giram dentro do diálogo, sem escapar para a barra do navegador. */
function trapTab(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const items = focusablesIn(event.currentTarget);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === event.currentTarget)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /**
   * Enquanto houver pedido em andamento, Esc e o X não fecham. Se o navegador
   * fechar mesmo assim (no Chrome, o segundo Esc seguido não pode mais ser
   * cancelado; o voltar do Android também fecha), o diálogo reabre na hora.
   */
  busy?: boolean;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "danger";
}

const WIDTHS = { sm: "max-w-[420px]", md: "max-w-[520px]", lg: "max-w-[640px]" };

/**
 * Diálogo modal acessível: `aria-labelledby` no título, foco preso, Esc fecha
 * e o foco volta para o botão que abriu. O conteúdo só existe aberto, então
 * cada abertura começa com o formulário limpo.
 */
export function Dialog({ open, onClose, title, description, children, busy = false, size = "md", tone = "default" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModalDialog(ref, open);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onFocus={(event) => {
        lastFocused.current = event.target;
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={() => {
        if (!open) return;
        if (busy) {
          // Fechou por fora durante o pedido: volta a abrir, com o foco onde estava.
          const dialog = ref.current;
          if (dialog && !dialog.open) dialog.showModal();
          const target = lastFocused.current;
          if (target?.isConnected && dialog?.contains(target)) target.focus();
          return;
        }
        // O navegador pode fechar sozinho (Esc repetido); o estado acompanha.
        onClose();
      }}
      onKeyDown={(event) => {
        // Ocupado, o Esc nem vira pedido de fechar (não gasta a única vez em
        // que o Chrome deixa cancelar o fechamento).
        if (busy && event.key === "Escape") {
          event.preventDefault();
          return;
        }
        trapTab(event);
      }}
      className={cx(
        "m-auto max-h-none w-[calc(100%-32px)] overflow-visible bg-transparent p-0 text-fg",
        WIDTHS[size],
      )}
    >
      {open ? (
        <div
          className={cx(
            "flex max-h-[calc(100dvh-32px)] flex-col overflow-y-auto rounded-2xl border bg-surface shadow-[0_24px_80px_rgb(0_0_0/0.55)]",
            tone === "danger" ? "border-danger/35" : "border-line-strong",
          )}
        >
          <div className="flex items-start gap-4 px-6 pt-6">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="m-0 font-display text-[19px] font-semibold leading-tight tracking-[-0.01em] text-fg">
                {title}
              </h2>
              {description ? (
                <div id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-fg/70">
                  {description}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Fechar"
              className="-mr-2 -mt-1 grid size-9 shrink-0 place-items-center rounded-lg text-fg/65 transition-colors hover:bg-fg/[0.06] hover:text-fg disabled:opacity-40"
            >
              <X aria-hidden="true" className="size-[18px]" />
            </button>
          </div>
          <div className="px-6 pb-6 pt-5">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * Gaveta lateral (menu no celular), com o mesmo comportamento de modal.
 */
export function Drawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref, open);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      data-variant="drawer"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onKeyDown={trapTab}
      className="m-0 h-dvh max-h-none w-[288px] max-w-[86vw] overflow-y-auto border-r border-line bg-ink p-0 text-fg"
    >
      {open ? children : null}
    </dialog>
  );
}
