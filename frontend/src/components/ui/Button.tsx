import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline" | "ghost";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base = "inline-flex items-center justify-center rounded-full text-sm font-medium px-5 py-2.5 transition border";
  const variants: Record<Variant, string> = {
    primary: "bg-[#0f9d58] text-white border-[#0f9d58] hover:bg-[#0b7a43]",
    outline: "bg-white text-[#0f9d58] border-[#0f9d58] hover:bg-emerald-50",
    ghost: "bg-transparent border-transparent text-slate-600 hover:bg-slate-100",
  };
  return <button type="button" className={`${base} ${variants[variant]} disabled:opacity-50 disabled:cursor-not-allowed ${className}`} {...props} />;
}
