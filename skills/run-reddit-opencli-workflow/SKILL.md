---
name: run-reddit-opencli-workflow
description: Run the user's low-token Reddit workflow through natural-language requests, using OpenCLI for structured discovery and reading, with Playwright or Codex Chrome only when OpenCLI lacks required data or verification. Use for Reddit full-flow requests, finding posts, reading or translating comments, inbox analysis, candidate selection, rule checks, and confirmed likes, replies, or posts.
---

# Reddit OpenCLI Workflow

Let the user describe the task in Chinese. Do not require them to use terminal commands.

## Tool routing

1. Use `opencli` first for supported read-only Reddit operations.
2. Use compact JSON and bounded result counts.
3. Use Playwright or Codex Chrome only for missing fields, full subreddit rules, unsupported pages, account actions, or visual verification.
4. Do not fetch the same page with both tools when OpenCLI already returned the required data.
5. If OpenCLI fails, make one diagnostic check with `opencli doctor`; then use the existing fallback instead of retrying repeatedly.

Useful commands:

```bash
opencli reddit popular --limit 20 -f json
opencli reddit hot --subreddit <name> --limit 20 -f json
opencli reddit search "<query>" --sort hot --time week --limit 20 -f json
opencli reddit read "<post-id-or-url>" --sort best --limit 15 --depth 2 --replies 3 --max-length 600 -f json
opencli reddit user-comments <username> --limit 15 -f json
```

Project filtering, history checks, and daily targets remain local. Read the current project `AGENTS.md`, `config.json`, `history.json`, and existing daily plan when present.

## Workflow

### 1. Preflight

- Apply the workspace pitfall log and project rules before any external action.
- Confirm OpenCLI connectivity once per run.
- Read `history.json` before selecting candidates; exclude previously handled content.

### 2. Discover and shortlist

- Search the configured industries plus allowed general-interest topics.
- Prefer recent, active, English-language discussions with enough context for an honest response.
- Return only the daily target plus two backups.
- For each candidate, keep title, subreddit, score, comment count, URL, short reason, and only the limited text needed for judgment.
- Treat OpenCLI results as candidates, not proof that an action occurred.

### 3. Check rules before writing

- Before commenting or posting, read the complete subreddit rules, Wiki, pinned guidance, flair requirements, and account eligibility.
- If OpenCLI does not expose them, inspect the logged-in community page with Codex Chrome.
- Do not draft a reply until the rule and eligibility check passes.
- Keep `r/askcarsales` like-only until the account has verified industry flair.

### 4. Draft and confirm

- Reply only to English posts and write the reply in English.
- Keep early replies short, natural, factual, and free of brands, links, contact details, invented experience, or promotional language.
- Show the original text, Chinese translation, proposed English reply, Chinese translation, and selection reason.
- Ask the user to confirm each comment, post, or like while the project confirmation rule remains active.

### 5. Execute once and verify

- Perform only the confirmed action.
- Never bulk-vote, coordinate votes, or use engagement solely to manipulate karma.
- After a like, verify the exact post or comment vote state.
- After a comment or post, verify the account, exact text, permanent link, and absence of removal or pending-review notices.
- If submission state is uncertain, inspect current state before retrying. Never repeat a click blindly.

### 6. Record

- Update local `history.json` only after verification.
- Append the verified result to the dated Obsidian Reddit log, including links, English text, Chinese translation, reason, and anomalies.
- Update the index when a new daily note is created.
- Perform the required retrospective and record reusable failures immediately.

## Token discipline

- Prefer `-f json` and project only the fields needed for the decision.
- Limit post results, comment depth, reply count, and text length at the command boundary.
- Never dump full HTML, full DOM, full accessibility trees, embedded application state, or unbounded comment threads.
- Reuse already collected structured results during the same run.
