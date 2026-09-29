import { cx } from "@/components/ui/cx";
import { ROLES, STATUS_LABELS, type Role, type StaffStatus } from "@/lib/staff";

type Tone = "neutral" | "pink" | "cyan" | "danger" | "muted";

// Texto sempre em cor cheia ou branco sobre fundo tingido: rosa sobre rosa
// tingido fica no limite (4,9:1), então o selo rosa leva texto branco.
const TONES: Record<Tone, string> = {
  neutral: "border-line-strong bg-fg/[0.05] text-fg/85",
  pink: "border-pink/45 bg-pink/15 text-fg",
  cyan: "border-cyan/35 bg-cyan/10 text-cyan",
  danger: "border-danger/40 bg-danger/10 text-danger",
  muted: "border-line bg-transparent text-fg/65",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12px] leading-none font-semibold whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const ROLE_TONES: Record<Role, Tone> = { admin: "pink", editor: "cyan", viewer: "neutral" };

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={ROLE_TONES[role]}>{ROLES[role].label}</Badge>;
}

const STATUS_TONES: Record<StaffStatus, Tone> = { active: "neutral", disabled: "danger", pending: "muted" };

// Lima é só para pontos: o ponto de "Ativo" usa o ciano, o acento de sucesso do painel.
const STATUS_DOTS: Record<StaffStatus, string> = { active: "bg-cyan", disabled: "bg-danger", pending: "bg-fg/50" };

export function StatusBadge({ status }: { status: StaffStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]}>
      <span
        aria-hidden="true"
        className={cx("size-1.5 rounded-full", STATUS_DOTS[status])}
      />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/** Avatar de iniciais, como o cartão do design. */
export function InitialsAvatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid size-9 shrink-0 place-items-center rounded-full bg-[#2a2a38] font-display text-[12.5px] font-semibold text-fg",
        className,
      )}
    >
      {initials}
    </span>
  );
}
