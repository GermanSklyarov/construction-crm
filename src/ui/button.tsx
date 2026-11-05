import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";
import type { ComponentProps } from "react";
const variants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 font-semibold disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-teal-900 text-white",
        outline: "border border-slate-300 bg-white text-slate-800",
        destructive: "bg-red-700 text-white",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
export function Button({
  asChild,
  variant,
  className,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={twMerge(variants({ variant }), className)} {...props} />
  );
}
