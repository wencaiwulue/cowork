export type ComputerUseInputAPI = {
  moveMouse(x: number, y: number, animated?: boolean): Promise<void>
  mouseLocation(): Promise<{ x: number; y: number }>
  mouseButton(
    button?: 'left' | 'right' | 'middle',
    action?: 'click' | 'press' | 'release',
    count?: number,
  ): Promise<void>
  mouseScroll(amount: number, axis?: 'vertical' | 'horizontal'): Promise<void>
  key(name: string, direction?: 'click' | 'press' | 'release'): Promise<void>
  keys(parts: string[]): Promise<void>
  typeText(text: string): Promise<void>
}
export type ComputerUseInput = ComputerUseInputAPI & { isSupported: boolean }

export const isSupported: boolean
export function mouse(action: string, ...args: unknown[]): Promise<void>
export function key(
  name: string,
  direction?: 'click' | 'press' | 'release',
): Promise<void>
export function keys(parts: string[]): Promise<void>
export function typeText(text: string): Promise<void>
export function moveMouse(
  x: number,
  y: number,
  animated?: boolean,
): Promise<void>
export function mouseLocation(): Promise<{ x: number; y: number }>
export function mouseButton(
  button?: 'left' | 'right' | 'middle',
  action?: 'click' | 'press' | 'release',
  count?: number,
): Promise<void>
export function mouseScroll(
  amount: number,
  axis?: 'vertical' | 'horizontal',
): Promise<void>
