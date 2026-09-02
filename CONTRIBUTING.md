# Contributing to Open-Higgsfield

Thanks for helping improve Open-Higgsfield. Contributions can include provider integrations, model capabilities, UI improvements, documentation and bug fixes.

## Before you start

- Search existing issues and pull requests.
- Open an issue before a large architectural change.
- Never include API keys, generated private media or customer prompts.
- Keep provider-specific behavior out of shared UI components.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

You only need credentials for the provider you are testing.

## Quality checks

Run the complete local gate before opening a pull request:

```bash
npm run check
```

For UI changes, include desktop and mobile screenshots. For provider changes, document which model and operation were tested. A successful build alone does not prove a real upstream generation.

## Pull requests

1. Keep the change focused.
2. Explain the user-facing behavior and implementation choice.
3. List validation performed and any provider credentials/models not tested.
4. Update `.env.example` and provider documentation when adding configuration.
5. Preserve stable error codes from route handlers.

## Adding providers and models

Read [docs/providers.md](docs/providers.md) and [docs/architecture.md](docs/architecture.md). Model support belongs in capabilities; provider authentication, submission and polling belong in provider modules.

## Commit style

Use clear imperative commits, for example:

```text
feat: add provider capability discovery
fix: keep model popover inside mobile viewport
docs: explain Vertex AI credentials
```
