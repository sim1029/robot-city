import 'react'

declare module 'react' {
  interface HTMLAttributes<T> {
    'hx-get'?: string
    'hx-post'?: string
    'hx-put'?: string
    'hx-delete'?: string
    'hx-target'?: string
    'hx-swap'?: string
    'hx-trigger'?: string
    'hx-include'?: string
    'hx-confirm'?: string
    'hx-vals'?: string
    'hx-headers'?: string
    'hx-push-url'?: string
    'hx-select'?: string
    'hx-ext'?: string
  }
}
