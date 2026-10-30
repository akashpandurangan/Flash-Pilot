import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { Slot } from 'radix-ui'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Pill-shaped buttons. `primary` is the near-black default; `accent` (lime) is for the single most
 * important action on a dark or highlighted surface; `secondary` is white with a hairline border.
 */
const buttonStyles = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-white hover:bg-brand-hover active:bg-black',
        accent: 'bg-accent text-ink hover:bg-accent-hover active:bg-accent-hover',
        secondary: 'border border-line-strong bg-surface text-ink hover:bg-sidebar active:bg-subtle',
        ghost: 'text-ink hover:bg-subtle active:bg-line',
        danger: 'bg-danger text-white hover:bg-[#a3301c] active:bg-[#8f2917]',
        'danger-outline': 'border border-danger/40 bg-surface text-danger hover:bg-danger-soft',
        link: 'h-auto rounded-none px-0 text-ink underline underline-offset-4 hover:no-underline',
      },
      size: {
        sm: 'h-8 px-3.5 text-[13px]',
        // 40px on touch screens, 36px with a pointer
        md: 'h-10 px-4 md:h-9',
        // 42px: the header and other primary calls to action
        lg: 'h-[42px] px-5',
        icon: 'size-10 md:size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-[42px]',
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

/** The default, near-black call to action. */
export const PrimaryButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'variant'>>(function PrimaryButton(props, ref) {
  return <Button ref={ref} variant="primary" {...props} />
})

export { buttonStyles }
