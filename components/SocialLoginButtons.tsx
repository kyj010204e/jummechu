import type { ReactNode } from "react";

type SocialProvider = {
  name: string;
  href: string;
  ariaLabel: string;
  className: string;
  iconClassName: string;
  content: ReactNode;
};

const SOCIAL_PROVIDERS: SocialProvider[] = [
  {
    name: "Google",
    href: "/api/oauth/google",
    ariaLabel: "Google로 로그인",
    className:
      "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
    iconClassName: "bg-white border border-gray-200 text-gray-800",
    content: <span className="text-base font-black tracking-tight">G</span>,
  },
  {
    name: "네이버",
    href: "/api/oauth/naver",
    ariaLabel: "네이버로 로그인",
    className: "bg-[#03C75A] text-white hover:brightness-95",
    iconClassName: "bg-white/15 text-white",
    content: <span className="text-base font-black">N</span>,
  },
];

export default function SocialLoginButtons() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {SOCIAL_PROVIDERS.map((provider) => (
        <a
          key={provider.name}
          href={provider.href}
          aria-label={provider.ariaLabel}
          className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl px-3 text-sm font-extrabold shadow-sm transition active:scale-[0.99] ${provider.className}`}
        >
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-xl ${provider.iconClassName}`}
          >
            {provider.content}
          </span>
          <span>{provider.name}</span>
        </a>
      ))}
    </div>
  );
}
