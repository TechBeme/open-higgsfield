## What changed?

Describe the user-facing behavior and the implementation.

## Why?

Explain the problem or issue this solves.

## Validation

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] Desktop UI checked (if applicable)
- [ ] Mobile UI checked (if applicable)
- [ ] Real provider generation checked (if applicable)

## Provider testing

List tested providers/models and explicitly note anything not tested because credentials were unavailable.

## Security checklist

- [ ] No credentials, signed URLs, private prompts or generated user media are included.
- [ ] New environment variables are documented in `.env.example`.
- [ ] API errors remain stable and do not expose internal provider responses.
