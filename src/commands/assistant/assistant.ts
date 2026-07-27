export function computeDefaultInstallDir(): string {
  return ''
}

export function NewInstallWizard(): null {
  return null
}

export default {
  type: 'local-jsx',
  name: 'assistant',
  description: 'Assistant command unavailable in this local source snapshot build',
  isEnabled: false,
  userFacingName() {
    return 'assistant'
  },
  async call() {
    return 'Assistant command is unavailable in this local source snapshot build.'
  },
}
