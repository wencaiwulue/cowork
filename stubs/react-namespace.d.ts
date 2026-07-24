declare namespace React {
  type Key = string | number
  type ReactNode = any
  type ReactElement = any
  type RefObject<T> = { current: T }
  type MutableRefObject<T> = { current: T }
  type Dispatch<T> = (value: T) => void
  type SetStateAction<T> = T | ((prevState: T) => T)
  type ComponentType<P = any> = (props: P) => ReactNode
  type FC<P = any> = ComponentType<P>
  type CSSProperties = Record<string, any>
  type PropsWithChildren<P = any> = P & { children?: ReactNode }
  type Ref<T = any> = any
}

declare module 'react/jsx-runtime' {
  export const Fragment: any
  export function jsx(...args: any[]): any
  export function jsxs(...args: any[]): any
}

declare module 'react/compiler-runtime' {
  export function c(size: number): any[]
}
