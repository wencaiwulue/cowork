import { runClaudeCliCommand, type CliCommandResult } from './cliCommand'
import type { PluginInstallInput, PluginSetEnabledInput } from './ipc'

export async function listPlugins(cwd: string): Promise<CliCommandResult> {
  return runClaudeCliCommand(cwd, ['plugin', 'list', '--json', '--available'])
}

export async function installPlugin(
  cwd: string,
  input: PluginInstallInput,
): Promise<CliCommandResult> {
  return runClaudeCliCommand(cwd, [
    'plugin',
    'install',
    input.plugin,
    '--scope',
    input.scope,
  ], 120_000)
}

export async function uninstallPlugin(
  cwd: string,
  input: PluginInstallInput,
): Promise<CliCommandResult> {
  return runClaudeCliCommand(cwd, [
    'plugin',
    'uninstall',
    input.plugin,
    '--scope',
    input.scope,
  ], 120_000)
}

export async function updatePlugin(
  cwd: string,
  input: PluginInstallInput,
): Promise<CliCommandResult> {
  return runClaudeCliCommand(cwd, [
    'plugin',
    'update',
    input.plugin,
    '--scope',
    input.scope,
  ], 120_000)
}

export async function setPluginEnabled(
  cwd: string,
  input: PluginSetEnabledInput,
): Promise<CliCommandResult> {
  return runClaudeCliCommand(cwd, [
    'plugin',
    input.enabled ? 'enable' : 'disable',
    input.plugin,
    '--scope',
    input.scope,
  ], 120_000)
}
