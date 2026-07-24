export type TipContext = Record<string, any>

export type Tip = {
  id?: string
  title?: string
  message?: string
  [key: string]: any
}
