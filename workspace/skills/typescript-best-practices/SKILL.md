---
name: typescript-best-practices
description: Applies idiomatic TypeScript patterns for naming, modules, async code, and maintainability. Use when writing or refactoring TypeScript/TSX, organizing imports, defining classes or functions, or working with async/await and modules.
---

# TypeScript Best Practices

## Priority: P1 (Operational)

## Implementation Guidelines

- **Naming**: Classes and types = `PascalCase`; variables and functions = `camelCase`; constants = `UPPER_SNAKE`. Use `I` prefix for interfaces only when it adds clarity.
- **Functions**: Arrow functions for callbacks; regular functions for top-level exports. Always type public API return types.
- **Modules**: Prefer named exports. Import order: external → internal → relative.
- **Async**: Use `async/await`; use `Promise.all()` for parallel work instead of raw Promises where appropriate.
- **Classes**: Use explicit access modifiers; prefer composition; use `readonly` where appropriate.
- **Types**: Use `never` for exhaustiveness; use assertion functions (`asserts`) for runtime checks.
- **Optional**: Use `?:` for optional properties, not `| undefined` when the intent is “may be absent.”
- **Imports**: Use `import type` for type-only imports to improve tree-shaking.

## Anti-Patterns

- **No default exports**: Use named exports.
- **No implicit return types on public API**: Specify return types.
- **No unused variables**: Enable `noUnusedLocals` (and `noUnusedParameters` where applicable).
- **No `require`**: Use ES module `import`.
- **No empty interfaces**: Use a `type` alias or add at least one member.
- **No `any`**: Use strict types or `unknown` with explicit narrowing/casting.
- **Mocking in tests**: Use `jest.Mocked<T>` and cast with `value as unknown as T`; avoid `any`.
- **No lint disables**: Do not use `eslint-disable` or `ts-ignore`; fix the underlying issue.

## Additional Resources

- [reference.md](reference.md) — Project structure, TSConfig, barrel exports.
- [examples.md](examples.md) — Immutable interfaces, exhaustiveness, assertion functions, DI, import order.
