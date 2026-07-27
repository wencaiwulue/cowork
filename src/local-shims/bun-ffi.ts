export const dlopen = () => {
  throw new Error('bun:ffi is unavailable in this local source snapshot build')
}

export const FFIType = {}
export const suffix = ''
export default { dlopen, FFIType, suffix }
