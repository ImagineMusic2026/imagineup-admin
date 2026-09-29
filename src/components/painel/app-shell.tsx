"use client";

import {
  FileText,
  Gift,
  LayoutGrid,
  LogOut,
  Menu,
  Music,
  Shield,
  Target,
  TrendingUp,
  Trophy,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { InitialsAvatar } from "@/components/ui/badge";
import { BrandMark } from "@/components/ui/brand";
import { cx } from "@/components/ui/cx";
import { Drawer } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-context";
import { accessSummary, initialsOf, navGroupsFor, pageForPathname, type NavItem, type StaffMember } from "@/lib/staff";
import { useStaffMember } from "@/lib/staff-context";

const ICONS: Record<NavItem["key"], LucideIcon> = {
  overview: LayoutGrid,
  growth: TrendingUp,
  ranking: Trophy,
  fans: Users,
  artists: Music,
  missions: Target,
  rewards: Gift,
  moderation: Shield,
  audit: FileText,
  team: UserCog,
};

/**
 * Casca do painel: lateral fixa a partir de 1024 px; abaixo disso, barra no
 * topo com o botão que abre a mesma navegação numa gaveta modal.
 * A lateral mostra só o que a pessoa pode ver e acompanha as mudanças de
 * acesso em tempo real (o membro vem do `onSnapshot` do guard).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const member = useStaffMember();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:flex">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-lg bg-pink-strong px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Pular para o conteúdo
      </a>

      <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 border-r border-line bg-ink lg:block">
        <Navigation member={member} />
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-ink/95 px-4 backdrop-blur lg:hidden">
        <Link href="/" aria-label="Painel ImagineUP, início" className="rounded-md">
          <BrandMark priority />
        </Link>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Abrir menu"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          className="-mr-2 grid size-10 place-items-center rounded-lg text-fg/80 transition-colors hover:bg-fg/[0.06] hover:text-fg"
        >
          <Menu aria-hidden="true" className="size-5" />
        </button>
      </header>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Menu do painel">
        <Navigation member={member} onNavigate={() => setDrawerOpen(false)} onClose={() => setDrawerOpen(false)} />
      </Drawer>

      <main id="conteudo" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-9">
        <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}

function Navigation({
  member,
  onNavigate,
  onClose,
}: {
  member: StaffMember;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const current = pageForPathname(pathname);
  const groups = navGroupsFor(member);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[68px] shrink-0 items-center justify-between px-5">
        <Link href="/" onClick={onNavigate} aria-label="Painel ImagineUP, início" className="rounded-md">
          <BrandMark />
        </Link>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar menu"
            className="-mr-2 grid size-10 place-items-center rounded-lg text-fg/75 transition-colors hover:bg-fg/[0.06] hover:text-fg"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        ) : null}
      </div>

      <nav aria-label="Seções do painel" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.id} className="mt-5 first:mt-1">
            <p id={`grupo-${group.id}${onClose ? "-gaveta" : ""}`} className="group-label m-0 px-3 text-fg/50">
              {group.label}
            </p>
            <ul aria-labelledby={`grupo-${group.id}${onClose ? "-gaveta" : ""}`} className="m-0 mt-2 flex list-none flex-col gap-0.5 p-0">
              {group.items.map((item) => {
                const Icon = ICONS[item.key];
                const active = current === item.key;
                return (
                  <li key={item.key}>
                    <Link
                      href={item.route}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex min-h-10 items-center gap-3 rounded-[10px] px-3 py-2 text-[14px] font-medium transition-colors",
                        active ? "bg-pink/[0.14] text-fg" : "text-fg/70 hover:bg-fg/[0.05] hover:text-fg",
                      )}
                    >
                      <Icon aria-hidden="true" className={cx("size-[17px] shrink-0", active ? "text-pink" : "text-fg/60")} />
                      <span className="min-w-0 leading-snug">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <UserCard member={member} />
    </div>
  );
}

function UserCard({ member }: { member: StaffMember }) {
  const { signOut } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const name = member.displayName || member.email;

  async function leave() {
    setLeaving(true);
    try {
      await signOut();
    } catch {
      setLeaving(false);
    }
  }

  return (
    <div className="shrink-0 border-t border-line p-3">
      <div className="flex items-center gap-2.5 rounded-xl px-1 py-1.5">
        <InitialsAvatar initials={initialsOf(member.displayName, member.email)} />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[13.5px] font-semibold text-fg" title={name}>
            {name}
          </p>
          <p className="m-0 truncate text-[12px] text-fg/60">{accessSummary(member)}</p>
        </div>
        <button
          type="button"
          onClick={leave}
          disabled={leaving}
          aria-label="Sair do painel"
          title="Sair"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-fg/65 transition-colors hover:bg-fg/[0.06] hover:text-fg disabled:opacity-50"
        >
          <LogOut aria-hidden="true" className="size-[17px]" />
        </button>
      </div>
    </div>
  );
}
