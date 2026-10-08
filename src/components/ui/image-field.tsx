"use client";

import { ImagePlus, LoaderCircle, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { IMAGE_ACCEPT, type ProcessedImage } from "@/lib/image-prep";

export type ImageValue =
  | { kind: "none" }
  /** Imagem já salva no documento (edição). */
  | { kind: "current"; url: string }
  /** Imagem nova, já recortada e reduzida no navegador, ainda não enviada. */
  | { kind: "new"; processed: ProcessedImage; previewUrl: string };

function hasFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/**
 * Campo de imagem genérico (o `PhotoField` de Artistas sem o que é só da
 * central): arrastar para a área ou escolher pelo botão, que é o único
 * elemento focável. A imagem é preparada por quem usa (`processImage`) e
 * enviada ao salvar (`media-storage.ts`).
 */
export function ImageField({
  label,
  aspect,
  hint,
  value,
  processing,
  error,
  alt,
  canRemove,
  disabled,
  onFile,
  onRemove,
  buttonRef,
  previewWidth = 220,
}: {
  label: string;
  /** Proporção da prévia em CSS ("4 / 5", "16 / 9"). */
  aspect: string;
  hint: React.ReactNode;
  value: ImageValue;
  processing: boolean;
  error: string | null;
  /** Texto alternativo da prévia. */
  alt: string;
  canRemove: boolean;
  disabled: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  previewWidth?: number;
}) {
  const id = useId();
  const labelId = `${id}-rotulo`;
  const hintId = `${id}-dica`;
  const statusId = `${id}-status`;
  const errorId = `${id}-erro`;
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const preview = value.kind === "new" ? value.previewUrl : value.kind === "current" ? value.url : null;
  const small = value.kind === "new" && value.processed.small;
  const describedBy = [error ? errorId : null, hintId, statusId].filter(Boolean).join(" ");
  const status = processing
    ? "Preparando a imagem..."
    : small
      ? "Imagem pequena, pode ficar borrada."
      : value.kind === "new"
        ? "Imagem pronta. Ela é enviada quando você salvar."
        : "";

  function pick() {
    if (disabled) return;
    inputRef.current?.click();
  }

  function stopDrag() {
    dragDepth.current = 0;
    setDragging(false);
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={labelId}>
      <p id={labelId} className="m-0 text-[13px] font-semibold text-fg/85">
        {label}
      </p>
      <div
        onDragEnter={(event) => {
          if (!hasFiles(event) || disabled) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        }}
        onDragLeave={() => {
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) stopDrag();
        }}
        onDrop={(event) => {
          event.preventDefault();
          stopDrag();
          const file = event.dataTransfer.files[0];
          if (file && !disabled) onFile(file);
        }}
        style={{ aspectRatio: aspect, maxWidth: previewWidth }}
        className={cx(
          "relative w-full overflow-hidden rounded-xl border border-dashed transition-colors",
          dragging ? "border-pink bg-pink/[0.08]" : error ? "border-danger/60 bg-sunken" : "border-line-strong bg-sunken",
        )}
      >
        {preview ? (
          <Image src={preview} alt={alt} fill sizes={`${previewWidth}px`} unoptimized className="object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <ImagePlus aria-hidden="true" className="size-7 text-fg/55" />
            <p className="m-0 text-[13.5px] font-semibold text-fg/90">Arraste a imagem para cá</p>
            <p className="m-0 text-[12.5px] text-fg/55">ou use o botão abaixo</p>
          </div>
        )}
        {dragging && preview ? (
          <div aria-hidden="true" className="absolute inset-0 grid place-items-center bg-ink/70 text-[13.5px] font-semibold text-fg">
            Solte para trocar
          </div>
        ) : null}
        {processing ? (
          <div aria-hidden="true" className="absolute inset-0 grid place-items-center bg-ink/70">
            <LoaderCircle className="size-6 animate-spin text-fg/80" />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button ref={buttonRef} size="sm" variant="secondary" onClick={pick} disabled={disabled} aria-describedby={describedBy}>
          {preview ? "Trocar imagem" : "Escolher imagem"}
        </Button>
        {preview && canRemove ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              onRemove();
              buttonRef.current?.focus();
            }}
          >
            Remover imagem
          </Button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />

      {error ? (
        <p id={errorId} role="alert" className="m-0 text-[12.5px] font-medium leading-snug text-danger">
          {error}
        </p>
      ) : null}
      <p id={statusId} aria-live="polite" className="m-0 flex items-start gap-1.5 text-[12.5px] leading-snug text-fg/85 empty:-mt-2">
        {small && !processing ? <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0 text-danger" /> : null}
        {status}
      </p>
      <p id={hintId} className="m-0 text-[12.5px] leading-snug text-fg/60">
        {hint}
      </p>
    </div>
  );
}
