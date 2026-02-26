# Jinx Configuration

> Environment variable reference for Jinx AI agent

## Quick Reference

```bash
# Health Check Thresholds
HEALTH_MEMORY_WARNING_THRESHOLD=85
HEALTH_MEMORY_CRITICAL_THRESHOLD=95
HEALTH_DISK_WARNING_THRESHOLD=80
HEALTH_DISK_CRITICAL_THRESHOLD=90

# Crash Recovery
RECOVERY_CRASH_THRESHOLD_MS=15000
RECOVERY_MAX_CRASHES=3

# Session Cleanup
CLEANUP_MAX_SESSIONS_TO_KEEP=5

# Agent Timeouts
AGENT_PROMPT_TIMEOUT_MS=1200000
AGENT_FOLLOWUP_TIMEOUT_MS=1200000

# Consciousness Loop
CONSCIOUSNESS_INTERVAL_SECONDS=5

# Logging
LOG_LEVEL=info

# Integrations
DEFAULT_MODEL=openai/gpt-4
GITHUB_TOKEN=ghp_xxxxxxxx
TG_BOT_TOKEN=xxxxxxxxxx
OWNER_ID=123456789
```

---

## Health Check Configuration

Control system resource monitoring thresholds.

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `HEALTH_MEMORY_WARNING_THRESHOLD` | `85` | 1-100 | Memory usage % to trigger warning status |
| `HEALTH_MEMORY_CRITICAL_THRESHOLD` | `95` | 1-100 | Memory usage % to trigger critical status |
| `HEALTH_DISK_WARNING_THRESHOLD` | `80` | 1-100 | Disk usage % to trigger warning status |
| `HEALTH_DISK_CRITICAL_THRESHOLD` | `90` | 1-100 | Disk usage % to trigger critical status |

**Example:**
```bash
# Lower thresholds for more sensitive monitoring
HEALTH_MEMORY_WARNING_THRESHOLD=70
HEALTH_MEMORY_CRITICAL_THRESHOLD=85
```

---

## Crash Recovery Configuration

Control crash loop detection and emergency rollback behavior.

| Variable | Default | Unit | Description |
|----------|---------|------|-------------|
| `RECOVERY_CRASH_THRESHOLD_MS` | `15000` | milliseconds | Time window for rapid crash detection |
| `RECOVERY_MAX_CRASHES` | `3` | count | Max crashes before emergency rollback |

**How it works:**
- If Jinx crashes more than `RECOVERY_MAX_CRASHES` times within `RECOVERY_CRASH_THRESHOLD_MS`, it triggers an emergency rollback to the main branch
- This protects against broken deployments

**Example:**
```bash
# Stricter crash detection for production
RECOVERY_CRASH_THRESHOLD_MS=10000
RECOVERY_MAX_CRASHES=2
```

---

## Session Cleanup Configuration

Control session file retention.

| Variable | Default | Unit | Description |
|----------|---------|------|-------------|
| `CLEANUP_MAX_SESSIONS_TO_KEEP` | `5` | count | Number of recent session files to retain |

**Example:**
```bash
# Keep more sessions for debugging
CLEANUP_MAX_SESSIONS_TO_KEEP=10
```

---

## Agent Timeout Configuration

Control prompt and follow-up timeout behavior.

| Variable | Default | Unit | Description |
|----------|---------|------|-------------|
| `AGENT_PROMPT_TIMEOUT_MS` | `1200000` | milliseconds (20 min) | Timeout for normal prompts |
| `AGENT_FOLLOWUP_TIMEOUT_MS` | `1200000` | milliseconds (20 min) | Timeout for queued follow-ups |

**Note:** Evolution cycles can take a long time, so these timeouts should be generous.

**Example:**
```bash
# Longer timeouts for complex evolution cycles
AGENT_PROMPT_TIMEOUT_MS=1800000
AGENT_FOLLOWUP_TIMEOUT_MS=1800000
```

---

## Consciousness Loop Configuration

Control the background consciousness check interval.

| Variable | Default | Unit | Description |
|----------|---------|------|-------------|
| `CONSCIOUSNESS_INTERVAL_SECONDS` | `5` | seconds | Interval between consciousness checks |

**Example:**
```bash
# Less frequent checks to reduce CPU usage
CONSCIOUSNESS_INTERVAL_SECONDS=30
```

---

## Logging Configuration

| Variable | Default | Options | Description |
|----------|---------|---------|-------------|
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` | Minimum log level to output |
| `NODE_ENV` | - | `production`, `development` | Environment mode (affects log formatting) |

**Example:**
```bash
# More verbose logging for debugging
LOG_LEVEL=debug

# Production mode
NODE_ENV=production
```

---

## Integration Configuration

### AI Model

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_MODEL` | - | Default AI model to use (format: `provider/model` or just `model`) |

**Example:**
```bash
DEFAULT_MODEL=openai/gpt-4
DEFAULT_MODEL=anthropic/claude-3-opus
```

### GitHub

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes* | GitHub Personal Access Token for PR creation |

*Required for automatic PR creation during evolution cycles.

### Telegram

| Variable | Required | Description |
|----------|----------|-------------|
| `TG_BOT_TOKEN` | Yes | Telegram Bot Token from @BotFather |
| `OWNER_ID` | Yes | Telegram user ID of the creator (Neo) |

---

## Complete Environment File Example

Create `.env` file in project root:

```bash
# Core system
NODE_ENV=production
LOG_LEVEL=info

# Health monitoring (more sensitive)
HEALTH_MEMORY_WARNING_THRESHOLD=75
HEALTH_MEMORY_CRITICAL_THRESHOLD=90
HEALTH_DISK_WARNING_THRESHOLD=75
HEALTH_DISK_CRITICAL_THRESHOLD=90

# Crash recovery (stricter)
RECOVERY_CRASH_THRESHOLD_MS=10000
RECOVERY_MAX_CRASHES=2

# Session management
CLEANUP_MAX_SESSIONS_TO_KEEP=7

# Agent timeouts (generous for evolution)
AGENT_PROMPT_TIMEOUT_MS=1800000
AGENT_FOLLOWUP_TIMEOUT_MS=1800000

# Consciousness
CONSCIOUSNESS_INTERVAL_SECONDS=10

# AI Model
DEFAULT_MODEL=openai/gpt-4

# Integrations
GITHUB_TOKEN=ghp_your_token_here
TG_BOT_TOKEN=your_bot_token_here
OWNER_ID=your_telegram_id
```

---

## Configuration Validation

All environment variables with numeric values are validated at runtime:

- **Invalid values** are logged as warnings
- **Default values** are used when invalid or not set
- **Range validation** applies to percentage-based values (1-100)

Example log output for invalid configuration:
```
WARN: Invalid HEALTH_MEMORY_WARNING_THRESHOLD value: abc, using default: 85
```

---

*Last updated: Cycle #13 (v0.0.13)*
