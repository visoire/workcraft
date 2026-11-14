// Approval modes of the chat. No DOM.
//   manual  the AI asks before tools that need approval (commands, signing, external tools with the rule "ask"),
//           and a step that fails waits for the user: retry, edit the arguments, report it to the AI or cancel
//   auto    full access: those tools run without asking, and a failed step goes straight back to the model, which
//           can correct itself (the repeated-failure guard still ends an answer that keeps failing the same way)
// The mode only covers the chat of this workspace. External MCP clients keep needing a single-use approval token.

export type ApprovalMode = 'manual' | 'auto';

/** Does a call of this tool need the user's confirmation in the given mode? */
export const needsConfirmation = (mode: ApprovalMode, tool: { approval: boolean }): boolean => tool.approval && mode !== 'auto';

/** What a failed step does: wait for the user, or report the error to the model at once. */
export const failureAction = (mode: ApprovalMode): 'ask' | 'report' => (mode === 'auto' ? 'report' : 'ask');
