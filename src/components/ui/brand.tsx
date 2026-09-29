import Image from "next/image";

import { cx } from "@/components/ui/cx";

/** Logo da Imagine com a pílula ADMIN, como no design. */
export function BrandMark({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <Image
        src="/imagine-logo.png"
        alt="Imagine"
        width={610}
        height={139}
        priority={priority}
        sizes="96px"
        className="h-[19px] w-auto"
      />
      <span className="rounded-[5px] border border-pink px-1.5 py-[3px] text-[10px] leading-none font-bold tracking-[0.14em] text-pink">
        ADMIN
      </span>
    </span>
  );
}
