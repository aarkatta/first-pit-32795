import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] transition-colors [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-acid text-acid-ink',
        secondary: 'border-transparent bg-paper-deep text-ink-soft',
        outline: 'border-line-strong bg-white text-ink',
        forest: 'border-transparent bg-forest-soft text-acid',
        blue: 'border-transparent bg-blue/10 text-blue',
        orange: 'border-transparent bg-orange/12 text-orange'
      }
    },
    defaultVariants: { variant: 'default' }
  }
);

type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean };

export function Badge({ className, variant, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : 'span';
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

