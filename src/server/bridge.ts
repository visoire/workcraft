// Connection snippets for other IDEs and agent platforms, so they can use WorkCraft's tools (documents,
// spreadsheets, presentations, PDF, project search, memory, skills and the Craft apps) through its MCP server
// at /mcp (Streamable HTTP). Formats follow artifical-intelligence/ide_documentations. Clients that only start
// local processes use `npx mcp-remote <url>` as a stdio bridge to the same endpoint.

export interface BridgeInput {
  /** http://127.0.0.1:<port> of this backend */
  origin: string;
  /** Present when home-network access is on and the caller is local: the token other devices need */
  lan: { token: string } | null;
  host: string;
}

export interface BridgeTarget {
  id: string;
  name: string;
  /** Where the file goes, or the command to run */
  where: string;
  /** Snippet: JSON, JSONC or a shell command */
  format: 'json' | 'jsonc' | 'shell';
  snippet: string;
  note?: string;
}

const json = (o: unknown) => JSON.stringify(o, null, 2);

export function bridgeConfigs(i: BridgeInput): { url: string; lanUrl: string | null; targets: BridgeTarget[]; skills: { shared: string; claude: string } } {
  const url = `${i.origin}/mcp`;
  const lanUrl = i.lan?.token ? `http://${i.host}/mcp` : null;
  const stdio = { command: 'npx', args: ['-y', 'mcp-remote', url] };
  const targets: BridgeTarget[] = [
    {
      id: 'antigravity',
      name: 'Google Antigravity',
      where: '<project>/.agents/mcp_config.json or ~/.gemini/config/mcp_config.json',
      format: 'json',
      snippet: json({ mcpServers: { workcraft: { url, transport: 'http' } } }),
      note: 'If your version only lists stdio and SSE servers, use the stdio form shown under ZCode and other agents.',
    },
    { id: 'trae', name: 'Trae', where: 'Trae, Settings, MCP, Add manually', format: 'json', snippet: json({ mcpServers: { workcraft: stdio } }), note: 'Trae starts the bridge itself; WorkCraft has to be running.' },
    { id: 'cursor', name: 'Cursor', where: '~/.cursor/mcp.json or <project>/.cursor/mcp.json', format: 'json', snippet: json({ mcpServers: { workcraft: { url } } }) },
    { id: 'windsurf', name: 'Windsurf', where: '~/.codeium/windsurf/mcp_config.json', format: 'json', snippet: json({ mcpServers: { workcraft: stdio } }) },
    { id: 'claude-code', name: 'Claude Code', where: 'terminal', format: 'shell', snippet: `claude mcp add --transport http workcraft ${url}` },
    { id: 'claude-desktop', name: 'Claude Desktop', where: '%APPDATA%\\Claude\\claude_desktop_config.json (macOS: ~/Library/Application Support/Claude/)', format: 'json', snippet: json({ mcpServers: { workcraft: stdio } }) },
    { id: 'opencode', name: 'OpenCode', where: 'opencode.jsonc', format: 'jsonc', snippet: json({ mcp: { workcraft: { type: 'remote', url, enabled: true } } }) },
    { id: 'zcode', name: 'ZCode and other agents', where: 'the MCP settings of the agent', format: 'json', snippet: json({ mcpServers: { workcraft: stdio } }), note: 'Works for every client that starts a stdio MCP server.' },
  ];
  if (lanUrl) {
    targets.push({
      id: 'network',
      name: 'Another computer on the home network',
      where: 'the MCP settings of the agent on the other computer',
      format: 'json',
      snippet: json({ mcpServers: { workcraft: { command: 'npx', args: ['-y', 'mcp-remote', lanUrl, '--header', `x-oc-token:${i.lan!.token}`] } } }),
      note: 'The token pairs that computer with WorkCraft. Keep it private.',
    });
  }
  return { url, lanUrl, targets, skills: { shared: '~/.agents/skills (Codex, ZCode, Antigravity)', claude: '~/.claude/skills (Claude Code)' } };
}
