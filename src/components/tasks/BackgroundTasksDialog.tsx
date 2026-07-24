import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import figures from 'figures';
import React, { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { isCoordinatorMode } from 'src/coordinator/coordinatorMode.js';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import { enterTeammateView, exitTeammateView } from 'src/state/teammateViewHelpers.js';
import type { ToolUseContext } from 'src/Tool.js';
import { DreamTask, type DreamTaskState } from 'src/tasks/DreamTask/DreamTask.js';
import { InProcessTeammateTask } from 'src/tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import type { InProcessTeammateTaskState } from 'src/tasks/InProcessTeammateTask/types.js';
import type { LocalAgentTaskState } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import { LocalAgentTask } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import type { LocalShellTaskState } from 'src/tasks/LocalShellTask/guards.js';
import { LocalShellTask } from 'src/tasks/LocalShellTask/LocalShellTask.js';
// Type import is erased at build time — safe even though module is ant-gated.
import type { LocalWorkflowTaskState } from 'src/tasks/LocalWorkflowTask/LocalWorkflowTask.js';
import type { MonitorMcpTaskState } from 'src/tasks/MonitorMcpTask/MonitorMcpTask.js';
import { RemoteAgentTask, type RemoteAgentTaskState } from 'src/tasks/RemoteAgentTask/RemoteAgentTask.js';
import { type BackgroundTaskState, isBackgroundTask, type TaskState } from 'src/tasks/types.js';
import type { DeepImmutable } from 'src/types/utils.js';
import { intersperse } from 'src/utils/array.js';
import { TEAM_LEAD_NAME } from 'src/utils/swarm/constants.js';
import { stopUltraplan } from '../../commands/ultraplan.js';
import type { CommandResultDisplay } from '../../commands.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import type { ExitState } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { count } from '../../utils/array.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { AsyncAgentDetailDialog } from './AsyncAgentDetailDialog.js';
import { BackgroundTask as BackgroundTaskComponent } from './BackgroundTask.js';
import { DreamDetailDialog } from './DreamDetailDialog.js';
import { InProcessTeammateDetailDialog } from './InProcessTeammateDetailDialog.js';
import { RemoteSessionDetailDialog } from './RemoteSessionDetailDialog.js';
import { ShellDetailDialog } from './ShellDetailDialog.js';
type ViewState = {
  mode: 'list';
} | {
  mode: 'detail';
  itemId: string;
};
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  toolUseContext: ToolUseContext;
  initialDetailTaskId?: string;
};
type ListItem = {
  id: string;
  type: 'local_bash';
  label: string;
  status: string;
  task: DeepImmutable<LocalShellTaskState>;
} | {
  id: string;
  type: 'remote_agent';
  label: string;
  status: string;
  task: DeepImmutable<RemoteAgentTaskState>;
} | {
  id: string;
  type: 'local_agent';
  label: string;
  status: string;
  task: DeepImmutable<LocalAgentTaskState>;
} | {
  id: string;
  type: 'in_process_teammate';
  label: string;
  status: string;
  task: DeepImmutable<InProcessTeammateTaskState>;
} | {
  id: string;
  type: 'local_workflow';
  label: string;
  status: string;
  task: DeepImmutable<LocalWorkflowTaskState>;
} | {
  id: string;
  type: 'monitor_mcp';
  label: string;
  status: string;
  task: DeepImmutable<MonitorMcpTaskState>;
} | {
  id: string;
  type: 'dream';
  label: string;
  status: string;
  task: DeepImmutable<DreamTaskState>;
} | {
  id: string;
  type: 'leader';
  label: string;
  status: 'running';
};

// WORKFLOW_SCRIPTS is ant-only (build_flags.yaml). Static imports would leak
// ~1.3K lines into external builds. Gate with feature() + require so the
// bundler can dead-code-eliminate the branch.
/* eslint-disable @typescript-eslint/no-require-imports */
const WorkflowDetailDialog = feature('WORKFLOW_SCRIPTS') ? (require('./WorkflowDetailDialog.js') as typeof import('./WorkflowDetailDialog.js')).WorkflowDetailDialog : null;
const workflowTaskModule = feature('WORKFLOW_SCRIPTS') ? require('src/tasks/LocalWorkflowTask/LocalWorkflowTask.js') as typeof import('src/tasks/LocalWorkflowTask/LocalWorkflowTask.js') : null;
const killWorkflowTask = workflowTaskModule?.killWorkflowTask ?? null;
const skipWorkflowAgent = workflowTaskModule?.skipWorkflowAgent ?? null;
const retryWorkflowAgent = workflowTaskModule?.retryWorkflowAgent ?? null;
// Relative path, not `src/...` path-mapping — Bun's DCE can statically
// resolve + eliminate `./` requires, but path-mapped strings stay opaque
// and survive as dead literals in the bundle. Matches tasks.ts pattern.
const monitorMcpModule = feature('MONITOR_TOOL') ? require('../../tasks/MonitorMcpTask/MonitorMcpTask.js') as typeof import('../../tasks/MonitorMcpTask/MonitorMcpTask.js') : null;
const killMonitorMcp = monitorMcpModule?.killMonitorMcp ?? null;
const MonitorMcpDetailDialog = feature('MONITOR_TOOL') ? (require('./MonitorMcpDetailDialog.js') as typeof import('./MonitorMcpDetailDialog.js')).MonitorMcpDetailDialog : null;
/* eslint-enable @typescript-eslint/no-require-imports */

// Helper to get filtered background tasks (excludes foregrounded local_agent)
function getSelectableBackgroundTasks(tasks: Record<string, TaskState> | undefined, foregroundedTaskId: string | undefined): TaskState[] {
  const backgroundTasks = Object.values(tasks ?? {}).filter(isBackgroundTask);
  return backgroundTasks.filter(task => !(task.type === 'local_agent' && task.id === foregroundedTaskId));
}
export function BackgroundTasksDialog({
  onDone,
  toolUseContext,
  initialDetailTaskId
}: Props): React.ReactNode {
  const tasks = useAppState(s => s.tasks);
  const foregroundedTaskId = useAppState(s_0 => s_0.foregroundedTaskId);
  const showSpinnerTree = useAppState(s_1 => s_1.expandedView) === 'teammates';
  const setAppState = useSetAppState();
  const killAgentsShortcut = useShortcutDisplay('chat:killAgents', 'Chat', 'ctrl+x ctrl+k');
  const typedTasks = tasks as Record<string, TaskState> | undefined;

  // Track if we skipped list view on mount (for back button behavior)
  const skippedListOnMount = useRef(false);

  // Compute initial view state - skip list if caller provided a specific task,
  // or if there's exactly one task
  const [viewState, setViewState] = useState<ViewState>(() => {
    if (initialDetailTaskId) {
      skippedListOnMount.current = true;
      return {
        mode: 'detail',
        itemId: initialDetailTaskId
      };
    }
    const allItems = getSelectableBackgroundTasks(typedTasks, foregroundedTaskId);
    if (allItems.length === 1) {
      skippedListOnMount.current = true;
      return {
        mode: 'detail',
        itemId: allItems[0]!.id
      };
    }
    return {
      mode: 'list'
    };
  });
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Register as modal overlay so parent Chat keybindings (up/down for history)
  // are deactivated while this dialog is open
  useRegisterOverlay('background-tasks-dialog', true);

  // Memoize the sorted and categorized items together to ensure stable references
  const {
    bashTasks,
    remoteSessions,
    agentTasks,
    teammateTasks,
    workflowTasks,
    mcpMonitors,
    dreamTasks: dreamTasks_0,
    allSelectableItems
  } = useMemo(() => {
    // Filter to only show running/pending background tasks, matching the status bar count
    const backgroundTasks = Object.values(typedTasks ?? {}).filter(isBackgroundTask);
    const allItems_0 = backgroundTasks.map(toListItem);
    const sorted = allItems_0.sort((a, b) => {
      const aStatus = a.status;
      const bStatus = b.status;
      if (aStatus === 'running' && bStatus !== 'running') return -1;
      if (aStatus !== 'running' && bStatus === 'running') return 1;
      const aTime = 'task' in a ? a.task.startTime : 0;
      const bTime = 'task' in b ? b.task.startTime : 0;
      return bTime - aTime;
    });
    const bash = sorted.filter(item => item.type === 'local_bash');
    const remote = sorted.filter(item_0 => item_0.type === 'remote_agent');
    // Exclude foregrounded task - it's being viewed in the main UI, not a background task
    const agent = sorted.filter(item_1 => item_1.type === 'local_agent' && item_1.id !== foregroundedTaskId);
    const workflows = sorted.filter(item_2 => item_2.type === 'local_workflow');
    const monitorMcp = sorted.filter(item_3 => item_3.type === 'monitor_mcp');
    const dreamTasks = sorted.filter(item_4 => item_4.type === 'dream');
    // In spinner-tree mode, exclude teammates from the dialog (they appear in the tree)
    const teammates = showSpinnerTree ? [] : sorted.filter(item_5 => item_5.type === 'in_process_teammate');
    // Add leader entry when there are teammates, so users can foreground back to leader
    const leaderItem: ListItem[] = teammates.length > 0 ? [{
      id: '__leader__',
      type: 'leader',
      label: `@${TEAM_LEAD_NAME}`,
      status: 'running'
    }] : [];
    return {
      bashTasks: bash,
      remoteSessions: remote,
      agentTasks: agent,
      workflowTasks: workflows,
      mcpMonitors: monitorMcp,
      dreamTasks,
      teammateTasks: [...leaderItem, ...teammates],
      // Order MUST match JSX render order (teammates \u2192 bash \u2192 monitorMcp \u2192
      // remote \u2192 agent \u2192 workflows \u2192 dream) so \u2193/\u2191 navigation moves the cursor
      // visually downward.
      allSelectableItems: [...leaderItem, ...teammates, ...bash, ...monitorMcp, ...remote, ...agent, ...workflows, ...dreamTasks]
    };
  }, [typedTasks, foregroundedTaskId, showSpinnerTree]) as {
    bashTasks: ListItem[]
    remoteSessions: ListItem[]
    agentTasks: ListItem[]
    teammateTasks: ListItem[]
    workflowTasks: ListItem[]
    mcpMonitors: ListItem[]
    dreamTasks: ListItem[]
    allSelectableItems: ListItem[]
  };
  const currentSelection = allSelectableItems[selectedIndex] ?? null;

  // Use configurable keybindings for standard navigation and confirm/cancel.
  // confirm:no is handled by Dialog's onCancel prop.
  useKeybindings({
    'confirm:previous': () => setSelectedIndex(prev => Math.max(0, prev - 1)),
    'confirm:next': () => setSelectedIndex(prev_0 => Math.min(allSelectableItems.length - 1, prev_0 + 1)),
    'confirm:yes': () => {
      const current = allSelectableItems[selectedIndex];
      if (current) {
        if (current.type === 'leader') {
          exitTeammateView(setAppState);
          onDone('Viewing leader', {
            display: 'system'
          });
        } else {
          setViewState({
            mode: 'detail',
            itemId: current.id
          });
        }
      }
    }
  }, {
    context: 'Confirmation',
    isActive: viewState.mode === 'list'
  });

  // Component-specific shortcuts (x=stop, f=foreground, right=zoom) shown in UI.
  // These are task-type and status dependent, not standard dialog keybindings.
  const handleKeyDown = (e: KeyboardEvent) => {
    // Only handle input when in list mode
    if (viewState.mode !== 'list') return;
    if (e.key === 'left') {
      e.preventDefault();
      onDone('Background tasks dialog dismissed', {
        display: 'system'
      });
      return;
    }

    // Compute current selection at the time of the key press
    const currentSelection_0 = allSelectableItems[selectedIndex];
    if (!currentSelection_0) return; // everything below requires a selection

    if (e.key === 'x') {
      e.preventDefault();
      if (currentSelection_0.type === 'local_bash' && currentSelection_0.status === 'running') {
        void killShellTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'local_agent' && currentSelection_0.status === 'running') {
        void killAgentTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'in_process_teammate' && currentSelection_0.status === 'running') {
        void killTeammateTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'local_workflow' && currentSelection_0.status === 'running' && killWorkflowTask) {
        killWorkflowTask(currentSelection_0.id, setAppState);
      } else if (currentSelection_0.type === 'monitor_mcp' && currentSelection_0.status === 'running' && killMonitorMcp) {
        killMonitorMcp(currentSelection_0.id, setAppState);
      } else if (currentSelection_0.type === 'dream' && currentSelection_0.status === 'running') {
        void killDreamTask(currentSelection_0.id);
      } else if (currentSelection_0.type === 'remote_agent' && currentSelection_0.status === 'running') {
        if (currentSelection_0.task.isUltraplan) {
          void stopUltraplan(currentSelection_0.id, currentSelection_0.task.sessionId, setAppState);
        } else {
          void killRemoteAgentTask(currentSelection_0.id);
        }
      }
    }
    if (e.key === 'f') {
      if (currentSelection_0.type === 'in_process_teammate' && currentSelection_0.status === 'running') {
        e.preventDefault();
        enterTeammateView(currentSelection_0.id, setAppState);
        onDone('Viewing teammate', {
          display: 'system'
        });
      } else if (currentSelection_0.type === 'leader') {
        e.preventDefault();
        exitTeammateView(setAppState);
        onDone('Viewing leader', {
          display: 'system'
        });
      }
    }
  };
  async function killShellTask(taskId: string): Promise<void> {
    await LocalShellTask.kill(taskId, setAppState);
  }
  async function killAgentTask(taskId_0: string): Promise<void> {
    await LocalAgentTask.kill(taskId_0, setAppState);
  }
  async function killTeammateTask(taskId_1: string): Promise<void> {
    await InProcessTeammateTask.kill(taskId_1, setAppState);
  }
  async function killDreamTask(taskId_2: string): Promise<void> {
    await DreamTask.kill(taskId_2, setAppState);
  }
  async function killRemoteAgentTask(taskId_3: string): Promise<void> {
    await RemoteAgentTask.kill(taskId_3, setAppState);
  }

  // Wrap onDone in useEffectEvent to get a stable reference that always calls
  // the current onDone callback without causing the effect to re-fire.
  const onDoneEvent = useEffectEvent(onDone);
  useEffect(() => {
    if (viewState.mode !== 'list') {
      const task = (typedTasks ?? {})[viewState.itemId];
      // Workflow tasks get a grace: their detail view stays open through
      // completion so the user sees the final state before eviction.
      if (!task || task.type !== 'local_workflow' && !isBackgroundTask(task)) {
        // Task was removed or is no longer a background task (e.g. killed).
        // If we skipped the list on mount, close the dialog entirely.
        if (skippedListOnMount.current) {
          onDoneEvent('Background tasks dialog dismissed', {
            display: 'system'
          });
        } else {
          setViewState({
            mode: 'list'
          });
        }
      }
    }
    const totalItems = allSelectableItems.length;
    if (selectedIndex >= totalItems && totalItems > 0) {
      setSelectedIndex(totalItems - 1);
    }
  }, [viewState, typedTasks, selectedIndex, allSelectableItems, onDoneEvent]);

  // Helper to go back to list view (or close dialog if we skipped list on
  // mount AND there's still only ≤1 item). Checking current count prevents
  // the stale-state trap: if you opened with 1 task (auto-skipped to detail),
  // then a second task started, 'back' should show the list — not close.
  const goBackToList = () => {
    if (skippedListOnMount.current && allSelectableItems.length <= 1) {
      onDone('Background tasks dialog dismissed', {
        display: 'system'
      });
    } else {
      skippedListOnMount.current = false;
      setViewState({
        mode: 'list'
      });
    }
  };

  // If an item is selected, show the appropriate view
  if (viewState.mode !== 'list' && typedTasks) {
    const task_0 = typedTasks[viewState.itemId];
    if (!task_0) {
      return null;
    }

    // Detail mode - show appropriate detail dialog
    switch (task_0.type) {
      case 'local_bash':
        return <ShellDetailDialog shell={task_0} onDone={onDone} onKillShell={() => void killShellTask(task_0.id)} onBack={goBackToList} key={`shell-${task_0.id}`} />;
      case 'local_agent':
        return <AsyncAgentDetailDialog agent={task_0} onDone={onDone} onKillAgent={() => void killAgentTask(task_0.id)} onBack={goBackToList} key={`agent-${task_0.id}`} />;
      case 'remote_agent':
        return React.createElement(RemoteSessionDetailDialog, {
          key: `session-${task_0.id}`,
          session: task_0 as any,
          onDone,
          toolUseContext,
          onBack: goBackToList,
          onKill: task_0.status !== 'running' ? undefined : task_0.isUltraplan ? () => void stopUltraplan(task_0.id, task_0.sessionId, setAppState) : () => void killRemoteAgentTask(task_0.id)
        });
      case 'in_process_teammate':
        return <InProcessTeammateDetailDialog teammate={task_0} onDone={onDone} onKill={task_0.status === 'running' ? () => void killTeammateTask(task_0.id) : undefined} onBack={goBackToList} onForeground={task_0.status === 'running' ? () => {
          enterTeammateView(task_0.id, setAppState);
          onDone('Viewing teammate', {
            display: 'system'
          });
        } : undefined} key={`teammate-${task_0.id}`} />;
      case 'local_workflow':
        if (!WorkflowDetailDialog) return null;
        return <WorkflowDetailDialog workflow={task_0} onDone={onDone} onKill={task_0.status === 'running' && killWorkflowTask ? () => killWorkflowTask(task_0.id, setAppState) : undefined} onSkipAgent={task_0.status === 'running' && skipWorkflowAgent ? agentId => skipWorkflowAgent(task_0.id, agentId, setAppState) : undefined} onRetryAgent={task_0.status === 'running' && retryWorkflowAgent ? agentId_0 => retryWorkflowAgent(task_0.id, agentId_0, setAppState) : undefined} onBack={goBackToList} key={`workflow-${task_0.id}`} />;
      case 'monitor_mcp':
        if (!MonitorMcpDetailDialog) return null;
        return <MonitorMcpDetailDialog task={task_0} onKill={task_0.status === 'running' && killMonitorMcp ? () => killMonitorMcp(task_0.id, setAppState) : undefined} onBack={goBackToList} key={`monitor-mcp-${task_0.id}`} />;
      case 'dream':
        return <DreamDetailDialog task={task_0} onDone={() => onDone('Background tasks dialog dismissed', {
          display: 'system'
        })} onBack={goBackToList} onKill={task_0.status === 'running' ? () => void killDreamTask(task_0.id) : undefined} key={`dream-${task_0.id}`} />;
    }
  }
  const runningBashCount = count(bashTasks, _ => _.status === 'running');
  const runningAgentCount = count(remoteSessions, __0 => __0.status === 'running' || __0.status === 'pending') + count(agentTasks, __1 => __1.status === 'running');
  const runningTeammateCount = count(teammateTasks, __2 => __2.status === 'running');
  const subtitle = intersperse([...(runningTeammateCount > 0 ? [<Text key="teammates">
              {runningTeammateCount}{' '}
              {runningTeammateCount !== 1 ? 'agents' : 'agent'}
            </Text>] : []), ...(runningBashCount > 0 ? [<Text key="shells">
              {runningBashCount}{' '}
              {runningBashCount !== 1 ? 'active shells' : 'active shell'}
            </Text>] : []), ...(runningAgentCount > 0 ? [<Text key="agents">
              {runningAgentCount}{' '}
              {runningAgentCount !== 1 ? 'active agents' : 'active agent'}
            </Text>] : [])], index => <Text key={`separator-${index}`}> · </Text>);
  const actions = [<KeyboardShortcutHint key="upDown" shortcut="↑/↓" action="select" />, <KeyboardShortcutHint key="enter" shortcut="Enter" action="view" />, ...(currentSelection?.type === 'in_process_teammate' && currentSelection.status === 'running' ? [<KeyboardShortcutHint key="foreground" shortcut="f" action="foreground" />] : []), ...((currentSelection?.type === 'local_bash' || currentSelection?.type === 'local_agent' || currentSelection?.type === 'in_process_teammate' || currentSelection?.type === 'local_workflow' || currentSelection?.type === 'monitor_mcp' || currentSelection?.type === 'dream' || currentSelection?.type === 'remote_agent') && currentSelection.status === 'running' ? [<KeyboardShortcutHint key="kill" shortcut="x" action="stop" />] : []), ...(agentTasks.some(t => t.status === 'running') ? [<KeyboardShortcutHint key="kill-all" shortcut={killAgentsShortcut} action="stop all agents" />] : []), <KeyboardShortcutHint key="esc" shortcut="←/Esc" action="close" />];
  const handleCancel = () => onDone('Background tasks dialog dismissed', {
    display: 'system'
  });
  function renderInputGuide(exitState: ExitState): React.ReactNode {
    if (exitState.pending) {
      return <Text>Press {exitState.keyName} again to exit</Text>;
    }
    return <Byline>{actions}</Byline>;
  }
  return <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog title="Background tasks" subtitle={<>{subtitle}</>} onCancel={handleCancel} color="background" inputGuide={renderInputGuide}>
        {allSelectableItems.length === 0 ? <Text dimColor>No tasks currently running</Text> : <Box flexDirection="column">
            {teammateTasks.length > 0 && <Box flexDirection="column">
                {(bashTasks.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0) && <Text dimColor>
                    <Text bold>{'  '}Agents</Text> (
                    {count(teammateTasks, i => i.type !== 'leader')})
                  </Text>}
                <Box flexDirection="column">
                  <TeammateTaskGroups teammateTasks={teammateTasks} currentSelectionId={currentSelection?.id} />
                </Box>
              </Box>}

            {bashTasks.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 ? 1 : 0}>
                {(teammateTasks.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0) && <Text dimColor>
                    <Text bold>{'  '}Shells</Text> ({bashTasks.length})
                  </Text>}
                <Box flexDirection="column">
                  {bashTasks.map(item_6 => <Item key={item_6.id} item={item_6} isSelected={item_6.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {mcpMonitors.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Monitors</Text> ({mcpMonitors.length})
                </Text>
                <Box flexDirection="column">
                  {mcpMonitors.map(item_7 => <Item key={item_7.id} item={item_7} isSelected={item_7.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {remoteSessions.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Remote agents</Text> ({remoteSessions.length}
                  )
                </Text>
                <Box flexDirection="column">
                  {remoteSessions.map(item_8 => <Item key={item_8.id} item={item_8} isSelected={item_8.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {agentTasks.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 || remoteSessions.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Local agents</Text> ({agentTasks.length})
                </Text>
                <Box flexDirection="column">
                  {agentTasks.map(item_9 => <Item key={item_9.id} item={item_9} isSelected={item_9.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {workflowTasks.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Workflows</Text> ({workflowTasks.length})
                </Text>
                <Box flexDirection="column">
                  {workflowTasks.map(item_10 => <Item key={item_10.id} item={item_10} isSelected={item_10.id === currentSelection?.id} />)}
                </Box>
              </Box>}

            {dreamTasks_0.length > 0 && <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 || remoteSessions.length > 0 || agentTasks.length > 0 || workflowTasks.length > 0 ? 1 : 0}>
                <Box flexDirection="column">
                  {dreamTasks_0.map(item_11 => <Item key={item_11.id} item={item_11} isSelected={item_11.id === currentSelection?.id} />)}
                </Box>
              </Box>}
          </Box>}
      </Dialog>
    </Box>;
}
function toListItem(task: BackgroundTaskState): ListItem {
  switch (task.type) {
    case 'local_bash':
      return {
        id: task.id,
        type: 'local_bash',
        label: task.kind === 'monitor' ? task.description : task.command,
        status: task.status,
        task
      };
    case 'remote_agent':
      return {
        id: task.id,
        type: 'remote_agent',
        label: task.title,
        status: task.status,
        task
      };
    case 'local_agent':
      return {
        id: task.id,
        type: 'local_agent',
        label: task.description,
        status: task.status,
        task
      };
    case 'in_process_teammate':
      return {
        id: task.id,
        type: 'in_process_teammate',
        label: `@${task.identity.agentName}`,
        status: task.status,
        task
      };
    case 'local_workflow':
      return {
        id: task.id,
        type: 'local_workflow',
        label: task.summary ?? task.description,
        status: task.status,
        task
      };
    case 'monitor_mcp':
      return {
        id: task.id,
        type: 'monitor_mcp',
        label: task.description,
        status: task.status,
        task
      };
    case 'dream':
      return {
        id: task.id,
        type: 'dream',
        label: task.description,
        status: task.status,
        task
      };
  }
}
function Item(t0) {
  const $ = _c(14);
  const {
    item,
    isSelected
  } = t0;
  const {
    columns
  } = useTerminalSize();
  const maxActivityWidth = Math.max(30, columns - 26);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = isCoordinatorMode();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const useGreyPointer = t1;
  const t2 = useGreyPointer && isSelected;
  const t3 = isSelected ? figures.pointer + " " : "  ";
  let t4;
  if ($[1] !== t2 || $[2] !== t3) {
    t4 = <Text dimColor={t2}>{t3}</Text>;
    $[1] = t2;
    $[2] = t3;
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  const t5 = isSelected && !useGreyPointer ? "suggestion" : undefined;
  let t6;
  const taskItem = item as Extract<ListItem, { task: unknown }>
  if ($[4] !== taskItem.task || $[5] !== item.type || $[6] !== maxActivityWidth) {
    t6 = item.type === "leader" ? <Text>@{TEAM_LEAD_NAME}</Text> : <BackgroundTaskComponent task={taskItem.task as any} maxActivityWidth={maxActivityWidth} />;
    $[4] = taskItem.task;
    $[5] = item.type;
    $[6] = maxActivityWidth;
    $[7] = t6;
  } else {
    t6 = $[7];
  }
  let t7;
  if ($[8] !== t5 || $[9] !== t6) {
    t7 = <Text color={t5}>{t6}</Text>;
    $[8] = t5;
    $[9] = t6;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  let t8;
  if ($[11] !== t4 || $[12] !== t7) {
    t8 = <Box flexDirection="row">{t4}{t7}</Box>;
    $[11] = t4;
    $[12] = t7;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  return t8;
}
function TeammateTaskGroups(t0) {
  const $ = _c(3);
  const {
    teammateTasks,
    currentSelectionId
  } = t0;
  let t1;
  if ($[0] !== currentSelectionId || $[1] !== teammateTasks) {
    const leaderItems = teammateTasks.filter(_temp);
    const teammateItems = teammateTasks.filter(_temp2) as Extract<ListItem, { type: 'in_process_teammate' }>[];
    const teams = new Map<string, Extract<ListItem, { type: 'in_process_teammate' }>[]>();
    for (const item of teammateItems) {
      const teamName = item.task.identity.teamName;
      const group = teams.get(teamName);
      if (group) {
        group.push(item);
      } else {
        teams.set(teamName, [item]);
      }
    }
    const teamEntries = [...teams.entries()];
    t1 = <>{teamEntries.map(t2 => {
        const [teamName_0, items] = t2;
        const memberCount = items.length + leaderItems.length;
        return <Box key={teamName_0} flexDirection="column"><Text dimColor={true}>{"  "}Team: {teamName_0} ({memberCount})</Text>{leaderItems.map(item_0 => <Item key={`${item_0.id}-${teamName_0}`} item={item_0} isSelected={item_0.id === currentSelectionId} />)}{items.map(item_1 => <Item key={item_1.id} item={item_1} isSelected={item_1.id === currentSelectionId} />)}</Box>;
      })}</>;
    $[0] = currentSelectionId;
    $[1] = teammateTasks;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  return t1;
}
function _temp2(i_0) {
  return i_0.type === "in_process_teammate";
}
function _temp(i) {
  return i.type === "leader";
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmZWF0dXJlIiwiZmlndXJlcyIsIlJlYWN0IiwiUmVhY3ROb2RlIiwidXNlRWZmZWN0IiwidXNlRWZmZWN0RXZlbnQiLCJ1c2VNZW1vIiwidXNlUmVmIiwidXNlU3RhdGUiLCJpc0Nvb3JkaW5hdG9yTW9kZSIsInVzZVRlcm1pbmFsU2l6ZSIsInVzZUFwcFN0YXRlIiwidXNlU2V0QXBwU3RhdGUiLCJlbnRlclRlYW1tYXRlVmlldyIsImV4aXRUZWFtbWF0ZVZpZXciLCJUb29sVXNlQ29udGV4dCIsIkRyZWFtVGFzayIsIkRyZWFtVGFza1N0YXRlIiwiSW5Qcm9jZXNzVGVhbW1hdGVUYXNrIiwiSW5Qcm9jZXNzVGVhbW1hdGVUYXNrU3RhdGUiLCJMb2NhbEFnZW50VGFza1N0YXRlIiwiTG9jYWxBZ2VudFRhc2siLCJMb2NhbFNoZWxsVGFza1N0YXRlIiwiTG9jYWxTaGVsbFRhc2siLCJMb2NhbFdvcmtmbG93VGFza1N0YXRlIiwiTW9uaXRvck1jcFRhc2tTdGF0ZSIsIlJlbW90ZUFnZW50VGFzayIsIlJlbW90ZUFnZW50VGFza1N0YXRlIiwiQmFja2dyb3VuZFRhc2tTdGF0ZSIsImlzQmFja2dyb3VuZFRhc2siLCJUYXNrU3RhdGUiLCJEZWVwSW1tdXRhYmxlIiwiaW50ZXJzcGVyc2UiLCJURUFNX0xFQURfTkFNRSIsInN0b3BVbHRyYXBsYW4iLCJDb21tYW5kUmVzdWx0RGlzcGxheSIsInVzZVJlZ2lzdGVyT3ZlcmxheSIsIkV4aXRTdGF0ZSIsIktleWJvYXJkRXZlbnQiLCJCb3giLCJUZXh0IiwidXNlS2V5YmluZGluZ3MiLCJ1c2VTaG9ydGN1dERpc3BsYXkiLCJjb3VudCIsIkJ5bGluZSIsIkRpYWxvZyIsIktleWJvYXJkU2hvcnRjdXRIaW50IiwiQXN5bmNBZ2VudERldGFpbERpYWxvZyIsIkJhY2tncm91bmRUYXNrIiwiQmFja2dyb3VuZFRhc2tDb21wb25lbnQiLCJEcmVhbURldGFpbERpYWxvZyIsIkluUHJvY2Vzc1RlYW1tYXRlRGV0YWlsRGlhbG9nIiwiUmVtb3RlU2Vzc2lvbkRldGFpbERpYWxvZyIsIlNoZWxsRGV0YWlsRGlhbG9nIiwiVmlld1N0YXRlIiwibW9kZSIsIml0ZW1JZCIsIlByb3BzIiwib25Eb25lIiwicmVzdWx0Iiwib3B0aW9ucyIsImRpc3BsYXkiLCJ0b29sVXNlQ29udGV4dCIsImluaXRpYWxEZXRhaWxUYXNrSWQiLCJMaXN0SXRlbSIsImlkIiwidHlwZSIsImxhYmVsIiwic3RhdHVzIiwidGFzayIsIldvcmtmbG93RGV0YWlsRGlhbG9nIiwicmVxdWlyZSIsIndvcmtmbG93VGFza01vZHVsZSIsImtpbGxXb3JrZmxvd1Rhc2siLCJza2lwV29ya2Zsb3dBZ2VudCIsInJldHJ5V29ya2Zsb3dBZ2VudCIsIm1vbml0b3JNY3BNb2R1bGUiLCJraWxsTW9uaXRvck1jcCIsIk1vbml0b3JNY3BEZXRhaWxEaWFsb2ciLCJnZXRTZWxlY3RhYmxlQmFja2dyb3VuZFRhc2tzIiwidGFza3MiLCJSZWNvcmQiLCJmb3JlZ3JvdW5kZWRUYXNrSWQiLCJiYWNrZ3JvdW5kVGFza3MiLCJPYmplY3QiLCJ2YWx1ZXMiLCJmaWx0ZXIiLCJCYWNrZ3JvdW5kVGFza3NEaWFsb2ciLCJzIiwic2hvd1NwaW5uZXJUcmVlIiwiZXhwYW5kZWRWaWV3Iiwic2V0QXBwU3RhdGUiLCJraWxsQWdlbnRzU2hvcnRjdXQiLCJ0eXBlZFRhc2tzIiwic2tpcHBlZExpc3RPbk1vdW50Iiwidmlld1N0YXRlIiwic2V0Vmlld1N0YXRlIiwiY3VycmVudCIsImFsbEl0ZW1zIiwibGVuZ3RoIiwic2VsZWN0ZWRJbmRleCIsInNldFNlbGVjdGVkSW5kZXgiLCJiYXNoVGFza3MiLCJyZW1vdGVTZXNzaW9ucyIsImFnZW50VGFza3MiLCJ0ZWFtbWF0ZVRhc2tzIiwid29ya2Zsb3dUYXNrcyIsIm1jcE1vbml0b3JzIiwiZHJlYW1UYXNrcyIsImFsbFNlbGVjdGFibGVJdGVtcyIsIm1hcCIsInRvTGlzdEl0ZW0iLCJzb3J0ZWQiLCJzb3J0IiwiYSIsImIiLCJhU3RhdHVzIiwiYlN0YXR1cyIsImFUaW1lIiwic3RhcnRUaW1lIiwiYlRpbWUiLCJiYXNoIiwiaXRlbSIsInJlbW90ZSIsImFnZW50Iiwid29ya2Zsb3dzIiwibW9uaXRvck1jcCIsInRlYW1tYXRlcyIsImxlYWRlckl0ZW0iLCJjdXJyZW50U2VsZWN0aW9uIiwiY29uZmlybTpwcmV2aW91cyIsInByZXYiLCJNYXRoIiwibWF4IiwiY29uZmlybTpuZXh0IiwibWluIiwiY29uZmlybTp5ZXMiLCJjb250ZXh0IiwiaXNBY3RpdmUiLCJoYW5kbGVLZXlEb3duIiwiZSIsImtleSIsInByZXZlbnREZWZhdWx0Iiwia2lsbFNoZWxsVGFzayIsImtpbGxBZ2VudFRhc2siLCJraWxsVGVhbW1hdGVUYXNrIiwia2lsbERyZWFtVGFzayIsImlzVWx0cmFwbGFuIiwic2Vzc2lvbklkIiwia2lsbFJlbW90ZUFnZW50VGFzayIsInRhc2tJZCIsIlByb21pc2UiLCJraWxsIiwib25Eb25lRXZlbnQiLCJ0b3RhbEl0ZW1zIiwiZ29CYWNrVG9MaXN0IiwidW5kZWZpbmVkIiwiYWdlbnRJZCIsInJ1bm5pbmdCYXNoQ291bnQiLCJfIiwicnVubmluZ0FnZW50Q291bnQiLCJydW5uaW5nVGVhbW1hdGVDb3VudCIsInN1YnRpdGxlIiwiaW5kZXgiLCJhY3Rpb25zIiwic29tZSIsInQiLCJoYW5kbGVDYW5jZWwiLCJyZW5kZXJJbnB1dEd1aWRlIiwiZXhpdFN0YXRlIiwicGVuZGluZyIsImtleU5hbWUiLCJpIiwia2luZCIsImRlc2NyaXB0aW9uIiwiY29tbWFuZCIsInRpdGxlIiwiaWRlbnRpdHkiLCJhZ2VudE5hbWUiLCJzdW1tYXJ5IiwiSXRlbSIsInQwIiwiJCIsIl9jIiwiaXNTZWxlY3RlZCIsImNvbHVtbnMiLCJtYXhBY3Rpdml0eVdpZHRoIiwidDEiLCJTeW1ib2wiLCJmb3IiLCJ1c2VHcmV5UG9pbnRlciIsInQyIiwidDMiLCJwb2ludGVyIiwidDQiLCJ0NSIsInQ2IiwidDciLCJ0OCIsIlRlYW1tYXRlVGFza0dyb3VwcyIsImN1cnJlbnRTZWxlY3Rpb25JZCIsImxlYWRlckl0ZW1zIiwiX3RlbXAiLCJ0ZWFtbWF0ZUl0ZW1zIiwiX3RlbXAyIiwidGVhbXMiLCJNYXAiLCJ0ZWFtTmFtZSIsImdyb3VwIiwiZ2V0IiwicHVzaCIsInNldCIsInRlYW1FbnRyaWVzIiwiZW50cmllcyIsInRlYW1OYW1lXzAiLCJpdGVtcyIsIm1lbWJlckNvdW50IiwiaXRlbV8wIiwiaXRlbV8xIiwiaV8wIl0sInNvdXJjZXMiOlsiQmFja2dyb3VuZFRhc2tzRGlhbG9nLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBmZWF0dXJlIH0gZnJvbSAnYnVuOmJ1bmRsZSdcbmltcG9ydCBmaWd1cmVzIGZyb20gJ2ZpZ3VyZXMnXG5pbXBvcnQgUmVhY3QsIHtcbiAgdHlwZSBSZWFjdE5vZGUsXG4gIHVzZUVmZmVjdCxcbiAgdXNlRWZmZWN0RXZlbnQsXG4gIHVzZU1lbW8sXG4gIHVzZVJlZixcbiAgdXNlU3RhdGUsXG59IGZyb20gJ3JlYWN0J1xuaW1wb3J0IHsgaXNDb29yZGluYXRvck1vZGUgfSBmcm9tICdzcmMvY29vcmRpbmF0b3IvY29vcmRpbmF0b3JNb2RlLmpzJ1xuaW1wb3J0IHsgdXNlVGVybWluYWxTaXplIH0gZnJvbSAnc3JjL2hvb2tzL3VzZVRlcm1pbmFsU2l6ZS5qcydcbmltcG9ydCB7IHVzZUFwcFN0YXRlLCB1c2VTZXRBcHBTdGF0ZSB9IGZyb20gJ3NyYy9zdGF0ZS9BcHBTdGF0ZS5qcydcbmltcG9ydCB7XG4gIGVudGVyVGVhbW1hdGVWaWV3LFxuICBleGl0VGVhbW1hdGVWaWV3LFxufSBmcm9tICdzcmMvc3RhdGUvdGVhbW1hdGVWaWV3SGVscGVycy5qcydcbmltcG9ydCB0eXBlIHsgVG9vbFVzZUNvbnRleHQgfSBmcm9tICdzcmMvVG9vbC5qcydcbmltcG9ydCB7XG4gIERyZWFtVGFzayxcbiAgdHlwZSBEcmVhbVRhc2tTdGF0ZSxcbn0gZnJvbSAnc3JjL3Rhc2tzL0RyZWFtVGFzay9EcmVhbVRhc2suanMnXG5pbXBvcnQgeyBJblByb2Nlc3NUZWFtbWF0ZVRhc2sgfSBmcm9tICdzcmMvdGFza3MvSW5Qcm9jZXNzVGVhbW1hdGVUYXNrL0luUHJvY2Vzc1RlYW1tYXRlVGFzay5qcydcbmltcG9ydCB0eXBlIHsgSW5Qcm9jZXNzVGVhbW1hdGVUYXNrU3RhdGUgfSBmcm9tICdzcmMvdGFza3MvSW5Qcm9jZXNzVGVhbW1hdGVUYXNrL3R5cGVzLmpzJ1xuaW1wb3J0IHR5cGUgeyBMb2NhbEFnZW50VGFza1N0YXRlIH0gZnJvbSAnc3JjL3Rhc2tzL0xvY2FsQWdlbnRUYXNrL0xvY2FsQWdlbnRUYXNrLmpzJ1xuaW1wb3J0IHsgTG9jYWxBZ2VudFRhc2sgfSBmcm9tICdzcmMvdGFza3MvTG9jYWxBZ2VudFRhc2svTG9jYWxBZ2VudFRhc2suanMnXG5pbXBvcnQgdHlwZSB7IExvY2FsU2hlbGxUYXNrU3RhdGUgfSBmcm9tICdzcmMvdGFza3MvTG9jYWxTaGVsbFRhc2svZ3VhcmRzLmpzJ1xuaW1wb3J0IHsgTG9jYWxTaGVsbFRhc2sgfSBmcm9tICdzcmMvdGFza3MvTG9jYWxTaGVsbFRhc2svTG9jYWxTaGVsbFRhc2suanMnXG4vLyBUeXBlIGltcG9ydCBpcyBlcmFzZWQgYXQgYnVpbGQgdGltZSDigJQgc2FmZSBldmVuIHRob3VnaCBtb2R1bGUgaXMgYW50LWdhdGVkLlxuaW1wb3J0IHR5cGUgeyBMb2NhbFdvcmtmbG93VGFza1N0YXRlIH0gZnJvbSAnc3JjL3Rhc2tzL0xvY2FsV29ya2Zsb3dUYXNrL0xvY2FsV29ya2Zsb3dUYXNrLmpzJ1xuaW1wb3J0IHR5cGUgeyBNb25pdG9yTWNwVGFza1N0YXRlIH0gZnJvbSAnc3JjL3Rhc2tzL01vbml0b3JNY3BUYXNrL01vbml0b3JNY3BUYXNrLmpzJ1xuaW1wb3J0IHtcbiAgUmVtb3RlQWdlbnRUYXNrLFxuICB0eXBlIFJlbW90ZUFnZW50VGFza1N0YXRlLFxufSBmcm9tICdzcmMvdGFza3MvUmVtb3RlQWdlbnRUYXNrL1JlbW90ZUFnZW50VGFzay5qcydcbmltcG9ydCB7XG4gIHR5cGUgQmFja2dyb3VuZFRhc2tTdGF0ZSxcbiAgaXNCYWNrZ3JvdW5kVGFzayxcbiAgdHlwZSBUYXNrU3RhdGUsXG59IGZyb20gJ3NyYy90YXNrcy90eXBlcy5qcydcbmltcG9ydCB0eXBlIHsgRGVlcEltbXV0YWJsZSB9IGZyb20gJ3NyYy90eXBlcy91dGlscy5qcydcbmltcG9ydCB7IGludGVyc3BlcnNlIH0gZnJvbSAnc3JjL3V0aWxzL2FycmF5LmpzJ1xuaW1wb3J0IHsgVEVBTV9MRUFEX05BTUUgfSBmcm9tICdzcmMvdXRpbHMvc3dhcm0vY29uc3RhbnRzLmpzJ1xuaW1wb3J0IHsgc3RvcFVsdHJhcGxhbiB9IGZyb20gJy4uLy4uL2NvbW1hbmRzL3VsdHJhcGxhbi5qcydcbmltcG9ydCB0eXBlIHsgQ29tbWFuZFJlc3VsdERpc3BsYXkgfSBmcm9tICcuLi8uLi9jb21tYW5kcy5qcydcbmltcG9ydCB7IHVzZVJlZ2lzdGVyT3ZlcmxheSB9IGZyb20gJy4uLy4uL2NvbnRleHQvb3ZlcmxheUNvbnRleHQuanMnXG5pbXBvcnQgdHlwZSB7IEV4aXRTdGF0ZSB9IGZyb20gJy4uLy4uL2hvb2tzL3VzZUV4aXRPbkN0cmxDRFdpdGhLZXliaW5kaW5ncy5qcydcbmltcG9ydCB0eXBlIHsgS2V5Ym9hcmRFdmVudCB9IGZyb20gJy4uLy4uL2luay9ldmVudHMva2V5Ym9hcmQtZXZlbnQuanMnXG5pbXBvcnQgeyBCb3gsIFRleHQgfSBmcm9tICcuLi8uLi9pbmsuanMnXG5pbXBvcnQgeyB1c2VLZXliaW5kaW5ncyB9IGZyb20gJy4uLy4uL2tleWJpbmRpbmdzL3VzZUtleWJpbmRpbmcuanMnXG5pbXBvcnQgeyB1c2VTaG9ydGN1dERpc3BsYXkgfSBmcm9tICcuLi8uLi9rZXliaW5kaW5ncy91c2VTaG9ydGN1dERpc3BsYXkuanMnXG5pbXBvcnQgeyBjb3VudCB9IGZyb20gJy4uLy4uL3V0aWxzL2FycmF5LmpzJ1xuaW1wb3J0IHsgQnlsaW5lIH0gZnJvbSAnLi4vZGVzaWduLXN5c3RlbS9CeWxpbmUuanMnXG5pbXBvcnQgeyBEaWFsb2cgfSBmcm9tICcuLi9kZXNpZ24tc3lzdGVtL0RpYWxvZy5qcydcbmltcG9ydCB7IEtleWJvYXJkU2hvcnRjdXRIaW50IH0gZnJvbSAnLi4vZGVzaWduLXN5c3RlbS9LZXlib2FyZFNob3J0Y3V0SGludC5qcydcbmltcG9ydCB7IEFzeW5jQWdlbnREZXRhaWxEaWFsb2cgfSBmcm9tICcuL0FzeW5jQWdlbnREZXRhaWxEaWFsb2cuanMnXG5pbXBvcnQgeyBCYWNrZ3JvdW5kVGFzayBhcyBCYWNrZ3JvdW5kVGFza0NvbXBvbmVudCB9IGZyb20gJy4vQmFja2dyb3VuZFRhc2suanMnXG5pbXBvcnQgeyBEcmVhbURldGFpbERpYWxvZyB9IGZyb20gJy4vRHJlYW1EZXRhaWxEaWFsb2cuanMnXG5pbXBvcnQgeyBJblByb2Nlc3NUZWFtbWF0ZURldGFpbERpYWxvZyB9IGZyb20gJy4vSW5Qcm9jZXNzVGVhbW1hdGVEZXRhaWxEaWFsb2cuanMnXG5pbXBvcnQgeyBSZW1vdGVTZXNzaW9uRGV0YWlsRGlhbG9nIH0gZnJvbSAnLi9SZW1vdGVTZXNzaW9uRGV0YWlsRGlhbG9nLmpzJ1xuaW1wb3J0IHsgU2hlbGxEZXRhaWxEaWFsb2cgfSBmcm9tICcuL1NoZWxsRGV0YWlsRGlhbG9nLmpzJ1xuXG50eXBlIFZpZXdTdGF0ZSA9IHsgbW9kZTogJ2xpc3QnIH0gfCB7IG1vZGU6ICdkZXRhaWwnOyBpdGVtSWQ6IHN0cmluZyB9XG5cbnR5cGUgUHJvcHMgPSB7XG4gIG9uRG9uZTogKFxuICAgIHJlc3VsdD86IHN0cmluZyxcbiAgICBvcHRpb25zPzogeyBkaXNwbGF5PzogQ29tbWFuZFJlc3VsdERpc3BsYXkgfSxcbiAgKSA9PiB2b2lkXG4gIHRvb2xVc2VDb250ZXh0OiBUb29sVXNlQ29udGV4dFxuICBpbml0aWFsRGV0YWlsVGFza0lkPzogc3RyaW5nXG59XG5cbnR5cGUgTGlzdEl0ZW0gPVxuICB8IHtcbiAgICAgIGlkOiBzdHJpbmdcbiAgICAgIHR5cGU6ICdsb2NhbF9iYXNoJ1xuICAgICAgbGFiZWw6IHN0cmluZ1xuICAgICAgc3RhdHVzOiBzdHJpbmdcbiAgICAgIHRhc2s6IERlZXBJbW11dGFibGU8TG9jYWxTaGVsbFRhc2tTdGF0ZT5cbiAgICB9XG4gIHwge1xuICAgICAgaWQ6IHN0cmluZ1xuICAgICAgdHlwZTogJ3JlbW90ZV9hZ2VudCdcbiAgICAgIGxhYmVsOiBzdHJpbmdcbiAgICAgIHN0YXR1czogc3RyaW5nXG4gICAgICB0YXNrOiBEZWVwSW1tdXRhYmxlPFJlbW90ZUFnZW50VGFza1N0YXRlPlxuICAgIH1cbiAgfCB7XG4gICAgICBpZDogc3RyaW5nXG4gICAgICB0eXBlOiAnbG9jYWxfYWdlbnQnXG4gICAgICBsYWJlbDogc3RyaW5nXG4gICAgICBzdGF0dXM6IHN0cmluZ1xuICAgICAgdGFzazogRGVlcEltbXV0YWJsZTxMb2NhbEFnZW50VGFza1N0YXRlPlxuICAgIH1cbiAgfCB7XG4gICAgICBpZDogc3RyaW5nXG4gICAgICB0eXBlOiAnaW5fcHJvY2Vzc190ZWFtbWF0ZSdcbiAgICAgIGxhYmVsOiBzdHJpbmdcbiAgICAgIHN0YXR1czogc3RyaW5nXG4gICAgICB0YXNrOiBEZWVwSW1tdXRhYmxlPEluUHJvY2Vzc1RlYW1tYXRlVGFza1N0YXRlPlxuICAgIH1cbiAgfCB7XG4gICAgICBpZDogc3RyaW5nXG4gICAgICB0eXBlOiAnbG9jYWxfd29ya2Zsb3cnXG4gICAgICBsYWJlbDogc3RyaW5nXG4gICAgICBzdGF0dXM6IHN0cmluZ1xuICAgICAgdGFzazogRGVlcEltbXV0YWJsZTxMb2NhbFdvcmtmbG93VGFza1N0YXRlPlxuICAgIH1cbiAgfCB7XG4gICAgICBpZDogc3RyaW5nXG4gICAgICB0eXBlOiAnbW9uaXRvcl9tY3AnXG4gICAgICBsYWJlbDogc3RyaW5nXG4gICAgICBzdGF0dXM6IHN0cmluZ1xuICAgICAgdGFzazogRGVlcEltbXV0YWJsZTxNb25pdG9yTWNwVGFza1N0YXRlPlxuICAgIH1cbiAgfCB7XG4gICAgICBpZDogc3RyaW5nXG4gICAgICB0eXBlOiAnZHJlYW0nXG4gICAgICBsYWJlbDogc3RyaW5nXG4gICAgICBzdGF0dXM6IHN0cmluZ1xuICAgICAgdGFzazogRGVlcEltbXV0YWJsZTxEcmVhbVRhc2tTdGF0ZT5cbiAgICB9XG4gIHwge1xuICAgICAgaWQ6IHN0cmluZ1xuICAgICAgdHlwZTogJ2xlYWRlcidcbiAgICAgIGxhYmVsOiBzdHJpbmdcbiAgICAgIHN0YXR1czogJ3J1bm5pbmcnXG4gICAgfVxuXG4vLyBXT1JLRkxPV19TQ1JJUFRTIGlzIGFudC1vbmx5IChidWlsZF9mbGFncy55YW1sKS4gU3RhdGljIGltcG9ydHMgd291bGQgbGVha1xuLy8gfjEuM0sgbGluZXMgaW50byBleHRlcm5hbCBidWlsZHMuIEdhdGUgd2l0aCBmZWF0dXJlKCkgKyByZXF1aXJlIHNvIHRoZVxuLy8gYnVuZGxlciBjYW4gZGVhZC1jb2RlLWVsaW1pbmF0ZSB0aGUgYnJhbmNoLlxuLyogZXNsaW50LWRpc2FibGUgQHR5cGVzY3JpcHQtZXNsaW50L25vLXJlcXVpcmUtaW1wb3J0cyAqL1xuY29uc3QgV29ya2Zsb3dEZXRhaWxEaWFsb2cgPSBmZWF0dXJlKCdXT1JLRkxPV19TQ1JJUFRTJylcbiAgPyAoXG4gICAgICByZXF1aXJlKCcuL1dvcmtmbG93RGV0YWlsRGlhbG9nLmpzJykgYXMgdHlwZW9mIGltcG9ydCgnLi9Xb3JrZmxvd0RldGFpbERpYWxvZy5qcycpXG4gICAgKS5Xb3JrZmxvd0RldGFpbERpYWxvZ1xuICA6IG51bGxcbmNvbnN0IHdvcmtmbG93VGFza01vZHVsZSA9IGZlYXR1cmUoJ1dPUktGTE9XX1NDUklQVFMnKVxuICA/IChyZXF1aXJlKCdzcmMvdGFza3MvTG9jYWxXb3JrZmxvd1Rhc2svTG9jYWxXb3JrZmxvd1Rhc2suanMnKSBhcyB0eXBlb2YgaW1wb3J0KCdzcmMvdGFza3MvTG9jYWxXb3JrZmxvd1Rhc2svTG9jYWxXb3JrZmxvd1Rhc2suanMnKSlcbiAgOiBudWxsXG5jb25zdCBraWxsV29ya2Zsb3dUYXNrID0gd29ya2Zsb3dUYXNrTW9kdWxlPy5raWxsV29ya2Zsb3dUYXNrID8/IG51bGxcbmNvbnN0IHNraXBXb3JrZmxvd0FnZW50ID0gd29ya2Zsb3dUYXNrTW9kdWxlPy5za2lwV29ya2Zsb3dBZ2VudCA/PyBudWxsXG5jb25zdCByZXRyeVdvcmtmbG93QWdlbnQgPSB3b3JrZmxvd1Rhc2tNb2R1bGU/LnJldHJ5V29ya2Zsb3dBZ2VudCA/PyBudWxsXG4vLyBSZWxhdGl2ZSBwYXRoLCBub3QgYHNyYy8uLi5gIHBhdGgtbWFwcGluZyDigJQgQnVuJ3MgRENFIGNhbiBzdGF0aWNhbGx5XG4vLyByZXNvbHZlICsgZWxpbWluYXRlIGAuL2AgcmVxdWlyZXMsIGJ1dCBwYXRoLW1hcHBlZCBzdHJpbmdzIHN0YXkgb3BhcXVlXG4vLyBhbmQgc3Vydml2ZSBhcyBkZWFkIGxpdGVyYWxzIGluIHRoZSBidW5kbGUuIE1hdGNoZXMgdGFza3MudHMgcGF0dGVybi5cbmNvbnN0IG1vbml0b3JNY3BNb2R1bGUgPSBmZWF0dXJlKCdNT05JVE9SX1RPT0wnKVxuICA/IChyZXF1aXJlKCcuLi8uLi90YXNrcy9Nb25pdG9yTWNwVGFzay9Nb25pdG9yTWNwVGFzay5qcycpIGFzIHR5cGVvZiBpbXBvcnQoJy4uLy4uL3Rhc2tzL01vbml0b3JNY3BUYXNrL01vbml0b3JNY3BUYXNrLmpzJykpXG4gIDogbnVsbFxuY29uc3Qga2lsbE1vbml0b3JNY3AgPSBtb25pdG9yTWNwTW9kdWxlPy5raWxsTW9uaXRvck1jcCA/PyBudWxsXG5jb25zdCBNb25pdG9yTWNwRGV0YWlsRGlhbG9nID0gZmVhdHVyZSgnTU9OSVRPUl9UT09MJylcbiAgPyAoXG4gICAgICByZXF1aXJlKCcuL01vbml0b3JNY3BEZXRhaWxEaWFsb2cuanMnKSBhcyB0eXBlb2YgaW1wb3J0KCcuL01vbml0b3JNY3BEZXRhaWxEaWFsb2cuanMnKVxuICAgICkuTW9uaXRvck1jcERldGFpbERpYWxvZ1xuICA6IG51bGxcbi8qIGVzbGludC1lbmFibGUgQHR5cGVzY3JpcHQtZXNsaW50L25vLXJlcXVpcmUtaW1wb3J0cyAqL1xuXG4vLyBIZWxwZXIgdG8gZ2V0IGZpbHRlcmVkIGJhY2tncm91bmQgdGFza3MgKGV4Y2x1ZGVzIGZvcmVncm91bmRlZCBsb2NhbF9hZ2VudClcbmZ1bmN0aW9uIGdldFNlbGVjdGFibGVCYWNrZ3JvdW5kVGFza3MoXG4gIHRhc2tzOiBSZWNvcmQ8c3RyaW5nLCBUYXNrU3RhdGU+IHwgdW5kZWZpbmVkLFxuICBmb3JlZ3JvdW5kZWRUYXNrSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCxcbik6IFRhc2tTdGF0ZVtdIHtcbiAgY29uc3QgYmFja2dyb3VuZFRhc2tzID0gT2JqZWN0LnZhbHVlcyh0YXNrcyA/PyB7fSkuZmlsdGVyKGlzQmFja2dyb3VuZFRhc2spXG4gIHJldHVybiBiYWNrZ3JvdW5kVGFza3MuZmlsdGVyKFxuICAgIHRhc2sgPT4gISh0YXNrLnR5cGUgPT09ICdsb2NhbF9hZ2VudCcgJiYgdGFzay5pZCA9PT0gZm9yZWdyb3VuZGVkVGFza0lkKSxcbiAgKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gQmFja2dyb3VuZFRhc2tzRGlhbG9nKHtcbiAgb25Eb25lLFxuICB0b29sVXNlQ29udGV4dCxcbiAgaW5pdGlhbERldGFpbFRhc2tJZCxcbn06IFByb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgY29uc3QgdGFza3MgPSB1c2VBcHBTdGF0ZShzID0+IHMudGFza3MpXG4gIGNvbnN0IGZvcmVncm91bmRlZFRhc2tJZCA9IHVzZUFwcFN0YXRlKHMgPT4gcy5mb3JlZ3JvdW5kZWRUYXNrSWQpXG4gIGNvbnN0IHNob3dTcGlubmVyVHJlZSA9IHVzZUFwcFN0YXRlKHMgPT4gcy5leHBhbmRlZFZpZXcpID09PSAndGVhbW1hdGVzJ1xuICBjb25zdCBzZXRBcHBTdGF0ZSA9IHVzZVNldEFwcFN0YXRlKClcbiAgY29uc3Qga2lsbEFnZW50c1Nob3J0Y3V0ID0gdXNlU2hvcnRjdXREaXNwbGF5KFxuICAgICdjaGF0OmtpbGxBZ2VudHMnLFxuICAgICdDaGF0JyxcbiAgICAnY3RybCt4IGN0cmwraycsXG4gIClcbiAgY29uc3QgdHlwZWRUYXNrcyA9IHRhc2tzIGFzIFJlY29yZDxzdHJpbmcsIFRhc2tTdGF0ZT4gfCB1bmRlZmluZWRcblxuICAvLyBUcmFjayBpZiB3ZSBza2lwcGVkIGxpc3QgdmlldyBvbiBtb3VudCAoZm9yIGJhY2sgYnV0dG9uIGJlaGF2aW9yKVxuICBjb25zdCBza2lwcGVkTGlzdE9uTW91bnQgPSB1c2VSZWYoZmFsc2UpXG5cbiAgLy8gQ29tcHV0ZSBpbml0aWFsIHZpZXcgc3RhdGUgLSBza2lwIGxpc3QgaWYgY2FsbGVyIHByb3ZpZGVkIGEgc3BlY2lmaWMgdGFzayxcbiAgLy8gb3IgaWYgdGhlcmUncyBleGFjdGx5IG9uZSB0YXNrXG4gIGNvbnN0IFt2aWV3U3RhdGUsIHNldFZpZXdTdGF0ZV0gPSB1c2VTdGF0ZTxWaWV3U3RhdGU+KCgpID0+IHtcbiAgICBpZiAoaW5pdGlhbERldGFpbFRhc2tJZCkge1xuICAgICAgc2tpcHBlZExpc3RPbk1vdW50LmN1cnJlbnQgPSB0cnVlXG4gICAgICByZXR1cm4geyBtb2RlOiAnZGV0YWlsJywgaXRlbUlkOiBpbml0aWFsRGV0YWlsVGFza0lkIH1cbiAgICB9XG4gICAgY29uc3QgYWxsSXRlbXMgPSBnZXRTZWxlY3RhYmxlQmFja2dyb3VuZFRhc2tzKFxuICAgICAgdHlwZWRUYXNrcyxcbiAgICAgIGZvcmVncm91bmRlZFRhc2tJZCxcbiAgICApXG4gICAgaWYgKGFsbEl0ZW1zLmxlbmd0aCA9PT0gMSkge1xuICAgICAgc2tpcHBlZExpc3RPbk1vdW50LmN1cnJlbnQgPSB0cnVlXG4gICAgICByZXR1cm4geyBtb2RlOiAnZGV0YWlsJywgaXRlbUlkOiBhbGxJdGVtc1swXSEuaWQgfVxuICAgIH1cbiAgICByZXR1cm4geyBtb2RlOiAnbGlzdCcgfVxuICB9KVxuICBjb25zdCBbc2VsZWN0ZWRJbmRleCwgc2V0U2VsZWN0ZWRJbmRleF0gPSB1c2VTdGF0ZTxudW1iZXI+KDApXG5cbiAgLy8gUmVnaXN0ZXIgYXMgbW9kYWwgb3ZlcmxheSBzbyBwYXJlbnQgQ2hhdCBrZXliaW5kaW5ncyAodXAvZG93biBmb3IgaGlzdG9yeSlcbiAgLy8gYXJlIGRlYWN0aXZhdGVkIHdoaWxlIHRoaXMgZGlhbG9nIGlzIG9wZW5cbiAgdXNlUmVnaXN0ZXJPdmVybGF5KCdiYWNrZ3JvdW5kLXRhc2tzLWRpYWxvZycpXG5cbiAgLy8gTWVtb2l6ZSB0aGUgc29ydGVkIGFuZCBjYXRlZ29yaXplZCBpdGVtcyB0b2dldGhlciB0byBlbnN1cmUgc3RhYmxlIHJlZmVyZW5jZXNcbiAgY29uc3Qge1xuICAgIGJhc2hUYXNrcyxcbiAgICByZW1vdGVTZXNzaW9ucyxcbiAgICBhZ2VudFRhc2tzLFxuICAgIHRlYW1tYXRlVGFza3MsXG4gICAgd29ya2Zsb3dUYXNrcyxcbiAgICBtY3BNb25pdG9ycyxcbiAgICBkcmVhbVRhc2tzLFxuICAgIGFsbFNlbGVjdGFibGVJdGVtcyxcbiAgfSA9IHVzZU1lbW8oKCkgPT4ge1xuICAgIC8vIEZpbHRlciB0byBvbmx5IHNob3cgcnVubmluZy9wZW5kaW5nIGJhY2tncm91bmQgdGFza3MsIG1hdGNoaW5nIHRoZSBzdGF0dXMgYmFyIGNvdW50XG4gICAgY29uc3QgYmFja2dyb3VuZFRhc2tzID0gT2JqZWN0LnZhbHVlcyh0eXBlZFRhc2tzID8/IHt9KS5maWx0ZXIoXG4gICAgICBpc0JhY2tncm91bmRUYXNrLFxuICAgIClcbiAgICBjb25zdCBhbGxJdGVtcyA9IGJhY2tncm91bmRUYXNrcy5tYXAodG9MaXN0SXRlbSlcbiAgICBjb25zdCBzb3J0ZWQgPSBhbGxJdGVtcy5zb3J0KChhLCBiKSA9PiB7XG4gICAgICBjb25zdCBhU3RhdHVzID0gYS5zdGF0dXNcbiAgICAgIGNvbnN0IGJTdGF0dXMgPSBiLnN0YXR1c1xuICAgICAgaWYgKGFTdGF0dXMgPT09ICdydW5uaW5nJyAmJiBiU3RhdHVzICE9PSAncnVubmluZycpIHJldHVybiAtMVxuICAgICAgaWYgKGFTdGF0dXMgIT09ICdydW5uaW5nJyAmJiBiU3RhdHVzID09PSAncnVubmluZycpIHJldHVybiAxXG4gICAgICBjb25zdCBhVGltZSA9ICd0YXNrJyBpbiBhID8gYS50YXNrLnN0YXJ0VGltZSA6IDBcbiAgICAgIGNvbnN0IGJUaW1lID0gJ3Rhc2snIGluIGIgPyBiLnRhc2suc3RhcnRUaW1lIDogMFxuICAgICAgcmV0dXJuIGJUaW1lIC0gYVRpbWVcbiAgICB9KVxuICAgIGNvbnN0IGJhc2ggPSBzb3J0ZWQuZmlsdGVyKGl0ZW0gPT4gaXRlbS50eXBlID09PSAnbG9jYWxfYmFzaCcpXG4gICAgY29uc3QgcmVtb3RlID0gc29ydGVkLmZpbHRlcihpdGVtID0+IGl0ZW0udHlwZSA9PT0gJ3JlbW90ZV9hZ2VudCcpXG4gICAgLy8gRXhjbHVkZSBmb3JlZ3JvdW5kZWQgdGFzayAtIGl0J3MgYmVpbmcgdmlld2VkIGluIHRoZSBtYWluIFVJLCBub3QgYSBiYWNrZ3JvdW5kIHRhc2tcbiAgICBjb25zdCBhZ2VudCA9IHNvcnRlZC5maWx0ZXIoXG4gICAgICBpdGVtID0+IGl0ZW0udHlwZSA9PT0gJ2xvY2FsX2FnZW50JyAmJiBpdGVtLmlkICE9PSBmb3JlZ3JvdW5kZWRUYXNrSWQsXG4gICAgKVxuICAgIGNvbnN0IHdvcmtmbG93cyA9IHNvcnRlZC5maWx0ZXIoaXRlbSA9PiBpdGVtLnR5cGUgPT09ICdsb2NhbF93b3JrZmxvdycpXG4gICAgY29uc3QgbW9uaXRvck1jcCA9IHNvcnRlZC5maWx0ZXIoaXRlbSA9PiBpdGVtLnR5cGUgPT09ICdtb25pdG9yX21jcCcpXG4gICAgY29uc3QgZHJlYW1UYXNrcyA9IHNvcnRlZC5maWx0ZXIoaXRlbSA9PiBpdGVtLnR5cGUgPT09ICdkcmVhbScpXG4gICAgLy8gSW4gc3Bpbm5lci10cmVlIG1vZGUsIGV4Y2x1ZGUgdGVhbW1hdGVzIGZyb20gdGhlIGRpYWxvZyAodGhleSBhcHBlYXIgaW4gdGhlIHRyZWUpXG4gICAgY29uc3QgdGVhbW1hdGVzID0gc2hvd1NwaW5uZXJUcmVlXG4gICAgICA/IFtdXG4gICAgICA6IHNvcnRlZC5maWx0ZXIoaXRlbSA9PiBpdGVtLnR5cGUgPT09ICdpbl9wcm9jZXNzX3RlYW1tYXRlJylcbiAgICAvLyBBZGQgbGVhZGVyIGVudHJ5IHdoZW4gdGhlcmUgYXJlIHRlYW1tYXRlcywgc28gdXNlcnMgY2FuIGZvcmVncm91bmQgYmFjayB0byBsZWFkZXJcbiAgICBjb25zdCBsZWFkZXJJdGVtOiBMaXN0SXRlbVtdID1cbiAgICAgIHRlYW1tYXRlcy5sZW5ndGggPiAwXG4gICAgICAgID8gW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpZDogJ19fbGVhZGVyX18nLFxuICAgICAgICAgICAgICB0eXBlOiAnbGVhZGVyJyxcbiAgICAgICAgICAgICAgbGFiZWw6IGBAJHtURUFNX0xFQURfTkFNRX1gLFxuICAgICAgICAgICAgICBzdGF0dXM6ICdydW5uaW5nJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXVxuICAgICAgICA6IFtdXG4gICAgcmV0dXJuIHtcbiAgICAgIGJhc2hUYXNrczogYmFzaCxcbiAgICAgIHJlbW90ZVNlc3Npb25zOiByZW1vdGUsXG4gICAgICBhZ2VudFRhc2tzOiBhZ2VudCxcbiAgICAgIHdvcmtmbG93VGFza3M6IHdvcmtmbG93cyxcbiAgICAgIG1jcE1vbml0b3JzOiBtb25pdG9yTWNwLFxuICAgICAgZHJlYW1UYXNrcyxcbiAgICAgIHRlYW1tYXRlVGFza3M6IFsuLi5sZWFkZXJJdGVtLCAuLi50ZWFtbWF0ZXNdLFxuICAgICAgLy8gT3JkZXIgTVVTVCBtYXRjaCBKU1ggcmVuZGVyIG9yZGVyICh0ZWFtbWF0ZXMgXFx1MjE5MiBiYXNoIFxcdTIxOTIgbW9uaXRvck1jcCBcXHUyMTkyXG4gICAgICAvLyByZW1vdGUgXFx1MjE5MiBhZ2VudCBcXHUyMTkyIHdvcmtmbG93cyBcXHUyMTkyIGRyZWFtKSBzbyBcXHUyMTkzL1xcdTIxOTEgbmF2aWdhdGlvbiBtb3ZlcyB0aGUgY3Vyc29yXG4gICAgICAvLyB2aXN1YWxseSBkb3dud2FyZC5cbiAgICAgIGFsbFNlbGVjdGFibGVJdGVtczogW1xuICAgICAgICAuLi5sZWFkZXJJdGVtLFxuICAgICAgICAuLi50ZWFtbWF0ZXMsXG4gICAgICAgIC4uLmJhc2gsXG4gICAgICAgIC4uLm1vbml0b3JNY3AsXG4gICAgICAgIC4uLnJlbW90ZSxcbiAgICAgICAgLi4uYWdlbnQsXG4gICAgICAgIC4uLndvcmtmbG93cyxcbiAgICAgICAgLi4uZHJlYW1UYXNrcyxcbiAgICAgIF0sXG4gICAgfVxuICB9LCBbdHlwZWRUYXNrcywgZm9yZWdyb3VuZGVkVGFza0lkLCBzaG93U3Bpbm5lclRyZWVdKVxuXG4gIGNvbnN0IGN1cnJlbnRTZWxlY3Rpb24gPSBhbGxTZWxlY3RhYmxlSXRlbXNbc2VsZWN0ZWRJbmRleF0gPz8gbnVsbFxuXG4gIC8vIFVzZSBjb25maWd1cmFibGUga2V5YmluZGluZ3MgZm9yIHN0YW5kYXJkIG5hdmlnYXRpb24gYW5kIGNvbmZpcm0vY2FuY2VsLlxuICAvLyBjb25maXJtOm5vIGlzIGhhbmRsZWQgYnkgRGlhbG9nJ3Mgb25DYW5jZWwgcHJvcC5cbiAgdXNlS2V5YmluZGluZ3MoXG4gICAge1xuICAgICAgJ2NvbmZpcm06cHJldmlvdXMnOiAoKSA9PiBzZXRTZWxlY3RlZEluZGV4KHByZXYgPT4gTWF0aC5tYXgoMCwgcHJldiAtIDEpKSxcbiAgICAgICdjb25maXJtOm5leHQnOiAoKSA9PlxuICAgICAgICBzZXRTZWxlY3RlZEluZGV4KHByZXYgPT5cbiAgICAgICAgICBNYXRoLm1pbihhbGxTZWxlY3RhYmxlSXRlbXMubGVuZ3RoIC0gMSwgcHJldiArIDEpLFxuICAgICAgICApLFxuICAgICAgJ2NvbmZpcm06eWVzJzogKCkgPT4ge1xuICAgICAgICBjb25zdCBjdXJyZW50ID0gYWxsU2VsZWN0YWJsZUl0ZW1zW3NlbGVjdGVkSW5kZXhdXG4gICAgICAgIGlmIChjdXJyZW50KSB7XG4gICAgICAgICAgaWYgKGN1cnJlbnQudHlwZSA9PT0gJ2xlYWRlcicpIHtcbiAgICAgICAgICAgIGV4aXRUZWFtbWF0ZVZpZXcoc2V0QXBwU3RhdGUpXG4gICAgICAgICAgICBvbkRvbmUoJ1ZpZXdpbmcgbGVhZGVyJywgeyBkaXNwbGF5OiAnc3lzdGVtJyB9KVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzZXRWaWV3U3RhdGUoeyBtb2RlOiAnZGV0YWlsJywgaXRlbUlkOiBjdXJyZW50LmlkIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9LFxuICAgIH0sXG4gICAgeyBjb250ZXh0OiAnQ29uZmlybWF0aW9uJywgaXNBY3RpdmU6IHZpZXdTdGF0ZS5tb2RlID09PSAnbGlzdCcgfSxcbiAgKVxuXG4gIC8vIENvbXBvbmVudC1zcGVjaWZpYyBzaG9ydGN1dHMgKHg9c3RvcCwgZj1mb3JlZ3JvdW5kLCByaWdodD16b29tKSBzaG93biBpbiBVSS5cbiAgLy8gVGhlc2UgYXJlIHRhc2stdHlwZSBhbmQgc3RhdHVzIGRlcGVuZGVudCwgbm90IHN0YW5kYXJkIGRpYWxvZyBrZXliaW5kaW5ncy5cbiAgY29uc3QgaGFuZGxlS2V5RG93biA9IChlOiBLZXlib2FyZEV2ZW50KSA9PiB7XG4gICAgLy8gT25seSBoYW5kbGUgaW5wdXQgd2hlbiBpbiBsaXN0IG1vZGVcbiAgICBpZiAodmlld1N0YXRlLm1vZGUgIT09ICdsaXN0JykgcmV0dXJuXG5cbiAgICBpZiAoZS5rZXkgPT09ICdsZWZ0Jykge1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpXG4gICAgICBvbkRvbmUoJ0JhY2tncm91bmQgdGFza3MgZGlhbG9nIGRpc21pc3NlZCcsIHsgZGlzcGxheTogJ3N5c3RlbScgfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIC8vIENvbXB1dGUgY3VycmVudCBzZWxlY3Rpb24gYXQgdGhlIHRpbWUgb2YgdGhlIGtleSBwcmVzc1xuICAgIGNvbnN0IGN1cnJlbnRTZWxlY3Rpb24gPSBhbGxTZWxlY3RhYmxlSXRlbXNbc2VsZWN0ZWRJbmRleF1cbiAgICBpZiAoIWN1cnJlbnRTZWxlY3Rpb24pIHJldHVybiAvLyBldmVyeXRoaW5nIGJlbG93IHJlcXVpcmVzIGEgc2VsZWN0aW9uXG5cbiAgICBpZiAoZS5rZXkgPT09ICd4Jykge1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpXG4gICAgICBpZiAoXG4gICAgICAgIGN1cnJlbnRTZWxlY3Rpb24udHlwZSA9PT0gJ2xvY2FsX2Jhc2gnICYmXG4gICAgICAgIGN1cnJlbnRTZWxlY3Rpb24uc3RhdHVzID09PSAncnVubmluZydcbiAgICAgICkge1xuICAgICAgICB2b2lkIGtpbGxTaGVsbFRhc2soY3VycmVudFNlbGVjdGlvbi5pZClcbiAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgIGN1cnJlbnRTZWxlY3Rpb24udHlwZSA9PT0gJ2xvY2FsX2FnZW50JyAmJlxuICAgICAgICBjdXJyZW50U2VsZWN0aW9uLnN0YXR1cyA9PT0gJ3J1bm5pbmcnXG4gICAgICApIHtcbiAgICAgICAgdm9pZCBraWxsQWdlbnRUYXNrKGN1cnJlbnRTZWxlY3Rpb24uaWQpXG4gICAgICB9IGVsc2UgaWYgKFxuICAgICAgICBjdXJyZW50U2VsZWN0aW9uLnR5cGUgPT09ICdpbl9wcm9jZXNzX3RlYW1tYXRlJyAmJlxuICAgICAgICBjdXJyZW50U2VsZWN0aW9uLnN0YXR1cyA9PT0gJ3J1bm5pbmcnXG4gICAgICApIHtcbiAgICAgICAgdm9pZCBraWxsVGVhbW1hdGVUYXNrKGN1cnJlbnRTZWxlY3Rpb24uaWQpXG4gICAgICB9IGVsc2UgaWYgKFxuICAgICAgICBjdXJyZW50U2VsZWN0aW9uLnR5cGUgPT09ICdsb2NhbF93b3JrZmxvdycgJiZcbiAgICAgICAgY3VycmVudFNlbGVjdGlvbi5zdGF0dXMgPT09ICdydW5uaW5nJyAmJlxuICAgICAgICBraWxsV29ya2Zsb3dUYXNrXG4gICAgICApIHtcbiAgICAgICAga2lsbFdvcmtmbG93VGFzayhjdXJyZW50U2VsZWN0aW9uLmlkLCBzZXRBcHBTdGF0ZSlcbiAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgIGN1cnJlbnRTZWxlY3Rpb24udHlwZSA9PT0gJ21vbml0b3JfbWNwJyAmJlxuICAgICAgICBjdXJyZW50U2VsZWN0aW9uLnN0YXR1cyA9PT0gJ3J1bm5pbmcnICYmXG4gICAgICAgIGtpbGxNb25pdG9yTWNwXG4gICAgICApIHtcbiAgICAgICAga2lsbE1vbml0b3JNY3AoY3VycmVudFNlbGVjdGlvbi5pZCwgc2V0QXBwU3RhdGUpXG4gICAgICB9IGVsc2UgaWYgKFxuICAgICAgICBjdXJyZW50U2VsZWN0aW9uLnR5cGUgPT09ICdkcmVhbScgJiZcbiAgICAgICAgY3VycmVudFNlbGVjdGlvbi5zdGF0dXMgPT09ICdydW5uaW5nJ1xuICAgICAgKSB7XG4gICAgICAgIHZvaWQga2lsbERyZWFtVGFzayhjdXJyZW50U2VsZWN0aW9uLmlkKVxuICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgY3VycmVudFNlbGVjdGlvbi50eXBlID09PSAncmVtb3RlX2FnZW50JyAmJlxuICAgICAgICBjdXJyZW50U2VsZWN0aW9uLnN0YXR1cyA9PT0gJ3J1bm5pbmcnXG4gICAgICApIHtcbiAgICAgICAgaWYgKGN1cnJlbnRTZWxlY3Rpb24udGFzay5pc1VsdHJhcGxhbikge1xuICAgICAgICAgIHZvaWQgc3RvcFVsdHJhcGxhbihcbiAgICAgICAgICAgIGN1cnJlbnRTZWxlY3Rpb24uaWQsXG4gICAgICAgICAgICBjdXJyZW50U2VsZWN0aW9uLnRhc2suc2Vzc2lvbklkLFxuICAgICAgICAgICAgc2V0QXBwU3RhdGUsXG4gICAgICAgICAgKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZvaWQga2lsbFJlbW90ZUFnZW50VGFzayhjdXJyZW50U2VsZWN0aW9uLmlkKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGUua2V5ID09PSAnZicpIHtcbiAgICAgIGlmIChcbiAgICAgICAgY3VycmVudFNlbGVjdGlvbi50eXBlID09PSAnaW5fcHJvY2Vzc190ZWFtbWF0ZScgJiZcbiAgICAgICAgY3VycmVudFNlbGVjdGlvbi5zdGF0dXMgPT09ICdydW5uaW5nJ1xuICAgICAgKSB7XG4gICAgICAgIGUucHJldmVudERlZmF1bHQoKVxuICAgICAgICBlbnRlclRlYW1tYXRlVmlldyhjdXJyZW50U2VsZWN0aW9uLmlkLCBzZXRBcHBTdGF0ZSlcbiAgICAgICAgb25Eb25lKCdWaWV3aW5nIHRlYW1tYXRlJywgeyBkaXNwbGF5OiAnc3lzdGVtJyB9KVxuICAgICAgfSBlbHNlIGlmIChjdXJyZW50U2VsZWN0aW9uLnR5cGUgPT09ICdsZWFkZXInKSB7XG4gICAgICAgIGUucHJldmVudERlZmF1bHQoKVxuICAgICAgICBleGl0VGVhbW1hdGVWaWV3KHNldEFwcFN0YXRlKVxuICAgICAgICBvbkRvbmUoJ1ZpZXdpbmcgbGVhZGVyJywgeyBkaXNwbGF5OiAnc3lzdGVtJyB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGZ1bmN0aW9uIGtpbGxTaGVsbFRhc2sodGFza0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBMb2NhbFNoZWxsVGFzay5raWxsKHRhc2tJZCwgc2V0QXBwU3RhdGUpXG4gIH1cblxuICBhc3luYyBmdW5jdGlvbiBraWxsQWdlbnRUYXNrKHRhc2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgTG9jYWxBZ2VudFRhc2sua2lsbCh0YXNrSWQsIHNldEFwcFN0YXRlKVxuICB9XG5cbiAgYXN5bmMgZnVuY3Rpb24ga2lsbFRlYW1tYXRlVGFzayh0YXNrSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IEluUHJvY2Vzc1RlYW1tYXRlVGFzay5raWxsKHRhc2tJZCwgc2V0QXBwU3RhdGUpXG4gIH1cblxuICBhc3luYyBmdW5jdGlvbiBraWxsRHJlYW1UYXNrKHRhc2tJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgRHJlYW1UYXNrLmtpbGwodGFza0lkLCBzZXRBcHBTdGF0ZSlcbiAgfVxuXG4gIGFzeW5jIGZ1bmN0aW9uIGtpbGxSZW1vdGVBZ2VudFRhc2sodGFza0lkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBSZW1vdGVBZ2VudFRhc2sua2lsbCh0YXNrSWQsIHNldEFwcFN0YXRlKVxuICB9XG5cbiAgLy8gV3JhcCBvbkRvbmUgaW4gdXNlRWZmZWN0RXZlbnQgdG8gZ2V0IGEgc3RhYmxlIHJlZmVyZW5jZSB0aGF0IGFsd2F5cyBjYWxsc1xuICAvLyB0aGUgY3VycmVudCBvbkRvbmUgY2FsbGJhY2sgd2l0aG91dCBjYXVzaW5nIHRoZSBlZmZlY3QgdG8gcmUtZmlyZS5cbiAgY29uc3Qgb25Eb25lRXZlbnQgPSB1c2VFZmZlY3RFdmVudChvbkRvbmUpXG5cbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBpZiAodmlld1N0YXRlLm1vZGUgIT09ICdsaXN0Jykge1xuICAgICAgY29uc3QgdGFzayA9ICh0eXBlZFRhc2tzID8/IHt9KVt2aWV3U3RhdGUuaXRlbUlkXVxuICAgICAgLy8gV29ya2Zsb3cgdGFza3MgZ2V0IGEgZ3JhY2U6IHRoZWlyIGRldGFpbCB2aWV3IHN0YXlzIG9wZW4gdGhyb3VnaFxuICAgICAgLy8gY29tcGxldGlvbiBzbyB0aGUgdXNlciBzZWVzIHRoZSBmaW5hbCBzdGF0ZSBiZWZvcmUgZXZpY3Rpb24uXG4gICAgICBpZiAoXG4gICAgICAgICF0YXNrIHx8XG4gICAgICAgICh0YXNrLnR5cGUgIT09ICdsb2NhbF93b3JrZmxvdycgJiYgIWlzQmFja2dyb3VuZFRhc2sodGFzaykpXG4gICAgICApIHtcbiAgICAgICAgLy8gVGFzayB3YXMgcmVtb3ZlZCBvciBpcyBubyBsb25nZXIgYSBiYWNrZ3JvdW5kIHRhc2sgKGUuZy4ga2lsbGVkKS5cbiAgICAgICAgLy8gSWYgd2Ugc2tpcHBlZCB0aGUgbGlzdCBvbiBtb3VudCwgY2xvc2UgdGhlIGRpYWxvZyBlbnRpcmVseS5cbiAgICAgICAgaWYgKHNraXBwZWRMaXN0T25Nb3VudC5jdXJyZW50KSB7XG4gICAgICAgICAgb25Eb25lRXZlbnQoJ0JhY2tncm91bmQgdGFza3MgZGlhbG9nIGRpc21pc3NlZCcsIHtcbiAgICAgICAgICAgIGRpc3BsYXk6ICdzeXN0ZW0nLFxuICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc2V0Vmlld1N0YXRlKHsgbW9kZTogJ2xpc3QnIH0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB0b3RhbEl0ZW1zID0gYWxsU2VsZWN0YWJsZUl0ZW1zLmxlbmd0aFxuICAgIGlmIChzZWxlY3RlZEluZGV4ID49IHRvdGFsSXRlbXMgJiYgdG90YWxJdGVtcyA+IDApIHtcbiAgICAgIHNldFNlbGVjdGVkSW5kZXgodG90YWxJdGVtcyAtIDEpXG4gICAgfVxuICB9LCBbdmlld1N0YXRlLCB0eXBlZFRhc2tzLCBzZWxlY3RlZEluZGV4LCBhbGxTZWxlY3RhYmxlSXRlbXMsIG9uRG9uZUV2ZW50XSlcblxuICAvLyBIZWxwZXIgdG8gZ28gYmFjayB0byBsaXN0IHZpZXcgKG9yIGNsb3NlIGRpYWxvZyBpZiB3ZSBza2lwcGVkIGxpc3Qgb25cbiAgLy8gbW91bnQgQU5EIHRoZXJlJ3Mgc3RpbGwgb25seSDiiaQxIGl0ZW0pLiBDaGVja2luZyBjdXJyZW50IGNvdW50IHByZXZlbnRzXG4gIC8vIHRoZSBzdGFsZS1zdGF0ZSB0cmFwOiBpZiB5b3Ugb3BlbmVkIHdpdGggMSB0YXNrIChhdXRvLXNraXBwZWQgdG8gZGV0YWlsKSxcbiAgLy8gdGhlbiBhIHNlY29uZCB0YXNrIHN0YXJ0ZWQsICdiYWNrJyBzaG91bGQgc2hvdyB0aGUgbGlzdCDigJQgbm90IGNsb3NlLlxuICBjb25zdCBnb0JhY2tUb0xpc3QgPSAoKSA9PiB7XG4gICAgaWYgKHNraXBwZWRMaXN0T25Nb3VudC5jdXJyZW50ICYmIGFsbFNlbGVjdGFibGVJdGVtcy5sZW5ndGggPD0gMSkge1xuICAgICAgb25Eb25lKCdCYWNrZ3JvdW5kIHRhc2tzIGRpYWxvZyBkaXNtaXNzZWQnLCB7IGRpc3BsYXk6ICdzeXN0ZW0nIH0pXG4gICAgfSBlbHNlIHtcbiAgICAgIHNraXBwZWRMaXN0T25Nb3VudC5jdXJyZW50ID0gZmFsc2VcbiAgICAgIHNldFZpZXdTdGF0ZSh7IG1vZGU6ICdsaXN0JyB9KVxuICAgIH1cbiAgfVxuXG4gIC8vIElmIGFuIGl0ZW0gaXMgc2VsZWN0ZWQsIHNob3cgdGhlIGFwcHJvcHJpYXRlIHZpZXdcbiAgaWYgKHZpZXdTdGF0ZS5tb2RlICE9PSAnbGlzdCcgJiYgdHlwZWRUYXNrcykge1xuICAgIGNvbnN0IHRhc2sgPSB0eXBlZFRhc2tzW3ZpZXdTdGF0ZS5pdGVtSWRdXG4gICAgaWYgKCF0YXNrKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIC8vIERldGFpbCBtb2RlIC0gc2hvdyBhcHByb3ByaWF0ZSBkZXRhaWwgZGlhbG9nXG4gICAgc3dpdGNoICh0YXNrLnR5cGUpIHtcbiAgICAgIGNhc2UgJ2xvY2FsX2Jhc2gnOlxuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgIDxTaGVsbERldGFpbERpYWxvZ1xuICAgICAgICAgICAgc2hlbGw9e3Rhc2t9XG4gICAgICAgICAgICBvbkRvbmU9e29uRG9uZX1cbiAgICAgICAgICAgIG9uS2lsbFNoZWxsPXsoKSA9PiB2b2lkIGtpbGxTaGVsbFRhc2sodGFzay5pZCl9XG4gICAgICAgICAgICBvbkJhY2s9e2dvQmFja1RvTGlzdH1cbiAgICAgICAgICAgIGtleT17YHNoZWxsLSR7dGFzay5pZH1gfVxuICAgICAgICAgIC8+XG4gICAgICAgIClcbiAgICAgIGNhc2UgJ2xvY2FsX2FnZW50JzpcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICA8QXN5bmNBZ2VudERldGFpbERpYWxvZ1xuICAgICAgICAgICAgYWdlbnQ9e3Rhc2t9XG4gICAgICAgICAgICBvbkRvbmU9e29uRG9uZX1cbiAgICAgICAgICAgIG9uS2lsbEFnZW50PXsoKSA9PiB2b2lkIGtpbGxBZ2VudFRhc2sodGFzay5pZCl9XG4gICAgICAgICAgICBvbkJhY2s9e2dvQmFja1RvTGlzdH1cbiAgICAgICAgICAgIGtleT17YGFnZW50LSR7dGFzay5pZH1gfVxuICAgICAgICAgIC8+XG4gICAgICAgIClcbiAgICAgIGNhc2UgJ3JlbW90ZV9hZ2VudCc6XG4gICAgICAgIHJldHVybiBSZWFjdC5jcmVhdGVFbGVtZW50KFJlbW90ZVNlc3Npb25EZXRhaWxEaWFsb2csIHtcbiAgICAgICAgICBrZXk6IGBzZXNzaW9uLSR7dGFzay5pZH1gLFxuICAgICAgICAgIHNlc3Npb246IHRhc2ssXG4gICAgICAgICAgb25Eb25lLFxuICAgICAgICAgIHRvb2xVc2VDb250ZXh0LFxuICAgICAgICAgIG9uQmFjazogZ29CYWNrVG9MaXN0LFxuICAgICAgICAgIG9uS2lsbDpcbiAgICAgICAgICAgIHRhc2suc3RhdHVzICE9PSAncnVubmluZydcbiAgICAgICAgICAgICAgPyB1bmRlZmluZWRcbiAgICAgICAgICAgICAgOiB0YXNrLmlzVWx0cmFwbGFuXG4gICAgICAgICAgICAgICAgPyAoKSA9PiB2b2lkIHN0b3BVbHRyYXBsYW4odGFzay5pZCwgdGFzay5zZXNzaW9uSWQsIHNldEFwcFN0YXRlKVxuICAgICAgICAgICAgICAgIDogKCkgPT4gdm9pZCBraWxsUmVtb3RlQWdlbnRUYXNrKHRhc2suaWQpLFxuICAgICAgICB9KVxuICAgICAgY2FzZSAnaW5fcHJvY2Vzc190ZWFtbWF0ZSc6XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgPEluUHJvY2Vzc1RlYW1tYXRlRGV0YWlsRGlhbG9nXG4gICAgICAgICAgICB0ZWFtbWF0ZT17dGFza31cbiAgICAgICAgICAgIG9uRG9uZT17b25Eb25lfVxuICAgICAgICAgICAgb25LaWxsPXtcbiAgICAgICAgICAgICAgdGFzay5zdGF0dXMgPT09ICdydW5uaW5nJ1xuICAgICAgICAgICAgICAgID8gKCkgPT4gdm9pZCBraWxsVGVhbW1hdGVUYXNrKHRhc2suaWQpXG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG9uQmFjaz17Z29CYWNrVG9MaXN0fVxuICAgICAgICAgICAgb25Gb3JlZ3JvdW5kPXtcbiAgICAgICAgICAgICAgdGFzay5zdGF0dXMgPT09ICdydW5uaW5nJ1xuICAgICAgICAgICAgICAgID8gKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBlbnRlclRlYW1tYXRlVmlldyh0YXNrLmlkLCBzZXRBcHBTdGF0ZSlcbiAgICAgICAgICAgICAgICAgICAgb25Eb25lKCdWaWV3aW5nIHRlYW1tYXRlJywgeyBkaXNwbGF5OiAnc3lzdGVtJyB9KVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBrZXk9e2B0ZWFtbWF0ZS0ke3Rhc2suaWR9YH1cbiAgICAgICAgICAvPlxuICAgICAgICApXG4gICAgICBjYXNlICdsb2NhbF93b3JrZmxvdyc6XG4gICAgICAgIGlmICghV29ya2Zsb3dEZXRhaWxEaWFsb2cpIHJldHVybiBudWxsXG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgPFdvcmtmbG93RGV0YWlsRGlhbG9nXG4gICAgICAgICAgICB3b3JrZmxvdz17dGFza31cbiAgICAgICAgICAgIG9uRG9uZT17b25Eb25lfVxuICAgICAgICAgICAgb25LaWxsPXtcbiAgICAgICAgICAgICAgdGFzay5zdGF0dXMgPT09ICdydW5uaW5nJyAmJiBraWxsV29ya2Zsb3dUYXNrXG4gICAgICAgICAgICAgICAgPyAoKSA9PiBraWxsV29ya2Zsb3dUYXNrKHRhc2suaWQsIHNldEFwcFN0YXRlKVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBvblNraXBBZ2VudD17XG4gICAgICAgICAgICAgIHRhc2suc3RhdHVzID09PSAncnVubmluZycgJiYgc2tpcFdvcmtmbG93QWdlbnRcbiAgICAgICAgICAgICAgICA/IGFnZW50SWQgPT4gc2tpcFdvcmtmbG93QWdlbnQodGFzay5pZCwgYWdlbnRJZCwgc2V0QXBwU3RhdGUpXG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG9uUmV0cnlBZ2VudD17XG4gICAgICAgICAgICAgIHRhc2suc3RhdHVzID09PSAncnVubmluZycgJiYgcmV0cnlXb3JrZmxvd0FnZW50XG4gICAgICAgICAgICAgICAgPyBhZ2VudElkID0+IHJldHJ5V29ya2Zsb3dBZ2VudCh0YXNrLmlkLCBhZ2VudElkLCBzZXRBcHBTdGF0ZSlcbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgb25CYWNrPXtnb0JhY2tUb0xpc3R9XG4gICAgICAgICAgICBrZXk9e2B3b3JrZmxvdy0ke3Rhc2suaWR9YH1cbiAgICAgICAgICAvPlxuICAgICAgICApXG4gICAgICBjYXNlICdtb25pdG9yX21jcCc6XG4gICAgICAgIGlmICghTW9uaXRvck1jcERldGFpbERpYWxvZykgcmV0dXJuIG51bGxcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICA8TW9uaXRvck1jcERldGFpbERpYWxvZ1xuICAgICAgICAgICAgdGFzaz17dGFza31cbiAgICAgICAgICAgIG9uS2lsbD17XG4gICAgICAgICAgICAgIHRhc2suc3RhdHVzID09PSAncnVubmluZycgJiYga2lsbE1vbml0b3JNY3BcbiAgICAgICAgICAgICAgICA/ICgpID0+IGtpbGxNb25pdG9yTWNwKHRhc2suaWQsIHNldEFwcFN0YXRlKVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBvbkJhY2s9e2dvQmFja1RvTGlzdH1cbiAgICAgICAgICAgIGtleT17YG1vbml0b3ItbWNwLSR7dGFzay5pZH1gfVxuICAgICAgICAgIC8+XG4gICAgICAgIClcbiAgICAgIGNhc2UgJ2RyZWFtJzpcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICA8RHJlYW1EZXRhaWxEaWFsb2dcbiAgICAgICAgICAgIHRhc2s9e3Rhc2t9XG4gICAgICAgICAgICBvbkRvbmU9eygpID0+XG4gICAgICAgICAgICAgIG9uRG9uZSgnQmFja2dyb3VuZCB0YXNrcyBkaWFsb2cgZGlzbWlzc2VkJywge1xuICAgICAgICAgICAgICAgIGRpc3BsYXk6ICdzeXN0ZW0nLFxuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgb25CYWNrPXtnb0JhY2tUb0xpc3R9XG4gICAgICAgICAgICBvbktpbGw9e1xuICAgICAgICAgICAgICB0YXNrLnN0YXR1cyA9PT0gJ3J1bm5pbmcnXG4gICAgICAgICAgICAgICAgPyAoKSA9PiB2b2lkIGtpbGxEcmVhbVRhc2sodGFzay5pZClcbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAga2V5PXtgZHJlYW0tJHt0YXNrLmlkfWB9XG4gICAgICAgICAgLz5cbiAgICAgICAgKVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHJ1bm5pbmdCYXNoQ291bnQgPSBjb3VudChiYXNoVGFza3MsIF8gPT4gXy5zdGF0dXMgPT09ICdydW5uaW5nJylcbiAgY29uc3QgcnVubmluZ0FnZW50Q291bnQgPVxuICAgIGNvdW50KFxuICAgICAgcmVtb3RlU2Vzc2lvbnMsXG4gICAgICBfID0+IF8uc3RhdHVzID09PSAncnVubmluZycgfHwgXy5zdGF0dXMgPT09ICdwZW5kaW5nJyxcbiAgICApICsgY291bnQoYWdlbnRUYXNrcywgXyA9PiBfLnN0YXR1cyA9PT0gJ3J1bm5pbmcnKVxuICBjb25zdCBydW5uaW5nVGVhbW1hdGVDb3VudCA9IGNvdW50KHRlYW1tYXRlVGFza3MsIF8gPT4gXy5zdGF0dXMgPT09ICdydW5uaW5nJylcbiAgY29uc3Qgc3VidGl0bGUgPSBpbnRlcnNwZXJzZShcbiAgICBbXG4gICAgICAuLi4ocnVubmluZ1RlYW1tYXRlQ291bnQgPiAwXG4gICAgICAgID8gW1xuICAgICAgICAgICAgPFRleHQga2V5PVwidGVhbW1hdGVzXCI+XG4gICAgICAgICAgICAgIHtydW5uaW5nVGVhbW1hdGVDb3VudH17JyAnfVxuICAgICAgICAgICAgICB7cnVubmluZ1RlYW1tYXRlQ291bnQgIT09IDEgPyAnYWdlbnRzJyA6ICdhZ2VudCd9XG4gICAgICAgICAgICA8L1RleHQ+LFxuICAgICAgICAgIF1cbiAgICAgICAgOiBbXSksXG4gICAgICAuLi4ocnVubmluZ0Jhc2hDb3VudCA+IDBcbiAgICAgICAgPyBbXG4gICAgICAgICAgICA8VGV4dCBrZXk9XCJzaGVsbHNcIj5cbiAgICAgICAgICAgICAge3J1bm5pbmdCYXNoQ291bnR9eycgJ31cbiAgICAgICAgICAgICAge3J1bm5pbmdCYXNoQ291bnQgIT09IDEgPyAnYWN0aXZlIHNoZWxscycgOiAnYWN0aXZlIHNoZWxsJ31cbiAgICAgICAgICAgIDwvVGV4dD4sXG4gICAgICAgICAgXVxuICAgICAgICA6IFtdKSxcbiAgICAgIC4uLihydW5uaW5nQWdlbnRDb3VudCA+IDBcbiAgICAgICAgPyBbXG4gICAgICAgICAgICA8VGV4dCBrZXk9XCJhZ2VudHNcIj5cbiAgICAgICAgICAgICAge3J1bm5pbmdBZ2VudENvdW50fXsnICd9XG4gICAgICAgICAgICAgIHtydW5uaW5nQWdlbnRDb3VudCAhPT0gMSA/ICdhY3RpdmUgYWdlbnRzJyA6ICdhY3RpdmUgYWdlbnQnfVxuICAgICAgICAgICAgPC9UZXh0PixcbiAgICAgICAgICBdXG4gICAgICAgIDogW10pLFxuICAgIF0sXG4gICAgaW5kZXggPT4gPFRleHQga2V5PXtgc2VwYXJhdG9yLSR7aW5kZXh9YH0+IMK3IDwvVGV4dD4sXG4gIClcblxuICBjb25zdCBhY3Rpb25zID0gW1xuICAgIDxLZXlib2FyZFNob3J0Y3V0SGludCBrZXk9XCJ1cERvd25cIiBzaG9ydGN1dD1cIuKGkS/ihpNcIiBhY3Rpb249XCJzZWxlY3RcIiAvPixcbiAgICA8S2V5Ym9hcmRTaG9ydGN1dEhpbnQga2V5PVwiZW50ZXJcIiBzaG9ydGN1dD1cIkVudGVyXCIgYWN0aW9uPVwidmlld1wiIC8+LFxuICAgIC4uLihjdXJyZW50U2VsZWN0aW9uPy50eXBlID09PSAnaW5fcHJvY2Vzc190ZWFtbWF0ZScgJiZcbiAgICBjdXJyZW50U2VsZWN0aW9uLnN0YXR1cyA9PT0gJ3J1bm5pbmcnXG4gICAgICA/IFtcbiAgICAgICAgICA8S2V5Ym9hcmRTaG9ydGN1dEhpbnRcbiAgICAgICAgICAgIGtleT1cImZvcmVncm91bmRcIlxuICAgICAgICAgICAgc2hvcnRjdXQ9XCJmXCJcbiAgICAgICAgICAgIGFjdGlvbj1cImZvcmVncm91bmRcIlxuICAgICAgICAgIC8+LFxuICAgICAgICBdXG4gICAgICA6IFtdKSxcbiAgICAuLi4oKGN1cnJlbnRTZWxlY3Rpb24/LnR5cGUgPT09ICdsb2NhbF9iYXNoJyB8fFxuICAgICAgY3VycmVudFNlbGVjdGlvbj8udHlwZSA9PT0gJ2xvY2FsX2FnZW50JyB8fFxuICAgICAgY3VycmVudFNlbGVjdGlvbj8udHlwZSA9PT0gJ2luX3Byb2Nlc3NfdGVhbW1hdGUnIHx8XG4gICAgICBjdXJyZW50U2VsZWN0aW9uPy50eXBlID09PSAnbG9jYWxfd29ya2Zsb3cnIHx8XG4gICAgICBjdXJyZW50U2VsZWN0aW9uPy50eXBlID09PSAnbW9uaXRvcl9tY3AnIHx8XG4gICAgICBjdXJyZW50U2VsZWN0aW9uPy50eXBlID09PSAnZHJlYW0nIHx8XG4gICAgICBjdXJyZW50U2VsZWN0aW9uPy50eXBlID09PSAncmVtb3RlX2FnZW50JykgJiZcbiAgICBjdXJyZW50U2VsZWN0aW9uLnN0YXR1cyA9PT0gJ3J1bm5pbmcnXG4gICAgICA/IFs8S2V5Ym9hcmRTaG9ydGN1dEhpbnQga2V5PVwia2lsbFwiIHNob3J0Y3V0PVwieFwiIGFjdGlvbj1cInN0b3BcIiAvPl1cbiAgICAgIDogW10pLFxuICAgIC4uLihhZ2VudFRhc2tzLnNvbWUodCA9PiB0LnN0YXR1cyA9PT0gJ3J1bm5pbmcnKVxuICAgICAgPyBbXG4gICAgICAgICAgPEtleWJvYXJkU2hvcnRjdXRIaW50XG4gICAgICAgICAgICBrZXk9XCJraWxsLWFsbFwiXG4gICAgICAgICAgICBzaG9ydGN1dD17a2lsbEFnZW50c1Nob3J0Y3V0fVxuICAgICAgICAgICAgYWN0aW9uPVwic3RvcCBhbGwgYWdlbnRzXCJcbiAgICAgICAgICAvPixcbiAgICAgICAgXVxuICAgICAgOiBbXSksXG4gICAgPEtleWJvYXJkU2hvcnRjdXRIaW50IGtleT1cImVzY1wiIHNob3J0Y3V0PVwi4oaQL0VzY1wiIGFjdGlvbj1cImNsb3NlXCIgLz4sXG4gIF1cblxuICBjb25zdCBoYW5kbGVDYW5jZWwgPSAoKSA9PlxuICAgIG9uRG9uZSgnQmFja2dyb3VuZCB0YXNrcyBkaWFsb2cgZGlzbWlzc2VkJywgeyBkaXNwbGF5OiAnc3lzdGVtJyB9KVxuXG4gIGZ1bmN0aW9uIHJlbmRlcklucHV0R3VpZGUoZXhpdFN0YXRlOiBFeGl0U3RhdGUpOiBSZWFjdC5SZWFjdE5vZGUge1xuICAgIGlmIChleGl0U3RhdGUucGVuZGluZykge1xuICAgICAgcmV0dXJuIDxUZXh0PlByZXNzIHtleGl0U3RhdGUua2V5TmFtZX0gYWdhaW4gdG8gZXhpdDwvVGV4dD5cbiAgICB9XG4gICAgcmV0dXJuIDxCeWxpbmU+e2FjdGlvbnN9PC9CeWxpbmU+XG4gIH1cblxuICByZXR1cm4gKFxuICAgIDxCb3hcbiAgICAgIGZsZXhEaXJlY3Rpb249XCJjb2x1bW5cIlxuICAgICAgdGFiSW5kZXg9ezB9XG4gICAgICBhdXRvRm9jdXNcbiAgICAgIG9uS2V5RG93bj17aGFuZGxlS2V5RG93bn1cbiAgICA+XG4gICAgICA8RGlhbG9nXG4gICAgICAgIHRpdGxlPVwiQmFja2dyb3VuZCB0YXNrc1wiXG4gICAgICAgIHN1YnRpdGxlPXs8PntzdWJ0aXRsZX08Lz59XG4gICAgICAgIG9uQ2FuY2VsPXtoYW5kbGVDYW5jZWx9XG4gICAgICAgIGNvbG9yPVwiYmFja2dyb3VuZFwiXG4gICAgICAgIGlucHV0R3VpZGU9e3JlbmRlcklucHV0R3VpZGV9XG4gICAgICA+XG4gICAgICAgIHthbGxTZWxlY3RhYmxlSXRlbXMubGVuZ3RoID09PSAwID8gKFxuICAgICAgICAgIDxUZXh0IGRpbUNvbG9yPk5vIHRhc2tzIGN1cnJlbnRseSBydW5uaW5nPC9UZXh0PlxuICAgICAgICApIDogKFxuICAgICAgICAgIDxCb3ggZmxleERpcmVjdGlvbj1cImNvbHVtblwiPlxuICAgICAgICAgICAge3RlYW1tYXRlVGFza3MubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgICAgICAgIDxCb3ggZmxleERpcmVjdGlvbj1cImNvbHVtblwiPlxuICAgICAgICAgICAgICAgIHsoYmFzaFRhc2tzLmxlbmd0aCA+IDAgfHxcbiAgICAgICAgICAgICAgICAgIHJlbW90ZVNlc3Npb25zLmxlbmd0aCA+IDAgfHxcbiAgICAgICAgICAgICAgICAgIGFnZW50VGFza3MubGVuZ3RoID4gMCkgJiYgKFxuICAgICAgICAgICAgICAgICAgPFRleHQgZGltQ29sb3I+XG4gICAgICAgICAgICAgICAgICAgIDxUZXh0IGJvbGQ+eycgICd9QWdlbnRzPC9UZXh0PiAoXG4gICAgICAgICAgICAgICAgICAgIHtjb3VudCh0ZWFtbWF0ZVRhc2tzLCBpID0+IGkudHlwZSAhPT0gJ2xlYWRlcicpfSlcbiAgICAgICAgICAgICAgICAgIDwvVGV4dD5cbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgIDxCb3ggZmxleERpcmVjdGlvbj1cImNvbHVtblwiPlxuICAgICAgICAgICAgICAgICAgPFRlYW1tYXRlVGFza0dyb3Vwc1xuICAgICAgICAgICAgICAgICAgICB0ZWFtbWF0ZVRhc2tzPXt0ZWFtbWF0ZVRhc2tzfVxuICAgICAgICAgICAgICAgICAgICBjdXJyZW50U2VsZWN0aW9uSWQ9e2N1cnJlbnRTZWxlY3Rpb24/LmlkfVxuICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L0JveD5cbiAgICAgICAgICAgICAgPC9Cb3g+XG4gICAgICAgICAgICApfVxuXG4gICAgICAgICAgICB7YmFzaFRhc2tzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICAgICAgICA8Qm94XG4gICAgICAgICAgICAgICAgZmxleERpcmVjdGlvbj1cImNvbHVtblwiXG4gICAgICAgICAgICAgICAgbWFyZ2luVG9wPXt0ZWFtbWF0ZVRhc2tzLmxlbmd0aCA+IDAgPyAxIDogMH1cbiAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIHsodGVhbW1hdGVUYXNrcy5sZW5ndGggPiAwIHx8XG4gICAgICAgICAgICAgICAgICByZW1vdGVTZXNzaW9ucy5sZW5ndGggPiAwIHx8XG4gICAgICAgICAgICAgICAgICBhZ2VudFRhc2tzLmxlbmd0aCA+IDApICYmIChcbiAgICAgICAgICAgICAgICAgIDxUZXh0IGRpbUNvbG9yPlxuICAgICAgICAgICAgICAgICAgICA8VGV4dCBib2xkPnsnICAnfVNoZWxsczwvVGV4dD4gKHtiYXNoVGFza3MubGVuZ3RofSlcbiAgICAgICAgICAgICAgICAgIDwvVGV4dD5cbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgIDxCb3ggZmxleERpcmVjdGlvbj1cImNvbHVtblwiPlxuICAgICAgICAgICAgICAgICAge2Jhc2hUYXNrcy5tYXAoaXRlbSA9PiAoXG4gICAgICAgICAgICAgICAgICAgIDxJdGVtXG4gICAgICAgICAgICAgICAgICAgICAga2V5PXtpdGVtLmlkfVxuICAgICAgICAgICAgICAgICAgICAgIGl0ZW09e2l0ZW19XG4gICAgICAgICAgICAgICAgICAgICAgaXNTZWxlY3RlZD17aXRlbS5pZCA9PT0gY3VycmVudFNlbGVjdGlvbj8uaWR9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICA8L0JveD5cbiAgICAgICAgICAgICAgPC9Cb3g+XG4gICAgICAgICAgICApfVxuXG4gICAgICAgICAgICB7bWNwTW9uaXRvcnMubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgICAgICAgIDxCb3hcbiAgICAgICAgICAgICAgICBmbGV4RGlyZWN0aW9uPVwiY29sdW1uXCJcbiAgICAgICAgICAgICAgICBtYXJnaW5Ub3A9e1xuICAgICAgICAgICAgICAgICAgdGVhbW1hdGVUYXNrcy5sZW5ndGggPiAwIHx8IGJhc2hUYXNrcy5sZW5ndGggPiAwID8gMSA6IDBcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8VGV4dCBkaW1Db2xvcj5cbiAgICAgICAgICAgICAgICAgIDxUZXh0IGJvbGQ+eycgICd9TW9uaXRvcnM8L1RleHQ+ICh7bWNwTW9uaXRvcnMubGVuZ3RofSlcbiAgICAgICAgICAgICAgICA8L1RleHQ+XG4gICAgICAgICAgICAgICAgPEJveCBmbGV4RGlyZWN0aW9uPVwiY29sdW1uXCI+XG4gICAgICAgICAgICAgICAgICB7bWNwTW9uaXRvcnMubWFwKGl0ZW0gPT4gKFxuICAgICAgICAgICAgICAgICAgICA8SXRlbVxuICAgICAgICAgICAgICAgICAgICAgIGtleT17aXRlbS5pZH1cbiAgICAgICAgICAgICAgICAgICAgICBpdGVtPXtpdGVtfVxuICAgICAgICAgICAgICAgICAgICAgIGlzU2VsZWN0ZWQ9e2l0ZW0uaWQgPT09IGN1cnJlbnRTZWxlY3Rpb24/LmlkfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICAgICAgPC9Cb3g+XG4gICAgICAgICAgICAgIDwvQm94PlxuICAgICAgICAgICAgKX1cblxuICAgICAgICAgICAge3JlbW90ZVNlc3Npb25zLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICAgICAgICA8Qm94XG4gICAgICAgICAgICAgICAgZmxleERpcmVjdGlvbj1cImNvbHVtblwiXG4gICAgICAgICAgICAgICAgbWFyZ2luVG9wPXtcbiAgICAgICAgICAgICAgICAgIHRlYW1tYXRlVGFza3MubGVuZ3RoID4gMCB8fFxuICAgICAgICAgICAgICAgICAgYmFzaFRhc2tzLmxlbmd0aCA+IDAgfHxcbiAgICAgICAgICAgICAgICAgIG1jcE1vbml0b3JzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICAgICAgICAgPyAxXG4gICAgICAgICAgICAgICAgICAgIDogMFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIDxUZXh0IGRpbUNvbG9yPlxuICAgICAgICAgICAgICAgICAgPFRleHQgYm9sZD57JyAgJ31SZW1vdGUgYWdlbnRzPC9UZXh0PiAoe3JlbW90ZVNlc3Npb25zLmxlbmd0aH1cbiAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICA8L1RleHQ+XG4gICAgICAgICAgICAgICAgPEJveCBmbGV4RGlyZWN0aW9uPVwiY29sdW1uXCI+XG4gICAgICAgICAgICAgICAgICB7cmVtb3RlU2Vzc2lvbnMubWFwKGl0ZW0gPT4gKFxuICAgICAgICAgICAgICAgICAgICA8SXRlbVxuICAgICAgICAgICAgICAgICAgICAgIGtleT17aXRlbS5pZH1cbiAgICAgICAgICAgICAgICAgICAgICBpdGVtPXtpdGVtfVxuICAgICAgICAgICAgICAgICAgICAgIGlzU2VsZWN0ZWQ9e2l0ZW0uaWQgPT09IGN1cnJlbnRTZWxlY3Rpb24/LmlkfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICAgICAgPC9Cb3g+XG4gICAgICAgICAgICAgIDwvQm94PlxuICAgICAgICAgICAgKX1cblxuICAgICAgICAgICAge2FnZW50VGFza3MubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgICAgICAgIDxCb3hcbiAgICAgICAgICAgICAgICBmbGV4RGlyZWN0aW9uPVwiY29sdW1uXCJcbiAgICAgICAgICAgICAgICBtYXJnaW5Ub3A9e1xuICAgICAgICAgICAgICAgICAgdGVhbW1hdGVUYXNrcy5sZW5ndGggPiAwIHx8XG4gICAgICAgICAgICAgICAgICBiYXNoVGFza3MubGVuZ3RoID4gMCB8fFxuICAgICAgICAgICAgICAgICAgbWNwTW9uaXRvcnMubGVuZ3RoID4gMCB8fFxuICAgICAgICAgICAgICAgICAgcmVtb3RlU2Vzc2lvbnMubGVuZ3RoID4gMFxuICAgICAgICAgICAgICAgICAgICA/IDFcbiAgICAgICAgICAgICAgICAgICAgOiAwXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPFRleHQgZGltQ29sb3I+XG4gICAgICAgICAgICAgICAgICA8VGV4dCBib2xkPnsnICAnfUxvY2FsIGFnZW50czwvVGV4dD4gKHthZ2VudFRhc2tzLmxlbmd0aH0pXG4gICAgICAgICAgICAgICAgPC9UZXh0PlxuICAgICAgICAgICAgICAgIDxCb3ggZmxleERpcmVjdGlvbj1cImNvbHVtblwiPlxuICAgICAgICAgICAgICAgICAge2FnZW50VGFza3MubWFwKGl0ZW0gPT4gKFxuICAgICAgICAgICAgICAgICAgICA8SXRlbVxuICAgICAgICAgICAgICAgICAgICAgIGtleT17aXRlbS5pZH1cbiAgICAgICAgICAgICAgICAgICAgICBpdGVtPXtpdGVtfVxuICAgICAgICAgICAgICAgICAgICAgIGlzU2VsZWN0ZWQ9e2l0ZW0uaWQgPT09IGN1cnJlbnRTZWxlY3Rpb24/LmlkfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICAgICAgPC9Cb3g+XG4gICAgICAgICAgICAgIDwvQm94PlxuICAgICAgICAgICAgKX1cblxuICAgICAgICAgICAge3dvcmtmbG93VGFza3MubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgICAgICAgIDxCb3hcbiAgICAgICAgICAgICAgICBmbGV4RGlyZWN0aW9uPVwiY29sdW1uXCJcbiAgICAgICAgICAgICAgICBtYXJnaW5Ub3A9e1xuICAgICAgICAgICAgICAgICAgdGVhbW1hdGVUYXNrcy5sZW5ndGggPiAwIHx8XG4gICAgICAgICAgICAgICAgICBiYXNoVGFza3MubGVuZ3RoID4gMCB8fFxuICAgICAgICAgICAgICAgICAgbWNwTW9uaXRvcnMubGVuZ3RoID4gMCB8fFxuICAgICAgICAgICAgICAgICAgcmVtb3RlU2Vzc2lvbnMubGVuZ3RoID4gMCB8fFxuICAgICAgICAgICAgICAgICAgYWdlbnRUYXNrcy5sZW5ndGggPiAwXG4gICAgICAgICAgICAgICAgICAgID8gMVxuICAgICAgICAgICAgICAgICAgICA6IDBcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8VGV4dCBkaW1Db2xvcj5cbiAgICAgICAgICAgICAgICAgIDxUZXh0IGJvbGQ+eycgICd9V29ya2Zsb3dzPC9UZXh0PiAoe3dvcmtmbG93VGFza3MubGVuZ3RofSlcbiAgICAgICAgICAgICAgICA8L1RleHQ+XG4gICAgICAgICAgICAgICAgPEJveCBmbGV4RGlyZWN0aW9uPVwiY29sdW1uXCI+XG4gICAgICAgICAgICAgICAgICB7d29ya2Zsb3dUYXNrcy5tYXAoaXRlbSA9PiAoXG4gICAgICAgICAgICAgICAgICAgIDxJdGVtXG4gICAgICAgICAgICAgICAgICAgICAga2V5PXtpdGVtLmlkfVxuICAgICAgICAgICAgICAgICAgICAgIGl0ZW09e2l0ZW19XG4gICAgICAgICAgICAgICAgICAgICAgaXNTZWxlY3RlZD17aXRlbS5pZCA9PT0gY3VycmVudFNlbGVjdGlvbj8uaWR9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICA8L0JveD5cbiAgICAgICAgICAgICAgPC9Cb3g+XG4gICAgICAgICAgICApfVxuXG4gICAgICAgICAgICB7ZHJlYW1UYXNrcy5sZW5ndGggPiAwICYmIChcbiAgICAgICAgICAgICAgPEJveFxuICAgICAgICAgICAgICAgIGZsZXhEaXJlY3Rpb249XCJjb2x1bW5cIlxuICAgICAgICAgICAgICAgIG1hcmdpblRvcD17XG4gICAgICAgICAgICAgICAgICB0ZWFtbWF0ZVRhc2tzLmxlbmd0aCA+IDAgfHxcbiAgICAgICAgICAgICAgICAgIGJhc2hUYXNrcy5sZW5ndGggPiAwIHx8XG4gICAgICAgICAgICAgICAgICBtY3BNb25pdG9ycy5sZW5ndGggPiAwIHx8XG4gICAgICAgICAgICAgICAgICByZW1vdGVTZXNzaW9ucy5sZW5ndGggPiAwIHx8XG4gICAgICAgICAgICAgICAgICBhZ2VudFRhc2tzLmxlbmd0aCA+IDAgfHxcbiAgICAgICAgICAgICAgICAgIHdvcmtmbG93VGFza3MubGVuZ3RoID4gMFxuICAgICAgICAgICAgICAgICAgICA/IDFcbiAgICAgICAgICAgICAgICAgICAgOiAwXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPEJveCBmbGV4RGlyZWN0aW9uPVwiY29sdW1uXCI+XG4gICAgICAgICAgICAgICAgICB7ZHJlYW1UYXNrcy5tYXAoaXRlbSA9PiAoXG4gICAgICAgICAgICAgICAgICAgIDxJdGVtXG4gICAgICAgICAgICAgICAgICAgICAga2V5PXtpdGVtLmlkfVxuICAgICAgICAgICAgICAgICAgICAgIGl0ZW09e2l0ZW19XG4gICAgICAgICAgICAgICAgICAgICAgaXNTZWxlY3RlZD17aXRlbS5pZCA9PT0gY3VycmVudFNlbGVjdGlvbj8uaWR9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICA8L0JveD5cbiAgICAgICAgICAgICAgPC9Cb3g+XG4gICAgICAgICAgICApfVxuICAgICAgICAgIDwvQm94PlxuICAgICAgICApfVxuICAgICAgPC9EaWFsb2c+XG4gICAgPC9Cb3g+XG4gIClcbn1cblxuZnVuY3Rpb24gdG9MaXN0SXRlbSh0YXNrOiBCYWNrZ3JvdW5kVGFza1N0YXRlKTogTGlzdEl0ZW0ge1xuICBzd2l0Y2ggKHRhc2sudHlwZSkge1xuICAgIGNhc2UgJ2xvY2FsX2Jhc2gnOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaWQ6IHRhc2suaWQsXG4gICAgICAgIHR5cGU6ICdsb2NhbF9iYXNoJyxcbiAgICAgICAgbGFiZWw6IHRhc2sua2luZCA9PT0gJ21vbml0b3InID8gdGFzay5kZXNjcmlwdGlvbiA6IHRhc2suY29tbWFuZCxcbiAgICAgICAgc3RhdHVzOiB0YXNrLnN0YXR1cyxcbiAgICAgICAgdGFzayxcbiAgICAgIH1cbiAgICBjYXNlICdyZW1vdGVfYWdlbnQnOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaWQ6IHRhc2suaWQsXG4gICAgICAgIHR5cGU6ICdyZW1vdGVfYWdlbnQnLFxuICAgICAgICBsYWJlbDogdGFzay50aXRsZSxcbiAgICAgICAgc3RhdHVzOiB0YXNrLnN0YXR1cyxcbiAgICAgICAgdGFzayxcbiAgICAgIH1cbiAgICBjYXNlICdsb2NhbF9hZ2VudCc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpZDogdGFzay5pZCxcbiAgICAgICAgdHlwZTogJ2xvY2FsX2FnZW50JyxcbiAgICAgICAgbGFiZWw6IHRhc2suZGVzY3JpcHRpb24sXG4gICAgICAgIHN0YXR1czogdGFzay5zdGF0dXMsXG4gICAgICAgIHRhc2ssXG4gICAgICB9XG4gICAgY2FzZSAnaW5fcHJvY2Vzc190ZWFtbWF0ZSc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpZDogdGFzay5pZCxcbiAgICAgICAgdHlwZTogJ2luX3Byb2Nlc3NfdGVhbW1hdGUnLFxuICAgICAgICBsYWJlbDogYEAke3Rhc2suaWRlbnRpdHkuYWdlbnROYW1lfWAsXG4gICAgICAgIHN0YXR1czogdGFzay5zdGF0dXMsXG4gICAgICAgIHRhc2ssXG4gICAgICB9XG4gICAgY2FzZSAnbG9jYWxfd29ya2Zsb3cnOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaWQ6IHRhc2suaWQsXG4gICAgICAgIHR5cGU6ICdsb2NhbF93b3JrZmxvdycsXG4gICAgICAgIGxhYmVsOiB0YXNrLnN1bW1hcnkgPz8gdGFzay5kZXNjcmlwdGlvbixcbiAgICAgICAgc3RhdHVzOiB0YXNrLnN0YXR1cyxcbiAgICAgICAgdGFzayxcbiAgICAgIH1cbiAgICBjYXNlICdtb25pdG9yX21jcCc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpZDogdGFzay5pZCxcbiAgICAgICAgdHlwZTogJ21vbml0b3JfbWNwJyxcbiAgICAgICAgbGFiZWw6IHRhc2suZGVzY3JpcHRpb24sXG4gICAgICAgIHN0YXR1czogdGFzay5zdGF0dXMsXG4gICAgICAgIHRhc2ssXG4gICAgICB9XG4gICAgY2FzZSAnZHJlYW0nOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaWQ6IHRhc2suaWQsXG4gICAgICAgIHR5cGU6ICdkcmVhbScsXG4gICAgICAgIGxhYmVsOiB0YXNrLmRlc2NyaXB0aW9uLFxuICAgICAgICBzdGF0dXM6IHRhc2suc3RhdHVzLFxuICAgICAgICB0YXNrLFxuICAgICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIEl0ZW0oe1xuICBpdGVtLFxuICBpc1NlbGVjdGVkLFxufToge1xuICBpdGVtOiBMaXN0SXRlbVxuICBpc1NlbGVjdGVkOiBib29sZWFuXG59KTogUmVhY3ROb2RlIHtcbiAgY29uc3QgeyBjb2x1bW5zIH0gPSB1c2VUZXJtaW5hbFNpemUoKVxuICAvLyBEaWFsb2cgYm9yZGVyICgyKSArIHBhZGRpbmcgKDIpICsgcG9pbnRlciBwcmVmaXggKDIpICsgbmFtZS9zdGF0dXMgb3ZlcmhlYWQgKH4yMClcbiAgY29uc3QgbWF4QWN0aXZpdHlXaWR0aCA9IE1hdGgubWF4KDMwLCBjb2x1bW5zIC0gMjYpXG4gIC8vIEluIGNvb3JkaW5hdG9yIG1vZGUsIHVzZSBncmV5IHBvaW50ZXIgaW5zdGVhZCBvZiBibHVlXG4gIGNvbnN0IHVzZUdyZXlQb2ludGVyID0gaXNDb29yZGluYXRvck1vZGUoKVxuXG4gIHJldHVybiAoXG4gICAgPEJveCBmbGV4RGlyZWN0aW9uPVwicm93XCI+XG4gICAgICA8VGV4dCBkaW1Db2xvcj17dXNlR3JleVBvaW50ZXIgJiYgaXNTZWxlY3RlZH0+XG4gICAgICAgIHtpc1NlbGVjdGVkID8gZmlndXJlcy5wb2ludGVyICsgJyAnIDogJyAgJ31cbiAgICAgIDwvVGV4dD5cbiAgICAgIDxUZXh0IGNvbG9yPXtpc1NlbGVjdGVkICYmICF1c2VHcmV5UG9pbnRlciA/ICdzdWdnZXN0aW9uJyA6IHVuZGVmaW5lZH0+XG4gICAgICAgIHtpdGVtLnR5cGUgPT09ICdsZWFkZXInID8gKFxuICAgICAgICAgIDxUZXh0PkB7VEVBTV9MRUFEX05BTUV9PC9UZXh0PlxuICAgICAgICApIDogKFxuICAgICAgICAgIDxCYWNrZ3JvdW5kVGFza0NvbXBvbmVudFxuICAgICAgICAgICAgdGFzaz17aXRlbS50YXNrfVxuICAgICAgICAgICAgbWF4QWN0aXZpdHlXaWR0aD17bWF4QWN0aXZpdHlXaWR0aH1cbiAgICAgICAgICAvPlxuICAgICAgICApfVxuICAgICAgPC9UZXh0PlxuICAgIDwvQm94PlxuICApXG59XG5cbmZ1bmN0aW9uIFRlYW1tYXRlVGFza0dyb3Vwcyh7XG4gIHRlYW1tYXRlVGFza3MsXG4gIGN1cnJlbnRTZWxlY3Rpb25JZCxcbn06IHtcbiAgdGVhbW1hdGVUYXNrczogTGlzdEl0ZW1bXVxuICBjdXJyZW50U2VsZWN0aW9uSWQ6IHN0cmluZyB8IHVuZGVmaW5lZFxufSk6IFJlYWN0Tm9kZSB7XG4gIC8vIFNlcGFyYXRlIGxlYWRlciBmcm9tIHRlYW1tYXRlcywgZ3JvdXAgdGVhbW1hdGVzIGJ5IHRlYW1cbiAgY29uc3QgbGVhZGVySXRlbXMgPSB0ZWFtbWF0ZVRhc2tzLmZpbHRlcihpID0+IGkudHlwZSA9PT0gJ2xlYWRlcicpXG4gIGNvbnN0IHRlYW1tYXRlSXRlbXMgPSB0ZWFtbWF0ZVRhc2tzLmZpbHRlcihcbiAgICBpID0+IGkudHlwZSA9PT0gJ2luX3Byb2Nlc3NfdGVhbW1hdGUnLFxuICApXG4gIGNvbnN0IHRlYW1zID0gbmV3IE1hcDxzdHJpbmcsIHR5cGVvZiB0ZWFtbWF0ZUl0ZW1zPigpXG4gIGZvciAoY29uc3QgaXRlbSBvZiB0ZWFtbWF0ZUl0ZW1zKSB7XG4gICAgY29uc3QgdGVhbU5hbWUgPSBpdGVtLnRhc2suaWRlbnRpdHkudGVhbU5hbWVcbiAgICBjb25zdCBncm91cCA9IHRlYW1zLmdldCh0ZWFtTmFtZSlcbiAgICBpZiAoZ3JvdXApIHtcbiAgICAgIGdyb3VwLnB1c2goaXRlbSlcbiAgICB9IGVsc2Uge1xuICAgICAgdGVhbXMuc2V0KHRlYW1OYW1lLCBbaXRlbV0pXG4gICAgfVxuICB9XG4gIGNvbnN0IHRlYW1FbnRyaWVzID0gWy4uLnRlYW1zLmVudHJpZXMoKV1cbiAgcmV0dXJuIChcbiAgICA8PlxuICAgICAge3RlYW1FbnRyaWVzLm1hcCgoW3RlYW1OYW1lLCBpdGVtc10pID0+IHtcbiAgICAgICAgY29uc3QgbWVtYmVyQ291bnQgPSBpdGVtcy5sZW5ndGggKyBsZWFkZXJJdGVtcy5sZW5ndGhcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICA8Qm94IGtleT17dGVhbU5hbWV9IGZsZXhEaXJlY3Rpb249XCJjb2x1bW5cIj5cbiAgICAgICAgICAgIDxUZXh0IGRpbUNvbG9yPlxuICAgICAgICAgICAgICB7JyAgJ31UZWFtOiB7dGVhbU5hbWV9ICh7bWVtYmVyQ291bnR9KVxuICAgICAgICAgICAgPC9UZXh0PlxuICAgICAgICAgICAgey8qIFJlbmRlciBsZWFkZXIgZmlyc3Qgd2l0aGluIGVhY2ggdGVhbSAqL31cbiAgICAgICAgICAgIHtsZWFkZXJJdGVtcy5tYXAoaXRlbSA9PiAoXG4gICAgICAgICAgICAgIDxJdGVtXG4gICAgICAgICAgICAgICAga2V5PXtgJHtpdGVtLmlkfS0ke3RlYW1OYW1lfWB9XG4gICAgICAgICAgICAgICAgaXRlbT17aXRlbX1cbiAgICAgICAgICAgICAgICBpc1NlbGVjdGVkPXtpdGVtLmlkID09PSBjdXJyZW50U2VsZWN0aW9uSWR9XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgICAgIHtpdGVtcy5tYXAoaXRlbSA9PiAoXG4gICAgICAgICAgICAgIDxJdGVtXG4gICAgICAgICAgICAgICAga2V5PXtpdGVtLmlkfVxuICAgICAgICAgICAgICAgIGl0ZW09e2l0ZW19XG4gICAgICAgICAgICAgICAgaXNTZWxlY3RlZD17aXRlbS5pZCA9PT0gY3VycmVudFNlbGVjdGlvbklkfVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAgPC9Cb3g+XG4gICAgICAgIClcbiAgICAgIH0pfVxuICAgIDwvPlxuICApXG59XG4iXSwibWFwcGluZ3MiOiI7QUFBQSxTQUFTQSxPQUFPLFFBQVEsWUFBWTtBQUNwQyxPQUFPQyxPQUFPLE1BQU0sU0FBUztBQUM3QixPQUFPQyxLQUFLLElBQ1YsS0FBS0MsU0FBUyxFQUNkQyxTQUFTLEVBQ1RDLGNBQWMsRUFDZEMsT0FBTyxFQUNQQyxNQUFNLEVBQ05DLFFBQVEsUUFDSCxPQUFPO0FBQ2QsU0FBU0MsaUJBQWlCLFFBQVEsb0NBQW9DO0FBQ3RFLFNBQVNDLGVBQWUsUUFBUSw4QkFBOEI7QUFDOUQsU0FBU0MsV0FBVyxFQUFFQyxjQUFjLFFBQVEsdUJBQXVCO0FBQ25FLFNBQ0VDLGlCQUFpQixFQUNqQkMsZ0JBQWdCLFFBQ1gsa0NBQWtDO0FBQ3pDLGNBQWNDLGNBQWMsUUFBUSxhQUFhO0FBQ2pELFNBQ0VDLFNBQVMsRUFDVCxLQUFLQyxjQUFjLFFBQ2Qsa0NBQWtDO0FBQ3pDLFNBQVNDLHFCQUFxQixRQUFRLDBEQUEwRDtBQUNoRyxjQUFjQywwQkFBMEIsUUFBUSwwQ0FBMEM7QUFDMUYsY0FBY0MsbUJBQW1CLFFBQVEsNENBQTRDO0FBQ3JGLFNBQVNDLGNBQWMsUUFBUSw0Q0FBNEM7QUFDM0UsY0FBY0MsbUJBQW1CLFFBQVEsb0NBQW9DO0FBQzdFLFNBQVNDLGNBQWMsUUFBUSw0Q0FBNEM7QUFDM0U7QUFDQSxjQUFjQyxzQkFBc0IsUUFBUSxrREFBa0Q7QUFDOUYsY0FBY0MsbUJBQW1CLFFBQVEsNENBQTRDO0FBQ3JGLFNBQ0VDLGVBQWUsRUFDZixLQUFLQyxvQkFBb0IsUUFDcEIsOENB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LENBQUMsQ0FBQztNQUFBO0lBQzVCO0lBRUgsTUFBQTBGLFdBQUEsR0FBb0IsSUFBSVAsS0FBSyxDQUFBUSxPQUFRLENBQUMsQ0FBQyxDQUFDO0lBRXRDMUIsRUFBQSxLQUNHLENBQUF5QixXQUFXLENBQUF0RyxHQUFJLENBQUNpRixFQUFBO1FBQUMsT0FBQXVCLFVBQUEsRUFBQUMsS0FBQSxJQUFBeEIsRUFBaUI7UUFDakMsTUFBQXlCLFdBQUEsR0FBb0JELEtBQUssQ0FBQXBILE1BQU8sR0FBR3NHLFdBQVcsQ0FBQXRHLE1BQU87UUFBQSxPQUVuRCxDQUFDLEdBQUcsQ0FBTTRHLEdBQVEsQ0FBUkEsV0FBTyxDQUFDLENBQWdCLGFBQVEsQ0FBUixRQUFRLENBQ3hDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBUixLQUFPLENBQUMsQ0FDWCxLQUFHLENBQUUsTUFBT0EsV0FBTyxDQUFFLEVBQUdTLFlBQVUsQ0FBRSxDQUN2QyxFQUZDLElBQUksQ0FJSixDQUFBZixXQUFXLENBQUEzRixHQUFJLENBQUMyRyxNQUFBLElBQ2YsQ0FBQyxJQUFJLENBQ0UsR0FBd0IsQ0FBeEIsSUFBRy9GLE1BQUksQ0FBQXpELEVBQUcsSUFBSThJLFVBQVEsRUFBQyxDQUFDLENBQ3ZCckYsSUFBSSxDQUFKQSxPQUFHLENBQUMsQ0FDRSxVQUE4QixDQUE5QixDQUFBQSxNQUFJLENBQUF6RCxFQUFHLEtBQUt1SSxrQkFBaUIsQ0FBQyxHQUU3QyxFQUNBLENBQUFlLEtBQUssQ0FBQXpHLEdBQUksQ0FBQzRHLE1BQUEsSUFDVCxDQUFDLElBQUksQ0FDRSxHQUFPLENBQVAsQ0FBQWhHLE1BQUksQ0FBQXpELEVBQUUsQ0FBQyxDQUNOeUQsSUFBSSxDQUFKQSxPQUFHLENBQUMsQ0FDRSxVQUE4QixDQUE5QixDQUFBQSxNQUFJLENBQUF6RCxFQUFHLEtBQUt1SSxrQkFBaUIsQ0FBQyxHQUU3QyxFQUNILEVBbkJDLEdBQUcsQ0FtQkU7TUFBQSxDQUVULEVBQUMsR0FDRDtJQUFBbEIsQ0FBQSxNQUFBa0Isa0JBQUE7SUFBQWxCLENBQUEsTUFBQTdFLGFBQUE7SUFBQTZFLENBQUEsTUFBQUssRUFBQTtFQUFBO0lBQUFBLEVBQUEsR0FBQUwsQ0FBQTtFQUFBO0VBQUEsT0ExQkhLLEVBMEJHO0FBQUE7QUFsRFAsU0FBQWlCLE9BQUFlLEdBQUE7RUFBQSxPQVVTL0MsR0FBQyxDQUFBMUcsSUFBSyxLQUFLLHFCQUFxQjtBQUFBO0FBVnpDLFNBQUF3SSxNQUFBOUIsQ0FBQTtFQUFBLE9BUWdEQSxDQUFDLENBQUExRyxJQUFLLEtBQUssUUFBUTtBQUFBIiwiaWdub3JlTGlzdCI6W119