import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { Slot } from 'radix-ui'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const buttonStyles = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-white hover:bg-brand-hover active:bg-black',
        secondary: 'border border-line-strong bg-canvas text-ink hover:bg-subtle active:bg-line',
        ghost: 'text-ink hover:bg-subtle active:bg-line',
        danger: 'bg-danger text-white hover:bg-[#8f1c13] active:bg-[#7a1810]',
        'danger-outline': 'border border-danger/40 bg-canvas text-danger hover:bg-danger-soft',
        link: 'h-auto px-0 text-ink underline underline-offset-4 hover:no-underline',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10 px-4 md:h-9',
        lg: 'h-11 px-5 text-base',
        icon: 'h-10 w-10 md:h-9 md:w-9',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  loading?: boolean
  /** Render the child element (e.g. a router <Link>) with button styling. */
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, disabled, children, asChild, type = 'button', ...props },
  ref,
) {
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={cn(buttonStyles({ variant, size }), className)} {...props}>
        {children}
      </Slot.Root>
    )
  }
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonStyles({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
})

export { buttonStyles }
