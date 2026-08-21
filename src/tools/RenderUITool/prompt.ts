/**
 * RenderUI tool system-prompt fragment.
 *
 * Design doc reference: docs/design/2026-08-21-a2ui-integration.md §5.1
 * Risk R4: token cost — callers should use buildA2uiSchemaBlock(componentNames)
 * from src/a2ui/prompt.ts to prune the schema to only the components they need.
 */

export const RENDER_UI_TOOL_NAME = 'RenderUI'

export const RENDER_UI_TOOL_DESCRIPTION = `Emit an A2UI v0.9.1 interactive surface into the chat transcript.

The surface renders inline next to your message. When the user interacts with a component (e.g. clicks a Button), the action payload is returned as the tool result so you can respond to it.

## messages array format

Each element is a JSON object following the A2UI v0.9.1 server-to-client protocol. A minimal surface requires two messages in sequence:

1. createSurface — declare the surface:
   { "version": "v0.9.1", "createSurface": { "surfaceId": "<unique-id>", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json" } }

2. updateComponents — set the component tree:
   { "version": "v0.9.1", "updateComponents": { "surfaceId": "<same-id>", "components": [ ... ] } }

## component list rules (CRITICAL — renderer depends on ordering)

- The component list is a FLAT adjacency list (not a tree).
- The component with id "root" MUST be the FIRST element.
- Parent components MUST precede their children in the list.
- Children are referenced by id via the parent's children property.

## dynamic values

Use JSON Pointer bindings { "path": "/x" } to bind a component property to a data model value set via updateDataModel messages.

## receiving user actions

When a user interacts with a component, the tool returns an action payload:
  { "version": "v0.9.1", "action": { "name": "<action-name>", "surfaceId": "...", "sourceComponentId": "...", "timestamp": "<ISO-8601>", "context": { ... } } }

You MUST NOT call RenderUI again for the same surface after an action is received unless you want to create a completely new surface. To update an existing surface, use updateComponents messages.
`

export const RENDER_UI_TOOL_PROMPT = `## RenderUI tool

Use the RenderUI tool to present rich, interactive UI surfaces to the user inline in the conversation.

Prefer RenderUI over plain text when:
- Showing structured data that benefits from visual layout (cards, tables, lists)
- Asking the user to choose from options (radio buttons, checkboxes, dropdowns)
- Presenting a form to collect structured input
- Displaying media (images, markdown-rendered documents)

Do NOT use RenderUI for:
- Simple questions that fit in one sentence (use plain text or AskUserQuestion instead)
- Streaming large amounts of text where markdown suffices
- Actions the user should perform in their environment (use BashTool instead)
`
