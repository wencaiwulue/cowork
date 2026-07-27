import { c as _c } from "react/compiler-runtime";
import { marked, type Token, type Tokens } from 'marked';
import React, { Suspense, use, useMemo, useRef } from 'react';
import { useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, useTheme } from '../ink.js';
import { type CliHighlight, getCliHighlightPromise } from '../utils/cliHighlight.js';
import { hashContent } from '../utils/hash.js';
import { configureMarked, formatToken } from '../utils/markdown.js';
import { stripPromptXMLTags } from '../utils/messages.js';
import { MarkdownTable } from './MarkdownTable.js';
type Props = {
  children: string;
  /** When true, render all text content as dim */
  dimColor?: boolean;
};

// Module-level token cache — marked.lexer is the hot cost on virtual-scroll
// remounts (~3ms per message). useMemo doesn't survive unmount→remount, so
// scrolling back to a previously-visible message re-parses. Messages are
// immutable in history; same content → same tokens. Keyed by hash to avoid
// retaining full content strings (turn50→turn99 RSS regression, #24180).
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, Token[]>();

// Characters that indicate markdown syntax. If none are present, skip the
// ~3ms marked.lexer call entirely — render as a single paragraph. Covers
// the majority of short assistant responses and user prompts that are
// plain sentences. Checked via indexOf (not regex) for speed.
// Single regex: matches any MD marker or ordered-list start (N. at line start).
// One pass instead of 10× includes scans.
const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /;
function hasMarkdownSyntax(s: string): boolean {
  // Sample first 500 chars — if markdown exists it's usually early (headers,
  // code fence, list). Long tool outputs are mostly plain text tails.
  return MD_SYNTAX_RE.test(s.length > 500 ? s.slice(0, 500) : s);
}
function cachedLexer(content: string): Token[] {
  // Fast path: plain text with no markdown syntax → single paragraph token.
  // Skips marked.lexer's full GFM parse (~3ms on long content). Not cached —
  // reconstruction is a single object allocation, and caching would retain
  // 4× content in raw/text fields plus the hash key for zero benefit.
  if (!hasMarkdownSyntax(content)) {
    return [{
      type: 'paragraph',
      raw: content,
      text: content,
      tokens: [{
        type: 'text',
        raw: content,
        text: content
      }]
    } as Token];
  }
  const key = hashContent(content);
  const hit = tokenCache.get(key);
  if (hit) {
    // Promote to MRU — without this the eviction is FIFO (scrolling back to
    // an early message evicts the very item you're looking at).
    tokenCache.delete(key);
    tokenCache.set(key, hit);
    return hit;
  }
  const tokens = marked.lexer(content);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    // LRU-ish: drop oldest. Map preserves insertion order.
    const first = tokenCache.keys().next().value;
    if (first !== undefined) tokenCache.delete(first);
  }
  tokenCache.set(key, tokens);
  return tokens;
}

/**
 * Renders markdown content using a hybrid approach:
 * - Tables are rendered as React components with proper flexbox layout
 * - Other content is rendered as ANSI strings via formatToken
 */
export function Markdown(props) {
  const $ = _c(4);
  const settings = useSettings();
  if (settings.syntaxHighlightingDisabled) {
    let t0;
    if ($[0] !== props) {
      t0 = <MarkdownBody {...props} highlight={null} />;
      $[0] = props;
      $[1] = t0;
    } else {
      t0 = $[1];
    }
    return t0;
  }
  let t0;
  if ($[2] !== props) {
    t0 = <Suspense fallback={<MarkdownBody {...props} highlight={null} />}><MarkdownWithHighlight {...props} /></Suspense>;
    $[2] = props;
    $[3] = t0;
  } else {
    t0 = $[3];
  }
  return t0;
}
function MarkdownWithHighlight(props) {
  const $ = _c(4);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = getCliHighlightPromise();
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const highlight = use(t0);
  let t1;
  if ($[1] !== highlight || $[2] !== props) {
    t1 = <MarkdownBody {...props} highlight={highlight} />;
    $[1] = highlight;
    $[2] = props;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  return t1;
}
function MarkdownBody(t0) {
  const $ = _c(7);
  const {
    children,
    dimColor,
    highlight
  } = t0;
  const [theme] = useTheme();
  configureMarked();
  let elements;
  if ($[0] !== children || $[1] !== dimColor || $[2] !== highlight || $[3] !== theme) {
    const tokens = cachedLexer(stripPromptXMLTags(children));
    elements = [];
    let nonTableContent = "";
    const flushNonTableContent = function flushNonTableContent() {
      if (nonTableContent) {
        elements.push(<Ansi key={elements.length} dimColor={dimColor}>{nonTableContent.trim()}</Ansi>);
        nonTableContent = "";
      }
    };
    for (const token of tokens) {
      if (token.type === "table") {
        flushNonTableContent();
        elements.push(React.createElement(MarkdownTable, {
          key: elements.length,
          token: token as Tokens.Table,
          highlight
        }));
      } else {
        nonTableContent = nonTableContent + formatToken(token, theme, 0, null, null, highlight);
        nonTableContent;
      }
    }
    flushNonTableContent();
    $[0] = children;
    $[1] = dimColor;
    $[2] = highlight;
    $[3] = theme;
    $[4] = elements;
  } else {
    elements = $[4];
  }
  const elements_0 = elements;
  let t1;
  if ($[5] !== elements_0) {
    t1 = <Box flexDirection="column" gap={1}>{elements_0}</Box>;
    $[5] = elements_0;
    $[6] = t1;
  } else {
    t1 = $[6];
  }
  return t1;
}
type StreamingProps = {
  children: string;
};

/**
 * Renders markdown during streaming by splitting at the last top-level block
 * boundary: everything before is stable (memoized, never re-parsed), only the
 * final block is re-parsed per delta. marked.lexer() correctly handles
 * unclosed code fences as a single token, so block boundaries are always safe.
 *
 * The stable boundary only advances (monotonic), so ref mutation during render
 * is idempotent and safe under StrictMode double-rendering. Component unmounts
 * between turns (streamingText → null), resetting the ref.
 */
export function StreamingMarkdown({
  children
}: StreamingProps): React.ReactNode {
  // React Compiler: this component reads and writes stablePrefixRef.current
  // during render by design. The boundary only advances (monotonic), so
  // the ref mutation is idempotent under StrictMode double-render — but the
  // compiler can't prove that, and memoizing around the ref reads would
  // break the algorithm (stale boundary). Opt out.
  'use no memo';

  configureMarked();

  // Strip before boundary tracking so it matches <Markdown>'s stripping
  // (line 29). When a closing tag arrives, stripped(N+1) is not a prefix
  // of stripped(N), but the startsWith reset below handles that with a
  // one-time re-lex on the smaller stripped string.
  const stripped = stripPromptXMLTags(children);
  const stablePrefixRef = useRef('');

  // Reset if text was replaced (defensive; normally unmount handles this)
  if (!stripped.startsWith(stablePrefixRef.current)) {
    stablePrefixRef.current = '';
  }

  // Lex only from current boundary — O(unstable length), not O(full text)
  const boundary = stablePrefixRef.current.length;
  const tokens = marked.lexer(stripped.substring(boundary));

  // Last non-space token is the growing block; everything before is final
  let lastContentIdx = tokens.length - 1;
  while (lastContentIdx >= 0 && tokens[lastContentIdx]!.type === 'space') {
    lastContentIdx--;
  }
  let advance = 0;
  for (let i = 0; i < lastContentIdx; i++) {
    advance += tokens[i]!.raw.length;
  }
  if (advance > 0) {
    stablePrefixRef.current = stripped.substring(0, boundary + advance);
  }
  const stablePrefix = stablePrefixRef.current;
  const unstableSuffix = stripped.substring(stablePrefix.length);

  // stablePrefix is memoized inside <Markdown> via useMemo([children, ...])
  // so it never re-parses as the unstable suffix grows
  return <Box flexDirection="column" gap={1}>
      {stablePrefix && <Markdown>{stablePrefix}</Markdown>}
      {unstableSuffix && <Markdown>{unstableSuffix}</Markdown>}
    </Box>;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJtYXJrZWQiLCJUb2tlbiIsIlRva2VucyIsIlJlYWN0IiwiU3VzcGVuc2UiLCJ1c2UiLCJ1c2VNZW1vIiwidXNlUmVmIiwidXNlU2V0dGluZ3MiLCJBbnNpIiwiQm94IiwidXNlVGhlbWUiLCJDbGlIaWdobGlnaHQiLCJnZXRDbGlIaWdobGlnaHRQcm9taXNlIiwiaGFzaENvbnRlbnQiLCJjb25maWd1cmVNYXJrZWQiLCJmb3JtYXRUb2tlbiIsInN0cmlwUHJvbXB0WE1MVGFncyIsIk1hcmtkb3duVGFibGUiLCJQcm9wcyIsImNoaWxkcmVuIiwiZGltQ29sb3IiLCJUT0tFTl9DQUNIRV9NQVgiLCJ0b2tlbkNhY2hlIiwiTWFwIiwiTURfU1lOVEFYX1JFIiwiaGFzTWFya2Rvd25TeW50YXgiLCJzIiwidGVzdCIsImxlbmd0aCIsInNsaWNlIiwiY2FjaGVkTGV4ZXIiLCJjb250ZW50IiwidHlwZSIsInJhdyIsInRleHQiLCJ0b2tlbnMiLCJrZXkiLCJoaXQiLCJnZXQiLCJkZWxldGUiLCJzZXQiLCJsZXhlciIsInNpemUiLCJmaXJzdCIsImtleXMiLCJuZXh0IiwidmFsdWUiLCJ1bmRlZmluZWQiLCJNYXJrZG93biIsInByb3BzIiwiJCIsIl9jIiwic2V0dGluZ3MiLCJzeW50YXhIaWdobGlnaHRpbmdEaXNhYmxlZCIsInQwIiwiTWFya2Rvd25XaXRoSGlnaGxpZ2h0IiwiU3ltYm9sIiwiZm9yIiwiaGlnaGxpZ2h0IiwidDEiLCJNYXJrZG93bkJvZHkiLCJ0aGVtZSIsImVsZW1lbnRzIiwibm9uVGFibGVDb250ZW50IiwiZmx1c2hOb25UYWJsZUNvbnRlbnQiLCJwdXNoIiwidHJpbSIsInRva2VuIiwiVGFibGUiLCJlbGVtZW50c18wIiwiU3RyZWFtaW5nUHJvcHMiLCJTdHJlYW1pbmdNYXJrZG93biIsIlJlYWN0Tm9kZSIsInN0cmlwcGVkIiwic3RhYmxlUHJlZml4UmVmIiwic3RhcnRzV2l0aCIsImN1cnJlbnQiLCJib3VuZGFyeSIsInN1YnN0cmluZyIsImxhc3RDb250ZW50SWR4IiwiYWR2YW5jZSIsImkiLCJzdGFibGVQcmVmaXgiLCJ1bnN0YWJsZVN1ZmZpeCJdLCJzb3VyY2VzIjpbIk1hcmtkb3duLnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBtYXJrZWQsIHR5cGUgVG9rZW4sIHR5cGUgVG9rZW5zIH0gZnJvbSAnbWFya2VkJ1xuaW1wb3J0IFJlYWN0LCB7IFN1c3BlbnNlLCB1c2UsIHVzZU1lbW8sIHVzZVJlZiB9IGZyb20gJ3JlYWN0J1xuaW1wb3J0IHsgdXNlU2V0dGluZ3MgfSBmcm9tICcuLi9ob29rcy91c2VTZXR0aW5ncy5qcydcbmltcG9ydCB7IEFuc2ksIEJveCwgdXNlVGhlbWUgfSBmcm9tICcuLi9pbmsuanMnXG5pbXBvcnQge1xuICB0eXBlIENsaUhpZ2hsaWdodCxcbiAgZ2V0Q2xpSGlnaGxpZ2h0UHJvbWlzZSxcbn0gZnJvbSAnLi4vdXRpbHMvY2xpSGlnaGxpZ2h0LmpzJ1xuaW1wb3J0IHsgaGFzaENvbnRlbnQgfSBmcm9tICcuLi91dGlscy9oYXNoLmpzJ1xuaW1wb3J0IHsgY29uZmlndXJlTWFya2VkLCBmb3JtYXRUb2tlbiB9IGZyb20gJy4uL3V0aWxzL21hcmtkb3duLmpzJ1xuaW1wb3J0IHsgc3RyaXBQcm9tcHRYTUxUYWdzIH0gZnJvbSAnLi4vdXRpbHMvbWVzc2FnZXMuanMnXG5pbXBvcnQgeyBNYXJrZG93blRhYmxlIH0gZnJvbSAnLi9NYXJrZG93blRhYmxlLmpzJ1xuXG50eXBlIFByb3BzID0ge1xuICBjaGlsZHJlbjogc3RyaW5nXG4gIC8qKiBXaGVuIHRydWUsIHJlbmRlciBhbGwgdGV4dCBjb250ZW50IGFzIGRpbSAqL1xuICBkaW1Db2xvcj86IGJvb2xlYW5cbn1cblxuLy8gTW9kdWxlLWxldmVsIHRva2VuIGNhY2hlIOKAlCBtYXJrZWQubGV4ZXIgaXMgdGhlIGhvdCBjb3N0IG9uIHZpcnR1YWwtc2Nyb2xsXG4vLyByZW1vdW50cyAofjNtcyBwZXIgbWVzc2FnZSkuIHVzZU1lbW8gZG9lc24ndCBzdXJ2aXZlIHVubW91bnTihpJyZW1vdW50LCBzb1xuLy8gc2Nyb2xsaW5nIGJhY2sgdG8gYSBwcmV2aW91c2x5LXZpc2libGUgbWVzc2FnZSByZS1wYXJzZXMuIE1lc3NhZ2VzIGFyZVxuLy8gaW1tdXRhYmxlIGluIGhpc3Rvcnk7IHNhbWUgY29udGVudCDihpIgc2FtZSB0b2tlbnMuIEtleWVkIGJ5IGhhc2ggdG8gYXZvaWRcbi8vIHJldGFpbmluZyBmdWxsIGNvbnRlbnQgc3RyaW5ncyAodHVybjUw4oaSdHVybjk5IFJTUyByZWdyZXNzaW9uLCAjMjQxODApLlxuY29uc3QgVE9LRU5fQ0FDSEVfTUFYID0gNTAwXG5jb25zdCB0b2tlbkNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIFRva2VuW10+KClcblxuLy8gQ2hhcmFjdGVycyB0aGF0IGluZGljYXRlIG1hcmtkb3duIHN5bnRheC4gSWYgbm9uZSBhcmUgcHJlc2VudCwgc2tpcCB0aGVcbi8vIH4zbXMgbWFya2VkLmxleGVyIGNhbGwgZW50aXJlbHkg4oCUIHJlbmRlciBhcyBhIHNpbmdsZSBwYXJhZ3JhcGguIENvdmVyc1xuLy8gdGhlIG1ham9yaXR5IG9mIHNob3J0IGFzc2lzdGFudCByZXNwb25zZXMgYW5kIHVzZXIgcHJvbXB0cyB0aGF0IGFyZVxuLy8gcGxhaW4gc2VudGVuY2VzLiBDaGVja2VkIHZpYSBpbmRleE9mIChub3QgcmVnZXgpIGZvciBzcGVlZC5cbi8vIFNpbmdsZSByZWdleDogbWF0Y2hlcyBhbnkgTUQgbWFya2VyIG9yIG9yZGVyZWQtbGlzdCBzdGFydCAoTi4gYXQgbGluZSBzdGFydCkuXG4vLyBPbmUgcGFzcyBpbnN0ZWFkIG9mIDEww5cgaW5jbHVkZXMgc2NhbnMuXG5jb25zdCBNRF9TWU5UQVhfUkUgPSAvWyMqYHxbPlxcLV9+XXxcXG5cXG58XlxcZCtcXC4gfFxcblxcZCtcXC4gL1xuZnVuY3Rpb24gaGFzTWFya2Rvd25TeW50YXgoczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIC8vIFNhbXBsZSBmaXJzdCA1MDAgY2hhcnMg4oCUIGlmIG1hcmtkb3duIGV4aXN0cyBpdCdzIHVzdWFsbHkgZWFybHkgKGhlYWRlcnMsXG4gIC8vIGNvZGUgZmVuY2UsIGxpc3QpLiBMb25nIHRvb2wgb3V0cHV0cyBhcmUgbW9zdGx5IHBsYWluIHRleHQgdGFpbHMuXG4gIHJldHVybiBNRF9TWU5UQVhfUkUudGVzdChzLmxlbmd0aCA+IDUwMCA/IHMuc2xpY2UoMCwgNTAwKSA6IHMpXG59XG5cbmZ1bmN0aW9uIGNhY2hlZExleGVyKGNvbnRlbnQ6IHN0cmluZyk6IFRva2VuW10ge1xuICAvLyBGYXN0IHBhdGg6IHBsYWluIHRleHQgd2l0aCBubyBtYXJrZG93biBzeW50YXgg4oaSIHNpbmdsZSBwYXJhZ3JhcGggdG9rZW4uXG4gIC8vIFNraXBzIG1hcmtlZC5sZXhlcidzIGZ1bGwgR0ZNIHBhcnNlICh+M21zIG9uIGxvbmcgY29udGVudCkuIE5vdCBjYWNoZWQg4oCUXG4gIC8vIHJlY29uc3RydWN0aW9uIGlzIGEgc2luZ2xlIG9iamVjdCBhbGxvY2F0aW9uLCBhbmQgY2FjaGluZyB3b3VsZCByZXRhaW5cbiAgLy8gNMOXIGNvbnRlbnQgaW4gcmF3L3RleHQgZmllbGRzIHBsdXMgdGhlIGhhc2gga2V5IGZvciB6ZXJvIGJlbmVmaXQuXG4gIGlmICghaGFzTWFya2Rvd25TeW50YXgoY29udGVudCkpIHtcbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICB0eXBlOiAncGFyYWdyYXBoJyxcbiAgICAgICAgcmF3OiBjb250ZW50LFxuICAgICAgICB0ZXh0OiBjb250ZW50LFxuICAgICAgICB0b2tlbnM6IFt7IHR5cGU6ICd0ZXh0JywgcmF3OiBjb250ZW50LCB0ZXh0OiBjb250ZW50IH1dLFxuICAgICAgfSBhcyBUb2tlbixcbiAgICBdXG4gIH1cbiAgY29uc3Qga2V5ID0gaGFzaENvbnRlbnQoY29udGVudClcbiAgY29uc3QgaGl0ID0gdG9rZW5DYWNoZS5nZXQoa2V5KVxuICBpZiAoaGl0KSB7XG4gICAgLy8gUHJvbW90ZSB0byBNUlUg4oCUIHdpdGhvdXQgdGhpcyB0aGUgZXZpY3Rpb24gaXMgRklGTyAoc2Nyb2xsaW5nIGJhY2sgdG9cbiAgICAvLyBhbiBlYXJseSBtZXNzYWdlIGV2aWN0cyB0aGUgdmVyeSBpdGVtIHlvdSdyZSBsb29raW5nIGF0KS5cbiAgICB0b2tlbkNhY2hlLmRlbGV0ZShrZXkpXG4gICAgdG9rZW5DYWNoZS5zZXQoa2V5LCBoaXQpXG4gICAgcmV0dXJuIGhpdFxuICB9XG4gIGNvbnN0IHRva2VucyA9IG1hcmtlZC5sZXhlcihjb250ZW50KVxuICBpZiAodG9rZW5DYWNoZS5zaXplID49IFRPS0VOX0NBQ0hFX01BWCkge1xuICAgIC8vIExSVS1pc2g6IGRyb3Agb2xkZXN0LiBNYXAgcHJlc2VydmVzIGluc2VydGlvbiBvcmRlci5cbiAgICBjb25zdCBmaXJzdCA9IHRva2VuQ2FjaGUua2V5cygpLm5leHQoKS52YWx1ZVxuICAgIGlmIChmaXJzdCAhPT0gdW5kZWZpbmVkKSB0b2tlbkNhY2hlLmRlbGV0ZShmaXJzdClcbiAgfVxuICB0b2tlbkNhY2hlLnNldChrZXksIHRva2VucylcbiAgcmV0dXJuIHRva2Vuc1xufVxuXG4vKipcbiAqIFJlbmRlcnMgbWFya2Rvd24gY29udGVudCB1c2luZyBhIGh5YnJpZCBhcHByb2FjaDpcbiAqIC0gVGFibGVzIGFyZSByZW5kZXJlZCBhcyBSZWFjdCBjb21wb25lbnRzIHdpdGggcHJvcGVyIGZsZXhib3ggbGF5b3V0XG4gKiAtIE90aGVyIGNvbnRlbnQgaXMgcmVuZGVyZWQgYXMgQU5TSSBzdHJpbmdzIHZpYSBmb3JtYXRUb2tlblxuICovXG5leHBvcnQgZnVuY3Rpb24gTWFya2Rvd24ocHJvcHM6IFByb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgY29uc3Qgc2V0dGluZ3MgPSB1c2VTZXR0aW5ncygpXG4gIGlmIChzZXR0aW5ncy5zeW50YXhIaWdobGlnaHRpbmdEaXNhYmxlZCkge1xuICAgIHJldHVybiA8TWFya2Rvd25Cb2R5IHsuLi5wcm9wc30gaGlnaGxpZ2h0PXtudWxsfSAvPlxuICB9XG4gIC8vIFN1c3BlbnNlIGZhbGxiYWNrIHJlbmRlcnMgd2l0aCBoaWdobGlnaHQ9bnVsbCDigJQgcGxhaW4gbWFya2Rvd24gc2hvd3NcbiAgLy8gZm9yIH41MG1zIG9uIGZpcnN0IGV2ZXIgcmVuZGVyIHdoaWxlIGNsaS1oaWdobGlnaHQgbG9hZHMuXG4gIHJldHVybiAoXG4gICAgPFN1c3BlbnNlIGZhbGxiYWNrPXs8TWFya2Rvd25Cb2R5IHsuLi5wcm9wc30gaGlnaGxpZ2h0PXtudWxsfSAvPn0+XG4gICAgICA8TWFya2Rvd25XaXRoSGlnaGxpZ2h0IHsuLi5wcm9wc30gLz5cbiAgICA8L1N1c3BlbnNlPlxuICApXG59XG5cbmZ1bmN0aW9uIE1hcmtkb3duV2l0aEhpZ2hsaWdodChwcm9wczogUHJvcHMpOiBSZWFjdC5SZWFjdE5vZGUge1xuICBjb25zdCBoaWdobGlnaHQgPSB1c2UoZ2V0Q2xpSGlnaGxpZ2h0UHJvbWlzZSgpKVxuICByZXR1cm4gPE1hcmtkb3duQm9keSB7Li4ucHJvcHN9IGhpZ2hsaWdodD17aGlnaGxpZ2h0fSAvPlxufVxuXG5mdW5jdGlvbiBNYXJrZG93bkJvZHkoe1xuICBjaGlsZHJlbixcbiAgZGltQ29sb3IsXG4gIGhpZ2hsaWdodCxcbn06IFByb3BzICYgeyBoaWdobGlnaHQ6IENsaUhpZ2hsaWdodCB8IG51bGwgfSk6IFJlYWN0LlJlYWN0Tm9kZSB7XG4gIGNvbnN0IFt0aGVtZV0gPSB1c2VUaGVtZSgpXG4gIGNvbmZpZ3VyZU1hcmtlZCgpXG5cbiAgY29uc3QgZWxlbWVudHMgPSB1c2VNZW1vKCgpID0+IHtcbiAgICBjb25zdCB0b2tlbnMgPSBjYWNoZWRMZXhlcihzdHJpcFByb21wdFhNTFRhZ3MoY2hpbGRyZW4pKVxuICAgIGNvbnN0IGVsZW1lbnRzOiBSZWFjdC5SZWFjdE5vZGVbXSA9IFtdXG4gICAgbGV0IG5vblRhYmxlQ29udGVudCA9ICcnXG5cbiAgICBmdW5jdGlvbiBmbHVzaE5vblRhYmxlQ29udGVudCgpOiB2b2lkIHtcbiAgICAgIGlmIChub25UYWJsZUNvbnRlbnQpIHtcbiAgICAgICAgZWxlbWVudHMucHVzaChcbiAgICAgICAgICA8QW5zaSBrZXk9e2VsZW1lbnRzLmxlbmd0aH0gZGltQ29sb3I9e2RpbUNvbG9yfT5cbiAgICAgICAgICAgIHtub25UYWJsZUNvbnRlbnQudHJpbSgpfVxuICAgICAgICAgIDwvQW5zaT4sXG4gICAgICAgIClcbiAgICAgICAgbm9uVGFibGVDb250ZW50ID0gJydcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2Vucykge1xuICAgICAgaWYgKHRva2VuLnR5cGUgPT09ICd0YWJsZScpIHtcbiAgICAgICAgZmx1c2hOb25UYWJsZUNvbnRlbnQoKVxuICAgICAgICBlbGVtZW50cy5wdXNoKFxuICAgICAgICAgIFJlYWN0LmNyZWF0ZUVsZW1lbnQoTWFya2Rvd25UYWJsZSwge1xuICAgICAgICAgICAga2V5OiBlbGVtZW50cy5sZW5ndGgsXG4gICAgICAgICAgICB0b2tlbjogdG9rZW4gYXMgVG9rZW5zLlRhYmxlLFxuICAgICAgICAgICAgaGlnaGxpZ2h0LFxuICAgICAgICAgIH0pLFxuICAgICAgICApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBub25UYWJsZUNvbnRlbnQgKz0gZm9ybWF0VG9rZW4odG9rZW4sIHRoZW1lLCAwLCBudWxsLCBudWxsLCBoaWdobGlnaHQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgZmx1c2hOb25UYWJsZUNvbnRlbnQoKVxuICAgIHJldHVybiBlbGVtZW50c1xuICB9LCBbY2hpbGRyZW4sIGRpbUNvbG9yLCBoaWdobGlnaHQsIHRoZW1lXSlcblxuICByZXR1cm4gKFxuICAgIDxCb3ggZmxleERpcmVjdGlvbj1cImNvbHVtblwiIGdhcD17MX0+XG4gICAgICB7ZWxlbWVudHN9XG4gICAgPC9Cb3g+XG4gIClcbn1cblxudHlwZSBTdHJlYW1pbmdQcm9wcyA9IHtcbiAgY2hpbGRyZW46IHN0cmluZ1xufVxuXG4vKipcbiAqIFJlbmRlcnMgbWFya2Rvd24gZHVyaW5nIHN0cmVhbWluZyBieSBzcGxpdHRpbmcgYXQgdGhlIGxhc3QgdG9wLWxldmVsIGJsb2NrXG4gKiBib3VuZGFyeTogZXZlcnl0aGluZyBiZWZvcmUgaXMgc3RhYmxlIChtZW1vaXplZCwgbmV2ZXIgcmUtcGFyc2VkKSwgb25seSB0aGVcbiAqIGZpbmFsIGJsb2NrIGlzIHJlLXBhcnNlZCBwZXIgZGVsdGEuIG1hcmtlZC5sZXhlcigpIGNvcnJlY3RseSBoYW5kbGVzXG4gKiB1bmNsb3NlZCBjb2RlIGZlbmNlcyBhcyBhIHNpbmdsZSB0b2tlbiwgc28gYmxvY2sgYm91bmRhcmllcyBhcmUgYWx3YXlzIHNhZmUuXG4gKlxuICogVGhlIHN0YWJsZSBib3VuZGFyeSBvbmx5IGFkdmFuY2VzIChtb25vdG9uaWMpLCBzbyByZWYgbXV0YXRpb24gZHVyaW5nIHJlbmRlclxuICogaXMgaWRlbXBvdGVudCBhbmQgc2FmZSB1bmRlciBTdHJpY3RNb2RlIGRvdWJsZS1yZW5kZXJpbmcuIENvbXBvbmVudCB1bm1vdW50c1xuICogYmV0d2VlbiB0dXJucyAoc3RyZWFtaW5nVGV4dCDihpIgbnVsbCksIHJlc2V0dGluZyB0aGUgcmVmLlxuICovXG5leHBvcnQgZnVuY3Rpb24gU3RyZWFtaW5nTWFya2Rvd24oe1xuICBjaGlsZHJlbixcbn06IFN0cmVhbWluZ1Byb3BzKTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgLy8gUmVhY3QgQ29tcGlsZXI6IHRoaXMgY29tcG9uZW50IHJlYWRzIGFuZCB3cml0ZXMgc3RhYmxlUHJlZml4UmVmLmN1cnJlbnRcbiAgLy8gZHVyaW5nIHJlbmRlciBieSBkZXNpZ24uIFRoZSBib3VuZGFyeSBvbmx5IGFkdmFuY2VzIChtb25vdG9uaWMpLCBzb1xuICAvLyB0aGUgcmVmIG11dGF0aW9uIGlzIGlkZW1wb3RlbnQgdW5kZXIgU3RyaWN0TW9kZSBkb3VibGUtcmVuZGVyIOKAlCBidXQgdGhlXG4gIC8vIGNvbXBpbGVyIGNhbid0IHByb3ZlIHRoYXQsIGFuZCBtZW1vaXppbmcgYXJvdW5kIHRoZSByZWYgcmVhZHMgd291bGRcbiAgLy8gYnJlYWsgdGhlIGFsZ29yaXRobSAoc3RhbGUgYm91bmRhcnkpLiBPcHQgb3V0LlxuICAndXNlIG5vIG1lbW8nXG4gIGNvbmZpZ3VyZU1hcmtlZCgpXG5cbiAgLy8gU3RyaXAgYmVmb3JlIGJvdW5kYXJ5IHRyYWNraW5nIHNvIGl0IG1hdGNoZXMgPE1hcmtkb3duPidzIHN0cmlwcGluZ1xuICAvLyAobGluZSAyOSkuIFdoZW4gYSBjbG9zaW5nIHRhZyBhcnJpdmVzLCBzdHJpcHBlZChOKzEpIGlzIG5vdCBhIHByZWZpeFxuICAvLyBvZiBzdHJpcHBlZChOKSwgYnV0IHRoZSBzdGFydHNXaXRoIHJlc2V0IGJlbG93IGhhbmRsZXMgdGhhdCB3aXRoIGFcbiAgLy8gb25lLXRpbWUgcmUtbGV4IG9uIHRoZSBzbWFsbGVyIHN0cmlwcGVkIHN0cmluZy5cbiAgY29uc3Qgc3RyaXBwZWQgPSBzdHJpcFByb21wdFhNTFRhZ3MoY2hpbGRyZW4pXG5cbiAgY29uc3Qgc3RhYmxlUHJlZml4UmVmID0gdXNlUmVmKCcnKVxuXG4gIC8vIFJlc2V0IGlmIHRleHQgd2FzIHJlcGxhY2VkIChkZWZlbnNpdmU7IG5vcm1hbGx5IHVubW91bnQgaGFuZGxlcyB0aGlzKVxuICBpZiAoIXN0cmlwcGVkLnN0YXJ0c1dpdGgoc3RhYmxlUHJlZml4UmVmLmN1cnJlbnQpKSB7XG4gICAgc3RhYmxlUHJlZml4UmVmLmN1cnJlbnQgPSAnJ1xuICB9XG5cbiAgLy8gTGV4IG9ubHkgZnJvbSBjdXJyZW50IGJvdW5kYXJ5IOKAlCBPKHVuc3RhYmxlIGxlbmd0aCksIG5vdCBPKGZ1bGwgdGV4dClcbiAgY29uc3QgYm91bmRhcnkgPSBzdGFibGVQcmVmaXhSZWYuY3VycmVudC5sZW5ndGhcbiAgY29uc3QgdG9rZW5zID0gbWFya2VkLmxleGVyKHN0cmlwcGVkLnN1YnN0cmluZyhib3VuZGFyeSkpXG5cbiAgLy8gTGFzdCBub24tc3BhY2UgdG9rZW4gaXMgdGhlIGdyb3dpbmcgYmxvY2s7IGV2ZXJ5dGhpbmcgYmVmb3JlIGlzIGZpbmFsXG4gIGxldCBsYXN0Q29udGVudElkeCA9IHRva2Vucy5sZW5ndGggLSAxXG4gIHdoaWxlIChsYXN0Q29udGVudElkeCA+PSAwICYmIHRva2Vuc1tsYXN0Q29udGVudElkeF0hLnR5cGUgPT09ICdzcGFjZScpIHtcbiAgICBsYXN0Q29udGVudElkeC0tXG4gIH1cbiAgbGV0IGFkdmFuY2UgPSAwXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGFzdENvbnRlbnRJZHg7IGkrKykge1xuICAgIGFkdmFuY2UgKz0gdG9rZW5zW2ldIS5yYXcubGVuZ3RoXG4gIH1cbiAgaWYgKGFkdmFuY2UgPiAwKSB7XG4gICAgc3RhYmxlUHJlZml4UmVmLmN1cnJlbnQgPSBzdHJpcHBlZC5zdWJzdHJpbmcoMCwgYm91bmRhcnkgKyBhZHZhbmNlKVxuICB9XG5cbiAgY29uc3Qgc3RhYmxlUHJlZml4ID0gc3RhYmxlUHJlZml4UmVmLmN1cnJlbnRcbiAgY29uc3QgdW5zdGFibGVTdWZmaXggPSBzdHJpcHBlZC5zdWJzdHJpbmcoc3RhYmxlUHJlZml4Lmxlbmd0aClcblxuICAvLyBzdGFibGVQcmVmaXggaXMgbWVtb2l6ZWQgaW5zaWRlIDxNYXJrZG93bj4gdmlhIHVzZU1lbW8oW2NoaWxkcmVuLCAuLi5dKVxuICAvLyBzbyBpdCBuZXZlciByZS1wYXJzZXMgYXMgdGhlIHVuc3RhYmxlIHN1ZmZpeCBncm93c1xuICByZXR1cm4gKFxuICAgIDxCb3ggZmxleERpcmVjdGlvbj1cImNvbHVtblwiIGdhcD17MX0+XG4gICAgICB7c3RhYmxlUHJlZml4ICYmIDxNYXJrZG93bj57c3RhYmxlUHJlZml4fTwvTWFya2Rvd24+fVxuICAgICAge3Vuc3RhYmxlU3VmZml4ICYmIDxNYXJrZG93bj57dW5zdGFibGVTdWZmaXh9PC9NYXJrZG93bj59XG4gICAgPC9Cb3g+XG4gIClcbn1cbiJdLCJtYXBwaW5ncyI6IjtBQUFBLFNBQVNBLE1BQU0sRUFBRSxLQUFLQyxLQUFLLEVBQUUsS0FBS0Ms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
