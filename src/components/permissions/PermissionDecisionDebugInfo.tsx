import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import chalk from 'chalk';
import figures from 'figures';
import React, { useMemo } from 'react';
import { Ansi, Box, color, Text, useTheme } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import type { PermissionMode } from '../../utils/permissions/PermissionMode.js';
import { permissionModeTitle } from '../../utils/permissions/PermissionMode.js';
import type { PermissionDecision, PermissionDecisionReason, PermissionResult } from '../../utils/permissions/PermissionResult.js';
import { extractRules } from '../../utils/permissions/PermissionUpdate.js';
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js';
import { permissionRuleValueToString } from '../../utils/permissions/permissionRuleParser.js';
import { detectUnreachableRules } from '../../utils/permissions/shadowedRuleDetection.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { getSettingSourceDisplayNameLowercase } from '../../utils/settings/constants.js';
type PermissionDecisionInfoItemProps = {
  title?: string;
  decisionReason: PermissionDecisionReason;
};
function decisionReasonDisplayString(decisionReason: PermissionDecisionReason & {
  type: Exclude<PermissionDecisionReason['type'], 'subcommandResults'>;
}): string {
  if ((feature('BASH_CLASSIFIER') || feature('TRANSCRIPT_CLASSIFIER')) && decisionReason.type === 'classifier') {
    return `${chalk.bold(decisionReason.classifier)} classifier: ${decisionReason.reason}`;
  }
  switch (decisionReason.type) {
    case 'rule':
      return `${chalk.bold(permissionRuleValueToString(decisionReason.rule.ruleValue))} rule from ${getSettingSourceDisplayNameLowercase(decisionReason.rule.source)}`;
    case 'mode':
      return `${permissionModeTitle(decisionReason.mode)} mode`;
    case 'sandboxOverride':
      return 'Requires permission to bypass sandbox';
    case 'workingDir':
      return decisionReason.reason;
    case 'safetyCheck':
    case 'other':
      return decisionReason.reason;
    case 'permissionPromptTool':
      return `${chalk.bold(decisionReason.permissionPromptToolName)} permission prompt tool`;
    case 'hook':
      return decisionReason.reason ? `${chalk.bold(decisionReason.hookName)} hook: ${decisionReason.reason}` : `${chalk.bold(decisionReason.hookName)} hook`;
    case 'asyncAgent':
      return decisionReason.reason;
    default:
      return '';
  }
}
function PermissionDecisionInfoItem(t0) {
  const $ = _c(10);
  const {
    title,
    decisionReason
  } = t0;
  const [theme] = useTheme();
  let t1;
  if ($[0] !== decisionReason || $[1] !== theme) {
    t1 = function formatDecisionReason() {
      switch (decisionReason.type) {
        case "subcommandResults":
          {
            return <Box flexDirection="column">{Array.from(decisionReason.reasons.entries()).map((t2: [string, PermissionResult]) => {
                const [subcommand, result] = t2;
                const icon = result.behavior === "allow" ? color("success", theme)(figures.tick) : color("error", theme)(figures.cross);
                return <Box flexDirection="column" key={subcommand}><Text>{icon} {subcommand}</Text>{result.decisionReason !== undefined && result.decisionReason.type !== "subcommandResults" && <Text><Text dimColor={true}>{"  "}⎿{"  "}</Text><Ansi>{decisionReasonDisplayString(result.decisionReason)}</Ansi></Text>}{result.behavior === "ask" && <SuggestedRules suggestions={result.suggestions} />}</Box>;
              })}</Box>;
          }
        default:
          {
            return <Text><Ansi>{decisionReasonDisplayString(decisionReason)}</Ansi></Text>;
          }
      }
    };
    $[0] = decisionReason;
    $[1] = theme;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const formatDecisionReason = t1;
  let t2;
  if ($[3] !== title) {
    t2 = title && <Text>{title}</Text>;
    $[3] = title;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] !== formatDecisionReason) {
    t3 = formatDecisionReason();
    $[5] = formatDecisionReason;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] !== t2 || $[8] !== t3) {
    t4 = <Box flexDirection="column">{t2}{t3}</Box>;
    $[7] = t2;
    $[8] = t3;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  return t4;
}
function SuggestedRules(t0) {
  const $ = _c(18);
  const {
    suggestions
  } = t0;
  let T0;
  let T1;
  let t1;
  let t2;
  let t3;
  let t4;
  let t5;
  if ($[0] !== suggestions) {
    t5 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const rules = extractRules(suggestions);
      if (rules.length === 0) {
        t5 = null;
        break bb0;
      }
      T1 = Text;
      if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
        t2 = <Text dimColor={true}>{"  "}⎿{"  "}</Text>;
        $[8] = t2;
      } else {
        t2 = $[8];
      }
      t3 = "Suggested rules:";
      t4 = " ";
      T0 = Ansi;
      t1 = rules.map(_temp).join(", ");
    }
    $[0] = suggestions;
    $[1] = T0;
    $[2] = T1;
    $[3] = t1;
    $[4] = t2;
    $[5] = t3;
    $[6] = t4;
    $[7] = t5;
  } else {
    T0 = $[1];
    T1 = $[2];
    t1 = $[3];
    t2 = $[4];
    t3 = $[5];
    t4 = $[6];
    t5 = $[7];
  }
  if (t5 !== Symbol.for("react.early_return_sentinel")) {
    return t5;
  }
  let t6;
  if ($[9] !== T0 || $[10] !== t1) {
    t6 = <T0>{t1}</T0>;
    $[9] = T0;
    $[10] = t1;
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  let t7;
  if ($[12] !== T1 || $[13] !== t2 || $[14] !== t3 || $[15] !== t4 || $[16] !== t6) {
    t7 = <T1>{t2}{t3}{t4}{t6}</T1>;
    $[12] = T1;
    $[13] = t2;
    $[14] = t3;
    $[15] = t4;
    $[16] = t6;
    $[17] = t7;
  } else {
    t7 = $[17];
  }
  return t7;
}
function _temp(rule) {
  return chalk.bold(permissionRuleValueToString(rule));
}
type Props = {
  permissionResult: PermissionDecision;
  toolName?: string; // Filter unreachable rules to this tool
};

// Helper function to extract directories from permission updates
function extractDirectories(updates: PermissionUpdate[] | undefined): string[] {
  if (!updates) return [];
  return updates.flatMap(update => {
    switch (update.type) {
      case 'addDirectories':
        return update.directories;
      default:
        return [];
    }
  });
}

// Helper function to extract mode from permission updates
function extractMode(updates: PermissionUpdate[] | undefined): PermissionMode | undefined {
  if (!updates) return undefined;
  const update = updates.findLast(u => u.type === 'setMode');
  return update?.type === 'setMode' ? update.mode : undefined;
}
function SuggestionDisplay(t0) {
  const $ = _c(22);
  const {
    suggestions,
    width
  } = t0;
  if (!suggestions || suggestions.length === 0) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Text dimColor={true}>Suggestions </Text>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    let t2;
    if ($[1] !== width) {
      t2 = <Box justifyContent="flex-end" minWidth={width}>{t1}</Box>;
      $[1] = width;
      $[2] = t2;
    } else {
      t2 = $[2];
    }
    let t3;
    if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = <Text>None</Text>;
      $[3] = t3;
    } else {
      t3 = $[3];
    }
    let t4;
    if ($[4] !== t2) {
      t4 = <Box flexDirection="row">{t2}{t3}</Box>;
      $[4] = t2;
      $[5] = t4;
    } else {
      t4 = $[5];
    }
    return t4;
  }
  let t1;
  let t2;
  if ($[6] !== suggestions || $[7] !== width) {
    t2 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const rules = extractRules(suggestions);
      const directories = extractDirectories(suggestions);
      const mode = extractMode(suggestions);
      if (rules.length === 0 && directories.length === 0 && !mode) {
        let t3;
        if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
          t3 = <Text dimColor={true}>Suggestion </Text>;
          $[10] = t3;
        } else {
          t3 = $[10];
        }
        let t4;
        if ($[11] !== width) {
          t4 = <Box justifyContent="flex-end" minWidth={width}>{t3}</Box>;
          $[11] = width;
          $[12] = t4;
        } else {
          t4 = $[12];
        }
        let t5;
        if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
          t5 = <Text>None</Text>;
          $[13] = t5;
        } else {
          t5 = $[13];
        }
        let t6;
        if ($[14] !== t4) {
          t6 = <Box flexDirection="row">{t4}{t5}</Box>;
          $[14] = t4;
          $[15] = t6;
        } else {
          t6 = $[15];
        }
        t2 = t6;
        break bb0;
      }
      let t3;
      if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
        t3 = <Text dimColor={true}>Suggestions </Text>;
        $[16] = t3;
      } else {
        t3 = $[16];
      }
      let t4;
      if ($[17] !== width) {
        t4 = <Box justifyContent="flex-end" minWidth={width}>{t3}</Box>;
        $[17] = width;
        $[18] = t4;
      } else {
        t4 = $[18];
      }
      let t5;
      if ($[19] === Symbol.for("react.memo_cache_sentinel")) {
        t5 = <Text> </Text>;
        $[19] = t5;
      } else {
        t5 = $[19];
      }
      let t6;
      if ($[20] !== t4) {
        t6 = <Box flexDirection="row">{t4}{t5}</Box>;
        $[20] = t4;
        $[21] = t6;
      } else {
        t6 = $[21];
      }
      t1 = <Box flexDirection="column">{t6}{rules.length > 0 && <Box flexDirection="row"><Box justifyContent="flex-end" minWidth={width}><Text dimColor={true}> Rules </Text></Box><Box flexDirection="column">{rules.map(_temp2)}</Box></Box>}{directories.length > 0 && <Box flexDirection="row"><Box justifyContent="flex-end" minWidth={width}><Text dimColor={true}> Directories </Text></Box><Box flexDirection="column">{directories.map(_temp3)}</Box></Box>}{mode && <Box flexDirection="row"><Box justifyContent="flex-end" minWidth={width}><Text dimColor={true}> Mode </Text></Box><Text>{permissionModeTitle(mode)}</Text></Box>}</Box>;
    }
    $[6] = suggestions;
    $[7] = width;
    $[8] = t1;
    $[9] = t2;
  } else {
    t1 = $[8];
    t2 = $[9];
  }
  if (t2 !== Symbol.for("react.early_return_sentinel")) {
    return t2;
  }
  return t1;
}
function _temp3(dir, index_0) {
  return <Text key={index_0}>{figures.bullet} {dir}</Text>;
}
function _temp2(rule, index) {
  return <Text key={index}>{figures.bullet} {permissionRuleValueToString(rule)}</Text>;
}
export function PermissionDecisionDebugInfo(t0) {
  const $ = _c(25);
  const {
    permissionResult,
    toolName
  } = t0;
  const toolPermissionContext = useAppState(_temp4);
  const decisionReason = permissionResult.decisionReason;
  const suggestions = "suggestions" in permissionResult ? permissionResult.suggestions : undefined;
  let t1;
  if ($[0] !== suggestions || $[1] !== toolName || $[2] !== toolPermissionContext) {
    bb0: {
      const sandboxAutoAllowEnabled = SandboxManager.isSandboxingEnabled() && SandboxManager.isAutoAllowBashIfSandboxedEnabled();
      const all = detectUnreachableRules(toolPermissionContext, {
        sandboxAutoAllowEnabled
      });
      const suggestedRules = extractRules(suggestions);
      if (suggestedRules.length > 0) {
        t1 = all.filter(u => suggestedRules.some(suggested => suggested.toolName === u.rule.ruleValue.toolName && suggested.ruleContent === u.rule.ruleValue.ruleContent));
        break bb0;
      }
      if (toolName) {
        let t2;
        if ($[4] !== toolName) {
          t2 = u_0 => u_0.rule.ruleValue.toolName === toolName;
          $[4] = toolName;
          $[5] = t2;
        } else {
          t2 = $[5];
        }
        t1 = all.filter(t2);
        break bb0;
      }
      t1 = all;
    }
    $[0] = suggestions;
    $[1] = toolName;
    $[2] = toolPermissionContext;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  const unreachableRules = t1;
  let t2;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box justifyContent="flex-end" minWidth={10}><Text dimColor={true}>Behavior </Text></Box>;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  let t3;
  if ($[7] !== permissionResult.behavior) {
    t3 = <Box flexDirection="row">{t2}<Text>{permissionResult.behavior}</Text></Box>;
    $[7] = permissionResult.behavior;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  let t4;
  if ($[9] !== permissionResult.behavior || $[10] !== permissionResult.message) {
    t4 = permissionResult.behavior !== "allow" && <Box flexDirection="row"><Box justifyContent="flex-end" minWidth={10}><Text dimColor={true}>Message </Text></Box><Text>{permissionResult.message}</Text></Box>;
    $[9] = permissionResult.behavior;
    $[10] = permissionResult.message;
    $[11] = t4;
  } else {
    t4 = $[11];
  }
  let t5;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Box justifyContent="flex-end" minWidth={10}><Text dimColor={true}>Reason </Text></Box>;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  let t6;
  if ($[13] !== decisionReason) {
    t6 = <Box flexDirection="row">{t5}{decisionReason === undefined ? <Text>undefined</Text> : <PermissionDecisionInfoItem decisionReason={decisionReason} />}</Box>;
    $[13] = decisionReason;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  let t7;
  if ($[15] !== suggestions) {
    t7 = <SuggestionDisplay suggestions={suggestions} width={10} />;
    $[15] = suggestions;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  let t8;
  if ($[17] !== unreachableRules) {
    t8 = unreachableRules.length > 0 && <Box flexDirection="column" marginTop={1}><Text color="warning">{figures.warning} Unreachable Rules ({unreachableRules.length})</Text>{unreachableRules.map(_temp5)}</Box>;
    $[17] = unreachableRules;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  let t9;
  if ($[19] !== t3 || $[20] !== t4 || $[21] !== t6 || $[22] !== t7 || $[23] !== t8) {
    t9 = <Box flexDirection="column">{t3}{t4}{t6}{t7}{t8}</Box>;
    $[19] = t3;
    $[20] = t4;
    $[21] = t6;
    $[22] = t7;
    $[23] = t8;
    $[24] = t9;
  } else {
    t9 = $[24];
  }
  return t9;
}
function _temp5(u_1, i) {
  return <Box key={i} flexDirection="column" marginLeft={2}><Text color="warning">{permissionRuleValueToString(u_1.rule.ruleValue)}</Text><Text dimColor={true}>{"  "}{u_1.reason}</Text><Text dimColor={true}>{"  "}Fix: {u_1.fix}</Text></Box>;
}
function _temp4(s) {
  return s.toolPermissionContext;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmZWF0dXJlIiwiY2hhbGsiLCJmaWd1cmVzIiwiUmVhY3QiLCJ1c2VNZW1vIiwiQW5zaSIsIkJveCIsImNvbG9yIiwiVGV4dCIsInVzZVRoZW1lIiwidXNlQXBwU3RhdGUiLCJQZXJtaXNzaW9uTW9kZSIsInBlcm1pc3Npb25Nb2RlVGl0bGUiLCJQZXJtaXNzaW9uRGVjaXNpb24iLCJQZXJtaXNzaW9uRGVjaXNpb25SZWFzb24iLCJleHRyYWN0UnVsZXMiLCJQZXJtaXNzaW9uVXBkYXRlIiwicGVybWlzc2lvblJ1bGVWYWx1ZVRvU3RyaW5nIiwiZGV0ZWN0VW5yZWFjaGFibGVSdWxlcyIsIlNhbmRib3hNYW5hZ2VyIiwiZ2V0U2V0dGluZ1NvdXJjZURpc3BsYXlOYW1lTG93ZXJjYXNlIiwiUGVybWlzc2lvbkRlY2lzaW9uSW5mb0l0ZW1Qcm9wcyIsInRpdGxlIiwiZGVjaXNpb25SZWFzb24iLCJkZWNpc2lvblJlYXNvbkRpc3BsYXlTdHJpbmciLCJ0eXBlIiwiRXhjbHVkZSIsImJvbGQiLCJjbGFzc2lmaWVyIiwicmVhc29uIiwicnVsZSIsInJ1bGVWYWx1ZSIsInNvdXJjZSIsIm1vZGUiLCJwZXJtaXNzaW9uUHJvbXB0VG9vbE5hbWUiLCJob29rTmFtZSIsIlBlcm1pc3Npb25EZWNpc2lvbkluZm9JdGVtIiwidDAiLCIkIiwiX2MiLCJ0aGVtZSIsInQxIiwiZm9ybWF0RGVjaXNpb25SZWFzb24iLCJBcnJheSIsImZyb20iLCJyZWFzb25zIiwiZW50cmllcyIsIm1hcCIsInQyIiwic3ViY29tbWFuZCIsInJlc3VsdCIsImljb24iLCJiZWhhdmlvciIsInRpY2siLCJjcm9zcyIsInVuZGVmaW5lZCIsInN1Z2dlc3Rpb25zIiwidDMiLCJ0NCIsIlN1Z2dlc3RlZFJ1bGVzIiwiVDAiLCJUMSIsInQ1IiwiU3ltYm9sIiwiZm9yIiwiYmIwIiwicnVsZXMiLCJsZW5ndGgiLCJfdGVtcCIsImpvaW4iLCJ0NiIsInQ3IiwiUHJvcHMiLCJwZXJtaXNzaW9uUmVzdWx0IiwidG9vbE5hbWUiLCJleHRyYWN0RGlyZWN0b3JpZXMiLCJ1cGRhdGVzIiwiZmxhdE1hcCIsInVwZGF0ZSIsImRpcmVjdG9yaWVzIiwiZXh0cmFjdE1vZGUiLCJmaW5kTGFzdCIsInUiLCJTdWdnZXN0aW9uRGlzcGxheSIsIndpZHRoIiwiX3RlbXAyIiwiX3RlbXAzIiwiZGlyIiwiaW5kZXhfMCIsImluZGV4IiwiYnVsbGV0IiwiUGVybWlzc2lvbkRlY2lzaW9uRGVidWdJbmZvIiwidG9vbFBlcm1pc3Npb25Db250ZXh0IiwiX3RlbXA0Iiwic2FuZGJveEF1dG9BbGxvd0VuYWJsZWQiLCJpc1NhbmRib3hpbmdFbmFibGVkIiwiaXNBdXRvQWxsb3dCYXNoSWZTYW5kYm94ZWRFbmFibGVkIiwiYWxsIiwic3VnZ2VzdGVkUnVsZXMiLCJmaWx0ZXIiLCJzb21lIiwic3VnZ2VzdGVkIiwicnVsZUNvbnRlbnQiLCJ1XzAiLCJ1bnJlYWNoYWJsZVJ1bGVzIiwiV0lEVEgiLCJtZXNzYWdlIiwidDgiLCJ3YXJuaW5nIiwiX3RlbXA1IiwidDkiLCJ1XzEiLCJpIiwiZml4IiwicyJdLCJzb3VyY2VzIjpbIlBlcm1pc3Npb25EZWNpc2lvbkRlYnVnSW5mby50c3giXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZmVhdHVyZSB9IGZyb20gJ2J1bjpidW5kbGUnXG5pbXBvcnQgY2hhbGsgZnJvbSAnY2hhbGsnXG5pbXBvcnQgZmlndXJlcyBmcm9tICdmaWd1cmVzJ1xuaW1wb3J0IFJlYWN0LCB7IHVzZU1lbW8gfSBmcm9tICdyZWFjdCdcbmltcG9ydCB7IEFuc2ksIEJveCwgY29sb3IsIFRleHQsIHVzZVRoZW1lIH0gZnJvbSAnLi4vLi4vaW5rLmpzJ1xuaW1wb3J0IHsgdXNlQXBwU3RhdGUgfSBmcm9tICcuLi8uLi9zdGF0ZS9BcHBTdGF0ZS5qcydcbmltcG9ydCB0eXBlIHsgUGVybWlzc2lvbk1vZGUgfSBmcm9tICcuLi8uLi91dGlscy9wZXJtaXNzaW9ucy9QZXJtaXNzaW9uTW9kZS5qcydcbmltcG9ydCB7IHBlcm1pc3Npb25Nb2RlVGl0bGUgfSBmcm9tICcuLi8uLi91dGlscy9wZXJtaXNzaW9ucy9QZXJtaXNzaW9uTW9kZS5qcydcbmltcG9ydCB0eXBlIHtcbiAgUGVybWlzc2lvbkRlY2lzaW9uLFxuICBQZXJtaXNzaW9uRGVjaXNpb25SZWFzb24sXG4gIFBlcm1pc3Npb25SZXN1bHQsXG59IGZyb20gJy4uLy4uL3V0aWxzL3Blcm1pc3Npb25zL1Blcm1pc3Npb25SZXN1bHQuanMnXG5pbXBvcnQgeyBleHRyYWN0UnVsZXMgfSBmcm9tICcuLi8uLi91dGlscy9wZXJtaXNzaW9ucy9QZXJtaXNzaW9uVXBkYXRlLmpzJ1xuaW1wb3J0IHR5cGUgeyBQZXJtaXNzaW9uVXBkYXRlIH0gZnJvbSAnLi4vLi4vdXRpbHMvcGVybWlzc2lvbnMvUGVybWlzc2lvblVwZGF0ZVNjaGVtYS5qcydcbmltcG9ydCB7IHBlcm1pc3Npb25SdWxlVmFsdWVUb1N0cmluZyB9IGZyb20gJy4uLy4uL3V0aWxzL3Blcm1pc3Npb25zL3Blcm1pc3Npb25SdWxlUGFyc2VyLmpzJ1xuaW1wb3J0IHsgZGV0ZWN0VW5yZWFjaGFibGVSdWxlcyB9IGZyb20gJy4uLy4uL3V0aWxzL3Blcm1pc3Npb25zL3NoYWRvd2VkUnVsZURldGVjdGlvbi5qcydcbmltcG9ydCB7IFNhbmRib3hNYW5hZ2VyIH0gZnJvbSAnLi4vLi4vdXRpbHMvc2FuZGJveC9zYW5kYm94LWFkYXB0ZXIuanMnXG5pbXBvcnQgeyBnZXRTZXR0aW5nU291cmNlRGlzcGxheU5hbWVMb3dlcmNhc2UgfSBmcm9tICcuLi8uLi91dGlscy9zZXR0aW5ncy9jb25zdGFudHMuanMnXG5cbnR5cGUgUGVybWlzc2lvbkRlY2lzaW9uSW5mb0l0ZW1Qcm9wcyA9IHtcbiAgdGl0bGU/OiBzdHJpbmdcbiAgZGVjaXNpb25SZWFzb246IFBlcm1pc3Npb25EZWNpc2lvblJlYXNvblxufVxuXG5mdW5jdGlvbiBkZWNpc2lvblJlYXNvbkRpc3BsYXlTdHJpbmcoXG4gIGRlY2lzaW9uUmVhc29uOiBQZXJtaXNzaW9uRGVjaXNpb25SZWFzb24gJiB7XG4gICAgdHlwZTogRXhjbHVkZTxQZXJtaXNzaW9uRGVjaXNpb25SZWFzb25bJ3R5cGUnXSwgJ3N1YmNvbW1hbmRSZXN1bHRzJz5cbiAgfSxcbik6IHN0cmluZyB7XG4gIGlmIChcbiAgICAoZmVhdHVyZSgnQkFTSF9DTEFTU0lGSUVSJykgfHwgZmVhdHVyZSgnVFJBTlNDUklQVF9DTEFTU0lGSUVSJykpICYmXG4gICAgZGVjaXNpb25SZWFzb24udHlwZSA9PT0gJ2NsYXNzaWZpZXInXG4gICkge1xuICAgIHJldHVybiBgJHtjaGFsay5ib2xkKGRlY2lzaW9uUmVhc29uLmNsYXNzaWZpZXIpfSBjbGFzc2lmaWVyOiAke2RlY2lzaW9uUmVhc29uLnJlYXNvbn1gXG4gIH1cbiAgc3dpdGNoIChkZWNpc2lvblJlYXNvbi50eXBlKSB7XG4gICAgY2FzZSAncnVsZSc6XG4gICAgICByZXR1cm4gYCR7Y2hhbGsuYm9sZChwZXJtaXNzaW9uUnVsZVZhbHVlVG9TdHJpbmcoZGVjaXNpb25SZWFzb24ucnVsZS5ydWxlVmFsdWUpKX0gcnVsZSBmcm9tICR7Z2V0U2V0dGluZ1NvdXJjZURpc3BsYXlOYW1lTG93ZXJjYXNlKGRlY2lzaW9uUmVhc29uLnJ1bGUuc291cmNlKX1gXG4gICAgY2FzZSAnbW9kZSc6XG4gICAgICByZXR1cm4gYCR7cGVybWlzc2lvbk1vZGVUaXRsZShkZWNpc2lvblJlYXNvbi5tb2RlKX0gbW9kZWBcbiAgICBjYXNlICdzYW5kYm94T3ZlcnJpZGUnOlxuICAgICAgcmV0dXJuICdSZXF1aXJlcyBwZXJtaXNzaW9uIHRvIGJ5cGFzcyBzYW5kYm94J1xuICAgIGNhc2UgJ3dvcmtpbmdEaXInOlxuICAgICAgcmV0dXJuIGRlY2lzaW9uUmVhc29uLnJlYXNvblxuICAgIGNhc2UgJ3NhZmV0eUNoZWNrJzpcbiAgICBjYXNlICdvdGhlcic6XG4gICAgICByZXR1cm4gZGVjaXNpb25SZWFzb24ucmVhc29uXG4gICAgY2FzZSAncGVybWlzc2lvblByb21wdFRvb2wnOlxuICAgICAgcmV0dXJuIGAke2NoYWxrLmJvbGQoZGVjaXNpb25SZWFzb24ucGVybWlzc2lvblByb21wdFRvb2xOYW1lKX0gcGVybWlzc2lvbiBwcm9tcHQgdG9vbGBcbiAgICBjYXNlICdob29rJzpcbiAgICAgIHJldHVybiBkZWNpc2lvblJlYXNvbi5yZWFzb25cbiAgICAgICAgPyBgJHtjaGFsay5ib2xkKGRlY2lzaW9uUmVhc29uLmhvb2tOYW1lKX0gaG9vazogJHtkZWNpc2lvblJlYXNvbi5yZWFzb259YFxuICAgICAgICA6IGAke2NoYWxrLmJvbGQoZGVjaXNpb25SZWFzb24uaG9va05hbWUpfSBob29rYFxuICAgIGNhc2UgJ2FzeW5jQWdlbnQnOlxuICAgICAgcmV0dXJuIGRlY2lzaW9uUmVhc29uLnJlYXNvblxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gJydcbiAgfVxufVxuXG5mdW5jdGlvbiBQZXJtaXNzaW9uRGVjaXNpb25JbmZvSXRlbSh7XG4gIHRpdGxlLFxuICBkZWNpc2lvblJlYXNvbixcbn06IFBlcm1pc3Npb25EZWNpc2lvbkluZm9JdGVtUHJvcHMpOiBSZWFjdC5SZWFjdE5vZGUge1xuICBjb25zdCBbdGhlbWVdID0gdXNlVGhlbWUoKVxuXG4gIGZ1bmN0aW9uIGZvcm1hdERlY2lzaW9uUmVhc29uKCk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gICAgc3dpdGNoIChkZWNpc2lvblJlYXNvbi50eXBlKSB7XG4gICAgICBjYXNlICdzdWJjb21tYW5kUmVzdWx0cyc6XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgPEJveCBmbGV4RGlyZWN0aW9uPVwiY29sdW1uXCI+XG4gICAgICAgICAgICB7QXJyYXkuZnJvbShkZWNpc2lvblJlYXNvbi5yZWFzb25zLmVudHJpZXMoKSkubWFwKFxuICAgICAgICAgICAgICAoW3N1YmNvbW1hbmQsIHJlc3VsdF06IFtzdHJpbmcsIFBlcm1pc3Npb25SZXN1bHRdKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWNvbiA9XG4gICAgICAgICAgICAgICAgICByZXN1bHQuYmVoYXZpb3IgPT09ICdhbGxvdydcbiAgICAgICAgICAgICAgICAgICAgPyBjb2xvcignc3VjY2VzcycsIHRoZW1lKShmaWd1cmVzLnRpY2spXG4gICAgICAgICAgICAgICAgICAgIDogY29sb3IoJ2Vycm9yJywgdGhlbWUpKGZpZ3VyZXMuY3Jvc3MpXG4gICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgIDxCb3ggZmxleERpcmVjdGlvbj1cImNvbHVtblwiIGtleT17c3ViY29tbWFuZH0+XG4gICAgICAgICAgICAgICAgICAgIDxUZXh0PlxuICAgICAgICAgICAgICAgICAgICAgIHtpY29ufSB7c3ViY29tbWFuZH1cbiAgICAgICAgICAgICAgICAgICAgPC9UZXh0PlxuICAgICAgICAgICAgICAgICAgICB7cmVzdWx0LmRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgJiZcbiAgICAgICAgICAgICAgICAgICAgICByZXN1bHQuZGVjaXNpb25SZWFzb24udHlwZSAhPT0gJ3N1YmNvbW1hbmRSZXN1bHRzJyAmJiAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8VGV4dD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgPFRleHQgZGltQ29sb3I+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgeycgICd94o6/eycgICd9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIDwvVGV4dD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgPEFuc2k+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge2RlY2lzaW9uUmVhc29uRGlzcGxheVN0cmluZyhyZXN1bHQuZGVjaXNpb25SZWFzb24pfVxuICAgICAgICAgICAgICAgICAgICAgICAgICA8L0Fuc2k+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L1RleHQ+XG4gICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAge3Jlc3VsdC5iZWhhdmlvciA9PT0gJ2FzaycgJiYgKFxuICAgICAgICAgICAgICAgICAgICAgIDxTdWdnZXN0ZWRSdWxlcyBzdWdnZXN0aW9ucz17cmVzdWx0LnN1Z2dlc3Rpb25zfSAvPlxuICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgPC9Cb3g+XG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgKX1cbiAgICAgICAgICA8L0JveD5cbiAgICAgICAgKVxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICA8VGV4dD5cbiAgICAgICAgICAgIDxBbnNpPntkZWNpc2lvblJlYXNvbkRpc3BsYXlTdHJpbmcoZGVjaXNpb25SZWFzb24pfTwvQW5zaT5cbiAgICAgICAgICA8L1RleHQ+XG4gICAgICAgIClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gKFxuICAgIDxCb3ggZmxleERpcmVjdGlvbj1cImNvbHVtblwiPlxuICAgICAge3RpdGxlICYmIDxUZXh0Pnt0aXRsZX08L1RleHQ+fVxuICAgICAge2Zvcm1hdERlY2lzaW9uUmVhc29uKCl9XG4gICAgPC9Cb3g+XG4gIClcbn1cblxuZnVuY3Rpb24gU3VnZ2VzdGVkUnVsZXMoe1xuICBzdWdnZXN0aW9ucyxcbn06IHtcbiAgc3VnZ2VzdGlvbnM6IFBlcm1pc3Npb25VcGRhdGVbXSB8IHVuZGVmaW5lZFxufSk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gIGNvbnN0IHJ1bGVzID0gZXh0cmFjdFJ1bGVzKHN1Z2dlc3Rpb25zKVxuICBpZiAocnVsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuICByZXR1cm4gKFxuICAgIDxUZXh0PlxuICAgICAgPFRleHQgZGltQ29sb3I+XG4gICAgICAgIHsnICAnfeKOv3snICAnfVxuICAgICAgPC9UZXh0PlxuICAgICAgU3VnZ2VzdGVkIHJ1bGVzOnsnICd9XG4gICAgICA8QW5zaT5cbiAgICAgICAge3J1bGVzXG4gICAgICAgICAgLm1hcChydWxlID0+IGNoYWxrLmJvbGQocGVybWlzc2lvblJ1bGVWYWx1ZVRvU3RyaW5nKHJ1bGUpKSlcbiAgICAgICAgICAuam9pbignLCAnKX1cbiAgICAgIDwvQW5zaT5cbiAgICA8L1RleHQ+XG4gIClcbn1cblxudHlwZSBQcm9wcyA9IHtcbiAgcGVybWlzc2lvblJlc3VsdDogUGVybWlzc2lvbkRlY2lzaW9uXG4gIHRvb2xOYW1lPzogc3RyaW5nIC8vIEZpbHRlciB1bnJlYWNoYWJsZSBydWxlcyB0byB0aGlzIHRvb2xcbn1cblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGV4dHJhY3QgZGlyZWN0b3JpZXMgZnJvbSBwZXJtaXNzaW9uIHVwZGF0ZXNcbmZ1bmN0aW9uIGV4dHJhY3REaXJlY3Rvcmllcyh1cGRhdGVzOiBQZXJtaXNzaW9uVXBkYXRlW10gfCB1bmRlZmluZWQpOiBzdHJpbmdbXSB7XG4gIGlmICghdXBkYXRlcykgcmV0dXJuIFtdXG5cbiAgcmV0dXJuIHVwZGF0ZXMuZmxhdE1hcCh1cGRhdGUgPT4ge1xuICAgIHN3aXRjaCAodXBkYXRlLnR5cGUpIHtcbiAgICAgIGNhc2UgJ2FkZERpcmVjdG9yaWVzJzpcbiAgICAgICAgcmV0dXJuIHVwZGF0ZS5kaXJlY3Rvcmllc1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcmV0dXJuIFtdXG4gICAgfVxuICB9KVxufVxuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gZXh0cmFjdCBtb2RlIGZyb20gcGVybWlzc2lvbiB1cGRhdGVzXG5mdW5jdGlvbiBleHRyYWN0TW9kZShcbiAgdXBkYXRlczogUGVybWlzc2lvblVwZGF0ZVtdIHwgdW5kZWZpbmVkLFxuKTogUGVybWlzc2lvbk1vZGUgfCB1bmRlZmluZWQge1xuICBpZiAoIXVwZGF0ZXMpIHJldHVybiB1bmRlZmluZWRcbiAgY29uc3QgdXBkYXRlID0gdXBkYXRlcy5maW5kTGFzdCh1ID0+IHUudHlwZSA9PT0gJ3NldE1vZGUnKVxuICByZXR1cm4gdXBkYXRlPy50eXBlID09PSAnc2V0TW9kZScgPyB1cGRhdGUubW9kZSA6IHVuZGVmaW5lZFxufVxuXG5mdW5jdGlvbiBTdWdnZXN0aW9uRGlzcGxheSh7XG4gIHN1Z2dlc3Rpb25zLFxuICB3aWR0aCxcbn06IHtcbiAgc3VnZ2VzdGlvbnM6IFBlcm1pc3Npb25VcGRhdGVbXSB8IHVuZGVmaW5lZFxuICB3aWR0aDogbnVtYmVyXG59KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgaWYgKCFzdWdnZXN0aW9ucyB8fCBzdWdnZXN0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gKFxuICAgICAgPEJveCBmbGV4RGlyZWN0aW9uPVwicm93XCI+XG4gICAgICAgIDxCb3gganVzdGlmeUNvbnRlbnQ9XCJmbGV4LWVuZFwiIG1pbldpZHRoPXt3aWR0aH0+XG4gICAgICAgICAgPFRleHQgZGltQ29sb3I+U3VnZ2VzdGlvbnMgPC9UZXh0PlxuICAgICAgICA8L0JveD5cbiAgICAgICAgPFRleHQ+Tm9uZTwvVGV4dD5cbiAgICAgIDwvQm94PlxuICAgIClcbiAgfVxuXG4gIGNvbnN0IHJ1bGVzID0gZXh0cmFjdFJ1bGVzKHN1Z2dlc3Rpb25zKVxuICBjb25zdCBkaXJlY3RvcmllcyA9IGV4dHJhY3REaXJlY3RvcmllcyhzdWdnZXN0aW9ucylcbiAgY29uc3QgbW9kZSA9IGV4dHJhY3RNb2RlKHN1Z2dlc3Rpb25zKVxuXG4gIC8vIElmIG5vdGhpbmcgdG8gZGlzcGxheSwgc2hvdyBOb25lXG4gIGlmIChydWxlcy5sZW5ndGggPT09IDAgJiYgZGlyZWN0b3JpZXMubGVuZ3RoID09PSAwICYmICFtb2RlKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIDxCb3ggZmxleERpcmVjdGlvbj1cInJvd1wiPlxuICAgICAgICA8Qm94IGp1c3RpZnlDb250ZW50PVwiZmxleC1lbmRcIiBtaW5XaWR0aD17d2lkdGh9PlxuICAgICAgICAgIDxUZXh0IGRpbUNvbG9yPlN1Z2dlc3Rpb24gPC9UZXh0PlxuICAgICAgICA8L0JveD5cbiAgICAgICAgPFRleHQ+Tm9uZTwvVGV4dD5cbiAgICAgIDwvQm94PlxuICAgIClcbiAgfVxuXG4gIHJldHVybiAoXG4gICAgPEJveCBmbGV4RGlyZWN0aW9uPVwiY29sdW1uXCI+XG4gICAgICA8Qm94IGZsZXhEaXJlY3Rpb249XCJyb3dcIj5cbiAgICAgICAgPEJveCBqdXN0aWZ5Q29udGVudD1cImZsZXgtZW5kXCIgbWluV2lkdGg9e3dpZHRofT5cbiAgICAgICAgICA8VGV4dCBkaW1Db2xvcj5TdWdnZXN0aW9ucyA8L1RleHQ+XG4gICAgICAgIDwvQm94PlxuICAgICAgICA8VGV4dD4gPC9UZXh0PlxuICAgICAgPC9Cb3g+XG5cbiAgICAgIHsvKiBEaXNwbGF5IHJ1bGVzICovfVxuICAgICAge3J1bGVzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICA8Qm94IGZsZXhEaXJlY3Rpb249XCJyb3dcIj5cbiAgICAgICAgICA8Qm94IGp1c3RpZnlDb250ZW50PVwiZmxleC1lbmRcIiBtaW5XaWR0aD17d2lkdGh9PlxuICAgICAgICAgICAgPFRleHQgZGltQ29sb3I+IFJ1bGVzIDwvVGV4dD5cbiAgICAgICAgICA8L0JveD5cbiAgICAgICAgICA8Qm94IGZsZXhEaXJlY3Rpb249XCJjb2x1bW5cIj5cbiAgICAgICAgICAgIHtydWxlcy5tYXAoKHJ1bGUsIGluZGV4KSA9PiAoXG4gICAgICAgICAgICAgIDxUZXh0IGtleT17aW5kZXh9PlxuICAgICAgICAgICAgICAgIHtmaWd1cmVzLmJ1bGxldH0ge3Blcm1pc3Npb25SdWxlVmFsdWVUb1N0cmluZyhydWxlKX1cbiAgICAgICAgICAgICAgPC9UZXh0PlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAgPC9Cb3g+XG4gICAgICAgIDwvQm94PlxuICAgICAgKX1cblxuICAgICAgey8qIERpc3BsYXkgZGlyZWN0b3JpZXMgKi99XG4gICAgICB7ZGlyZWN0b3JpZXMubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgIDxCb3ggZmxleERpcmVjdGlvbj1cInJvd1wiPlxuICAgICAgICAgIDxCb3gganVzdGlmeUNvbnRlbnQ9XCJmbGV4LWVuZFwiIG1pbldpZHRoPXt3aWR0aH0+XG4gICAgICAgICAgICA8VGV4dCBkaW1Db2xvcj4gRGlyZWN0b3JpZXMgPC9UZXh0PlxuICAgICAgICAgIDwvQm94PlxuICAgICAgICAgIDxCb3ggZmxleERpcmVjdGlvbj1cImNvbHVtblwiPlxuICAgICAgICAgICAge2RpcmVjdG9yaWVzLm1hcCgoZGlyLCBpbmRleCkgPT4gKFxuICAgICAgICAgICAgICA8VGV4dCBrZXk9e2luZGV4fT5cbiAgICAgICAgICAgICAgICB7ZmlndXJlcy5idWxsZXR9IHtkaXJ9XG4gICAgICAgICAgICAgIDwvVGV4dD5cbiAgICAgICAgICAgICkpfVxuICAgICAgICAgIDwvQm94PlxuICAgICAgICA8L0JveD5cbiAgICAgICl9XG5cbiAgICAgIHsvKiBEaXNwbGF5IG1vZGUgY2hhbmdlICovfVxuICAgICAge21vZGUgJiYgKFxuICAgICAgICA8Qm94IGZsZXhEaXJlY3Rpb249XCJyb3dcIj5cbiAgICAgICAgICA8Qm94IGp1c3RpZnlDb250ZW50PVwiZmxleC1lbmRcIiBtaW5XaWR0aD17d2lkdGh9PlxuICAgICAgICAgICAgPFRleHQgZGltQ29sb3I+IE1vZGUgPC9UZXh0PlxuICAgICAgICAgIDwvQm94PlxuICAgICAgICAgIDxUZXh0PntwZXJtaXNzaW9uTW9kZVRpdGxlKG1vZGUpfTwvVGV4dD5cbiAgICAgICAgPC9Cb3g+XG4gICAgICApfVxuICAgIDwvQm94PlxuICApXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBQZXJtaXNzaW9uRGVjaXNpb25EZWJ1Z0luZm8oe1xuICBwZXJtaXNzaW9uUmVzdWx0LFxuICB0b29sTmFtZSxcbn06IFByb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgY29uc3QgdG9vbFBlcm1pc3Npb25Db250ZXh0ID0gdXNlQXBwU3RhdGUocyA9PiBzLnRvb2xQZXJtaXNzaW9uQ29udGV4dClcbiAgY29uc3QgZGVjaXNpb25SZWFzb24gPSBwZXJtaXNzaW9uUmVzdWx0LmRlY2lzaW9uUmVhc29uXG4gIGNvbnN0IHN1Z2dlc3Rpb25zID1cbiAgICAnc3VnZ2VzdGlvbnMnIGluIHBlcm1pc3Npb25SZXN1bHQgPyBwZXJtaXNzaW9uUmVzdWx0LnN1Z2dlc3Rpb25zIDogdW5kZWZpbmVkXG5cbiAgY29uc3QgdW5yZWFjaGFibGVSdWxlcyA9IHVzZU1lbW8oKCkgPT4ge1xuICAgIGNvbnN0IHNhbmRib3hBdXRvQWxsb3dFbmFibGVkID1cbiAgICAgIFNhbmRib3hNYW5hZ2VyLmlzU2FuZGJveGluZ0VuYWJsZWQoKSAmJlxuICAgICAgU2FuZGJveE1hbmFnZXIuaXNBdXRvQWxsb3dCYXNoSWZTYW5kYm94ZWRFbmFibGVkKClcbiAgICBjb25zdCBhbGwgPSBkZXRlY3RVbnJlYWNoYWJsZVJ1bGVzKHRvb2xQZXJtaXNzaW9uQ29udGV4dCwge1xuICAgICAgc2FuZGJveEF1dG9BbGxvd0VuYWJsZWQsXG4gICAgfSlcblxuICAgIC8vIEdldCB0aGUgc3VnZ2VzdGVkIHJ1bGVzIGZyb20gdGhlIHBlcm1pc3Npb24gcmVzdWx0XG4gICAgY29uc3Qgc3VnZ2VzdGVkUnVsZXMgPSBleHRyYWN0UnVsZXMoc3VnZ2VzdGlvbnMpXG5cbiAgICAvLyBGaWx0ZXIgdG8gcnVsZXMgdGhhdCBtYXRjaCBhbnkgb2YgdGhlIHN1Z2dlc3RlZCBydWxlc1xuICAgIC8vIEEgcnVsZSBtYXRjaGVzIGlmIGl0IGhhcyB0aGUgc2FtZSB0b29sTmFtZSBhbmQgcnVsZUNvbnRlbnRcbiAgICBpZiAoc3VnZ2VzdGVkUnVsZXMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGFsbC5maWx0ZXIodSA9PlxuICAgICAgICBzdWdnZXN0ZWRSdWxlcy5zb21lKFxuICAgICAgICAgIHN1Z2dlc3RlZCA9PlxuICAgICAgICAgICAgc3VnZ2VzdGVkLnRvb2xOYW1lID09PSB1LnJ1bGUucnVsZVZhbHVlLnRvb2xOYW1lICYmXG4gICAgICAgICAgICBzdWdnZXN0ZWQucnVsZUNvbnRlbnQgPT09IHUucnVsZS5ydWxlVmFsdWUucnVsZUNvbnRlbnQsXG4gICAgICAgICksXG4gICAgICApXG4gICAgfVxuXG4gICAgLy8gRmFsbGJhY2s6IGZpbHRlciBieSB0b29sIG5hbWUgaWYgc3BlY2lmaWVkXG4gICAgaWYgKHRvb2xOYW1lKSB7XG4gICAgICByZXR1cm4gYWxsLmZpbHRlcih1ID0+IHUucnVsZS5ydWxlVmFsdWUudG9vbE5hbWUgPT09IHRvb2xOYW1lKVxuICAgIH1cblxuICAgIHJldHVybiBhbGxcbiAgfSwgW3Rvb2xQZXJtaXNzaW9uQ29udGV4dCwgdG9vbE5hbWUsIHN1Z2dlc3Rpb25zXSlcblxuICBjb25zdCBXSURUSCA9IDEwXG5cbiAgcmV0dXJuIChcbiAgICA8Qm94IGZsZXhEaXJlY3Rpb249XCJjb2x1bW5cIj5cbiAgICAgIDxCb3ggZmxleERpcmVjdGlvbj1cInJvd1wiPlxuICAgICAgICA8Qm94IGp1c3RpZnlDb250ZW50PVwiZmxleC1lbmRcIiBtaW5XaWR0aD17V0lEVEh9PlxuICAgICAgICAgIDxUZXh0IGRpbUNvbG9yPkJlaGF2aW9yIDwvVGV4dD5cbiAgICAgICAgPC9Cb3g+XG4gICAgICAgIDxUZXh0PntwZXJtaXNzaW9uUmVzdWx0LmJlaGF2aW9yfTwvVGV4dD5cbiAgICAgIDwvQm94PlxuICAgICAge3Blcm1pc3Npb25SZXN1bHQuYmVoYXZpb3IgIT09ICdhbGxvdycgJiYgKFxuICAgICAgICA8Qm94IGZsZXhEaXJlY3Rpb249XCJyb3dcIj5cbiAgICAgICAgICA8Qm94IGp1c3RpZnlDb250ZW50PVwiZmxleC1lbmRcIiBtaW5XaWR0aD17V0lEVEh9PlxuICAgICAgICAgICAgPFRleHQgZGltQ29sb3I+TWVzc2FnZSA8L1RleHQ+XG4gICAgICAgICAgPC9Cb3g+XG4gICAgICAgICAgPFRleHQ+e3Blcm1pc3Npb25SZXN1bHQubWVzc2FnZX08L1RleHQ+XG4gICAgICAgIDwvQm94PlxuICAgICAgKX1cbiAgICAgIDxCb3ggZmxleERpcmVjdGlvbj1cInJvd1wiPlxuICAgICAgICA8Qm94IGp1c3RpZnlDb250ZW50PVwiZmxleC1lbmRcIiBtaW5XaWR0aD17V0lEVEh9PlxuICAgICAgICAgIDxUZXh0IGRpbUNvbG9yPlJlYXNvbiA8L1RleHQ+XG4gICAgICAgIDwvQm94PlxuICAgICAgICB7ZGVjaXNpb25SZWFzb24gPT09IHVuZGVmaW5lZCA/IChcbiAgICAgICAgICA8VGV4dD51bmRlZmluZWQ8L1RleHQ+XG4gICAgICAgICkgOiAoXG4gICAgICAgICAgPFBlcm1pc3Npb25EZWNpc2lvbkluZm9JdGVtIGRlY2lzaW9uUmVhc29uPXtkZWNpc2lvblJlYXNvbn0gLz5cbiAgICAgICAgKX1cbiAgICAgIDwvQm94PlxuICAgICAgPFN1Z2dlc3Rpb25EaXNwbGF5IHN1Z2dlc3Rpb25zPXtzdWdnZXN0aW9uc30gd2lkdGg9e1dJRFRIfSAvPlxuICAgICAge3VucmVhY2hhYmxlUnVsZXMubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgIDxCb3ggZmxleERpcmVjdGlvbj1cImNvbHVtblwiIG1hcmdpblRvcD17MX0+XG4gICAgICAgICAgPFRleHQgY29sb3I9XCJ3YXJuaW5nXCI+XG4gICAgICAgICAgICB7ZmlndXJlcy53YXJuaW5nfSBVbnJlYWNoYWJsZSBSdWxlcyAoe3VucmVhY2hhYmxlUnVsZXMubGVuZ3RofSlcbiAgICAgICAgICA8L1RleHQ+XG4gICAgICAgICAge3VucmVhY2hhYmxlUnVsZXMubWFwKCh1LCBpKSA9PiAoXG4gICAgICAgICAgICA8Qm94IGtleT17aX0gZmxleERpcmVjdGlvbj1cImNvbHVtblwiIG1hcmdpbkxlZnQ9ezJ9PlxuICAgICAgICAgICAgICA8VGV4dCBjb2xvcj1cIndhcm5pbmdcIj5cbiAgICAgICAgICAgICAgICB7cGVybWlzc2lvblJ1bGVWYWx1ZVRvU3RyaW5nKHUucnVsZS5ydWxlVmFsdWUpfVxuICAgICAgICAgICAgICA8L1RleHQ+XG4gICAgICAgICAgICAgIDxUZXh0IGRpbUNvbG9yPlxuICAgICAgICAgICAgICAgIHsnICAnfVxuICAgICAgICAgICAgICAgIHt1LnJlYXNvbn1cbiAgICAgICAgICAgICAgPC9UZXh0PlxuICAgICAgICAgICAgICA8VGV4dCBkaW1Db2xvcj5cbiAgICAgICAgICAgICAgICB7JyAgJ31GaXg6IHt1LmZpeH1cbiAgICAgICAgICAgICAgPC9UZXh0PlxuICAgICAgICAgICAgPC9Cb3g+XG4gICAgICAgICAgKSl9XG4gICAgICAgIDwvQm94PlxuICAgICAgKX1cbiAgICA8L0JveD5cbiAgKVxufVxuIl0sIm1hcHBpbmdzIjoiO0FBQUEsU0FBU0EsT0FBTyxRQUFRLFlBQVk7QUFDcEMsT0FBT0MsS0FBSyxNQUFNLE9BQU87QUFDekIsT0FBT0MsT0FBTyxNQUFNLFNBQVM7QUFDN0IsT0FBT0MsS0FBSyxJQUFJQyxPQUFPLFFBQVEsT0FBTztBQUN0QyxTQUFTQyxJQUFJLEVBQUVDLEdBQUcsRUFBRUMsS0FBSyxFQUFFQyxJQUFJLEVBQUVDLFFBQVEsUUFBUSxjQUFjO0FBQy9ELFNBQVNDLFdBQVcsUUFBUSx5QkFBeUI7QUFDckQsY0FBY0MsY0FBYyxRQUFRLDJDQUEyQztBQUMvRSxTQUFTQyxtQkFBbUIsUUFBUSwyQ0FBMkM7QUFDL0UsY0FDRUMsa0JBQWtCLEVBQ2xCQyx3QkFBd0IsUUFDbkIsNkNBQTZDO0FBQ3BELFNBQVNDLFlBQVksUUFBUSw2Q0FBNkM7QUFDMUUsY0FBY0MsZ0JBQWdCLFFBQVEsbURBQW1EO0FBQ3pGLFNBQVNDLDJCQUEyQixRQUFRLGlEQUFpRDtBQUM3RixTQUFTQyxzQkFBc0IsUUFBUSxrREFBa0Q7QUFDekYsU0FBU0MsY0FBYyxRQUFRLHdDQUF3QztBQUN2RSxTQUFTQyxvQ0FBb0MsUUFBUSxtQ0FBbUM7QUFFeEYsS0FBS0MsK0JBQStCLEdBQUc7RUFDckNDLEtBQUssQ0FBQyxFQUFFLE1BQU07RUFDZEMsY0FBYyxFQUFFVCx3QkFBd0I7QUFDMUMsQ0FBQztBQUVELFNBQVNVLDJCQUEyQkEsQ0FDbENELGNBQWMsRUFBRVQsd0JBQXdCLEdBQUc7RUFDekNXLElBQUksRUFBRUMsT0FBTyxDQUFDWix3QkFBd0IsQ0FBQyxNQUFNLENBQUMsRUFB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
