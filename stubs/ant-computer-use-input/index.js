export const isSupported = true

export async function mouse(action, ...args) {
  const { mouse: nutMouse, Button, Point } = await import('@nut-tree-fork/nut-js')
  if (action === 'move' || action === 'moveMouse') {
    const [x, y] = args
    await nutMouse.setPosition(new Point(Math.round(x), Math.round(y)))
    return
  }
  if (action === 'leftClick') return nutMouse.leftClick()
  if (action === 'rightClick') return nutMouse.rightClick()
  if (action === 'doubleClick') return nutMouse.doubleClick()
  if (action === 'press') return nutMouse.pressButton(Button.LEFT)
  if (action === 'release') return nutMouse.releaseButton(Button.LEFT)
  throw new Error(`Unsupported local mouse action: ${action}`)
}

export async function key(name, direction = 'click') {
  const { keyboard, Key } = await import('@nut-tree-fork/nut-js')
  const k = keyFromName(Key, name)
  if (direction === 'press') return keyboard.pressKey(k)
  if (direction === 'release') return keyboard.releaseKey(k)
  await keyboard.pressKey(k)
  await keyboard.releaseKey(k)
}

export async function keys(parts) {
  const { keyboard, Key } = await import('@nut-tree-fork/nut-js')
  const resolved = parts.map(part => keyFromName(Key, part))
  await keyboard.pressKey(...resolved)
  await keyboard.releaseKey(...[...resolved].reverse())
}

export async function typeText(text) {
  const { keyboard } = await import('@nut-tree-fork/nut-js')
  await keyboard.type(String(text))
}

export async function moveMouse(x, y) {
  const { mouse: nutMouse, Point } = await import('@nut-tree-fork/nut-js')
  await nutMouse.setPosition(new Point(Math.round(x), Math.round(y)))
}

export async function mouseLocation() {
  const { mouse: nutMouse } = await import('@nut-tree-fork/nut-js')
  return nutMouse.getPosition()
}

export async function mouseButton(button = 'left', action = 'click', count = 1) {
  const { mouse: nutMouse, Button } = await import('@nut-tree-fork/nut-js')
  const btn =
    button === 'right' ? Button.RIGHT : button === 'middle' ? Button.MIDDLE : Button.LEFT
  if (action === 'press') return nutMouse.pressButton(btn)
  if (action === 'release') return nutMouse.releaseButton(btn)
  if (count > 1) return nutMouse.doubleClick(btn)
  return nutMouse.click(btn)
}

export async function mouseScroll(amount, axis = 'vertical') {
  const { mouse: nutMouse } = await import('@nut-tree-fork/nut-js')
  const n = Math.max(1, Math.abs(Math.round(Number(amount))))
  if (axis === 'horizontal') {
    return amount < 0 ? nutMouse.scrollLeft(n) : nutMouse.scrollRight(n)
  }
  return amount < 0 ? nutMouse.scrollUp(n) : nutMouse.scrollDown(n)
}

function keyFromName(Key, name) {
  const normalized = String(name).toLowerCase()
  const aliases = {
    alt: 'LeftAlt',
    option: 'LeftAlt',
    control: 'LeftControl',
    ctrl: 'LeftControl',
    command: 'LeftCmd',
    cmd: 'LeftCmd',
    meta: 'LeftMeta',
    shift: 'LeftShift',
    enter: 'Enter',
    return: 'Return',
    esc: 'Escape',
    escape: 'Escape',
    space: 'Space',
    tab: 'Tab',
    backspace: 'Backspace',
    delete: 'Delete',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
  }
  const enumName =
    aliases[normalized] ??
    (/^[a-z]$/.test(normalized)
      ? normalized.toUpperCase()
      : /^[0-9]$/.test(normalized)
        ? `Num${normalized}`
        : name)
  if (!(enumName in Key)) {
    throw new Error(`Unsupported key: ${name}`)
  }
  return Key[enumName]
}
