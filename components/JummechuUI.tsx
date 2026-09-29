import Link from "next/link";
import type { ReactNode } from "react";

export const jummechuStyles = {
  page: "min-h-screen bg-[#f8f7f3]",
  shell: "mx-auto min-h-screen w-full max-w-md bg-white shadow-sm",
  header: "grid grid-cols-[52px_1fr_52px] items-center border-b border-gray-100 bg-white px-4 py-4",
  section: "px-4 py-5",
  card: "rounded-3xl border border-gray-100 bg-white shadow-sm",
  softCard: "rounded-3xl border border-orange-100 bg-orange-50/60",
  darkCard: "rounded-3xl bg-[#0f172a] text-white shadow-sm",
  primaryButton:
    "rounded-2xl bg-orange-500 font-extrabold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50",
  secondaryButton:
    "rounded-2xl bg-gray-100 font-bold text-gray-600 transition hover:bg-gray-200",
  input:
    "rounded-2xl border border-gray-200 bg-white outline-none transition placeholder:text-gray-300 focus:border-orange-400 focus:ring-4 focus:ring-orange-50",
  orangeBadge:
    "rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-extrabold text-orange-500",
};

export function AppShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className={jummechuStyles.page}>
      <div className={jummechuStyles.shell}>
        {children}
      </div>
    </main>
  );
}

export function AppHeader({
  eyebrow,
  title,
  backHref,
  onBack,
  backLabel = "뒤로가기",
  right,
}: {
  eyebrow?: string;
  title: ReactNode;
  backHref?: string;
  onBack?: () => void;
  backLabel?: string;
  right?: ReactNode;
}) {
  return (
    <header className={jummechuStyles.header}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-full text-xl font-medium text-gray-700 transition hover:bg-gray-100"
          aria-label={backLabel}
          title={backLabel}
        >
          ←
        </button>
      ) : backHref ? (
        <Link
          href={backHref}
          className="flex h-10 w-10 items-center justify-center rounded-full text-xl font-medium text-gray-700 transition hover:bg-gray-100"
          aria-label={backLabel}
          title={backLabel}
        >
          ←
        </Link>
      ) : (
        <div className="h-10 w-10" aria-hidden="true" />
      )}

      <div className="min-w-0 text-center">
        {eyebrow ? (
          <p className="text-[10px] font-black tracking-[0.08em] text-orange-500">
            {eyebrow}
          </p>
        ) : null}
        <div className="truncate text-base font-black text-gray-950">
          {title}
        </div>
      </div>

      <div className="flex h-10 min-w-10 items-center justify-end">
        {right ?? null}
      </div>
    </header>
  );
}

export function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div>
      {eyebrow ? (
        <p className="text-[11px] font-black tracking-[0.08em] text-orange-500">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="mt-1 text-2xl font-black tracking-[-0.02em] text-gray-950">
        {title}
      </h1>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-gray-500">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-black text-gray-950">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-xs leading-5 text-gray-400">
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function EmptyState({
  emoji,
  title,
  description,
}: {
  emoji: string;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="rounded-3xl bg-gray-50 px-5 py-8 text-center">
      <div className="text-4xl">{emoji}</div>
      <p className="mt-3 text-sm font-black text-gray-800">
        {title}
      </p>
      {description ? (
        <p className="mt-2 text-xs leading-5 text-gray-400">
          {description}
        </p>
      ) : null}
    </div>
  );
}
