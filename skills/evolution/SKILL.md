# Evolution Skill

When performing an evolution cycle, follow this exact protocol:

## Pre-flight
1. Run `git status` — ensure working tree is clean
2. Run `git branch` — confirm you're on `dev`
3. Read `data/state.json` — note current version and cycle

## Assessment
4. Read your recent code changes: `git log --oneline -10`
5. Scan `src/` for the highest-leverage improvement
6. Consider: what's most dangerous to lack right now?

## Implementation
7. Make ONE focused change
8. Keep it small and complete — not 80%
9. For complex changes, use `claude_code` tool
10. For simple changes, use Pi's built-in `write`/`edit` tools

## Verification
11. Run `pnpm run build` — must pass
12. Run `pnpm test` — must pass
13. If tests exist for your change, ensure they pass

## Commit
14. `git add -A`
15. `git commit -m "feat/fix/chore: {what changed}"`
16. `git push origin dev`
17. Update state: bump version via `update_state`

## Restart
18. Call `request_restart` with reason

## Report
19. Call `send_owner_message` with a summary of what changed
