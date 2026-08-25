import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-all duration-150 ease-out-expo outline-none focus-visible:ring-[3px] focus-visible:ring-blue/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        default:
          'bg-acid text-acid-ink shadow-press-acid hover:-translate-y-px active:translate-y-[2px] active:shadow-press-acid-down',
        ink: 'bg-ink text-white shadow-press-ink hover:-translate-y-px active:translate-y-[2px] active:shadow-press-ink-down',
        outline: 'border border-ink bg-white text-ink hover:bg-paper hover:-translate-y-px hover:shadow-lift',
        ghost: 'text-ink hover:bg-paper-deep',
        link: 'text-blue underline-offset-4 hover:underline',
        inverse: 'bg-white text-ink hover:bg-paper hover:-translate-y-px hover:shadow-lift'
      },
      size: {
        default: 'h-11 px-6 text-[15px]',
        sm: 'h-9 px-4 text-sm',
        lg: 'h-14 px-8 text-lg',
        xl: 'h-16 px-10 text-xl',
        icon: 'size-11'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
);

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

