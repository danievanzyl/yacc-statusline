# yacc-statusline

**Yet Another Claude Code** status line — a custom 3-line status bar for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## What it does

A Bun/TypeScript script that hooks into Claude Code's `status_line` feature, reading session JSON from stdin and rendering a rich, color-coded status bar:

```
 main* • ~/code/my-project • Opus 4.6 v4.6
S: $1.24 ↑42k ↓8k [━━━━━━━━━━] 32% (12m) • 64k/200k
L: [━━━━━━━━━━] 18% (4h22m) • W: [━━━━━━━━━━] 6% (6d)
```

### Line 1 — Context
- Git branch with dirty indicator (`*`)
- Shortened working directory
- Model name and version

### Line 2 — Session
- Cumulative cost in USD
- Input/output token counts
- Context window usage bar + percentage
- Session duration
- Context tokens used vs total

### Line 3 — Rate limits
- **L:** 5-hour rolling window usage (Pro plan ~5M token limit)
- **W:** 7-day rolling window usage (Pro plan ~45M token limit)
- Time until oldest tokens in each window expire

Progress bars shift from green to yellow to orange to red as usage increases.

## Usage tracking

Token usage is tracked across sessions in a local `usage.json` file. The script computes deltas from Claude Code's cumulative token counts, so restarting sessions doesn't double-count. Entries older than 7 days are automatically pruned.

## Prerequisites

- [Bun](https://bun.sh) runtime

## Setup

1. Clone this repo
2. Make the script executable:
   ```sh
   chmod +x statusline.ts
   ```
3. Configure Claude Code to use it as your status line command. Add to `~/.claude/settings.json`:
   ```json
   {
     "status_line": "/path/to/statusline.ts"
   }
   ```

## Configuration

Default rate limits are set for the Claude Pro plan at the top of `statusline.ts`:

| Constant | Default | Description |
|---|---|---|
| `FIVE_HOUR_LIMIT` | 5,000,000 | Token budget per 5-hour window |
| `WEEKLY_LIMIT` | 45,000,000 | Token budget per 7-day window |
| `BAR_WIDTH` | 10 | Character width of progress bars |

Adjust these if you're on a different plan or want different thresholds.

## License

MIT
