"use client";

import { ImagePlus, LoaderCircle, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { PHOTO_ACCEPT, type ProcessedPhoto } from "@/lib/artist-photo";

export type PhotoValue =
  | { kind: "none" }
  /** Foto já salva na central (edição). */
  | { kind: "current"; url: string }
  /** Foto nova, já recortada e reduzida no navegador, ainda não salva. */
  | { kind: "new"; processed: ProcessedPhoto; previewUrl: string };

function hasFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/**
 * Foto da central: arrastar para a área ou escolher pelo botão (o único
 * elemento focável; a área de soltar não é um botão, para não haver dois
 * alvos para a mesma ação). O campo de arquivo fica escondido e é aberto pelo
 * botão.
 */
export function PhotoField({
  value,
  processing,
  error,
  artistName,
  canRemove,
  disabled,
  onFile,
  onRemove,
  buttonRef,
}: {
  value: PhotoValue;
  processing: boolean;
  error: string | null;
  artistName: string;
  canRemove: boolean;
  disabled: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
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
  // Região viva: diz quando a foto ficou pronta (a prévia sozinha não é anunciada).
  const status = processing
    ? "Preparando a foto..."
    : small
      ? "Foto pequena, pode ficar borrada."
      : value.kind === "new"
        ? "Foto pronta. Ela é enviada quando você salvar."
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
        Foto da central
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
        className={cx(
          "relative aspect-[3/4] w-full max-w-[210px] overflow-hidden rounded-xl border border-dashed transition-colors",
          dragging ? "border-pink bg-pink/[0.08]" : error ? "border-danger/60 bg-sunken" : "border-line-strong bg-sunken",
        )}
      >
        {preview ? (
          <Image
            src={preview}
            alt={artistName ? `Prévia da foto de ${artistName}` : "Prévia da foto da central"}
            fill
            sizes="220px"
            unoptimized
            className="object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <ImagePlus aria-hidden="true" className="size-7 text-fg/55" />
            <p className="m-0 text-[13.5px] font-semibold text-fg/90">Arraste a foto para cá</p>
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

      {/* O botão fica sempre no mesmo lugar: trocar o texto não tira o foco dele. */}
      <div className="flex flex-wrap gap-2">
        <Button ref={buttonRef} size="sm" variant="secondary" onClick={pick} disabled={disabled} aria-describedby={describedBy}>
          {preview ? "Trocar foto" : "Escolher foto"}
        </Button>
        {preview && canRemove ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              onRemove();
              // O botão de remover some junto com a foto: o foco vai para o de escolher.
              buttonRef.current?.focus();
            }}
          >
            Remover foto
          </Button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Limpa o campo para a mesma foto poder ser escolhida de novo.
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
        Foto vertical, de preferência 1200x1600. Aparece na capa da central e na escolha de artistas. JPG, PNG ou WebP.
      </p>
    </div>
  );
}
