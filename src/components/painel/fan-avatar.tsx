import Image from "next/image";

import { cx } from "@/components/ui/cx";
import { initialsOf } from "@/lib/staff";

const SIZES = { sm: "size-8 text-[11.5px]", md: "size-9 text-[12.5px]", lg: "size-14 text-[17px]" } as const;
const PIXELS = { sm: 32, md: 36, lg: 56 } as const;

/**
 * Foto do fã, ou as iniciais quando não há foto. Decorativo: o nome está ao
 * lado. As fotos vêm do Storage com o endereço exato, sem a otimização da Vercel.
 */
export function FanAvatar({
  name,
  photoURL = null,
  size = "md",
  className,
}: {
  name: string;
  photoURL?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#2a2a38] font-display font-semibold text-fg",
        SIZES[size],
        className,
      )}
    >
      {photoURL ? (
        <Image src={photoURL} alt="" fill sizes={`${PIXELS[size]}px`} unoptimized className="object-cover" />
      ) : (
        initialsOf(name.replace(/^@/, ""))
      )}
    </span>
  );
}
