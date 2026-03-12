---
name: typescript-language
description: Applies modern TypeScript language standards for type safety, strict mode, generics, and maintainability. Use when editing or writing TypeScript/TSX, defining types, interfaces, enums, unions, generics, type guards, or working with tsconfig and strict typing.
---

# TypeScript Language Patterns

## Priority: P0 (Critical)

## Implementation Guidelines

- **Type annotations**: Explicit params and return types; infer locals.
- **Interfaces vs types**: `interface` for object shapes and APIs; `type` for unions, intersections, and aliases.
- **Strict mode**: Use `strict: true`. Null safety: optional chaining `?.` and nullish coalescing `??`.
- **Enums**: Prefer literal unions or `as const`; avoid runtime `enum`.
- **Generics**: Use for reusable, type-safe code.
- **Type guards**: Use `typeof`, `instanceof`, or user-defined type predicates.
- **Utility types**: Use `Partial`, `Pick`, `Omit`, `Record` and custom utilities as needed.
- **Immutability**: Prefer `readonly` arrays/objects; use const assertions `as const` and `satisfies`.
- **Template literal types**: Use for patterns like `on${Capitalize<T>}`.
- **Discriminated unions**: Use a literal `kind` (or similar) property to discriminate.
- **Advanced**: Mapped, conditional, and indexed access types when appropriate.
- **Access**: Default `public`; use `private`/`protected` or `#private` when needed.
- **Branded types**: Use for nominal typing, e.g. `string & { __brand: 'Id' }`.

## Anti-Patterns

- **No `any`**: Use `unknown` or specific types; never `any`.
- **No `Function`**: Use concrete signatures, e.g. `() => void`.
- **No runtime `enum`**: Use union types or `as const` to avoid runtime cost.
- **No non-null assertion `!`**: Use proper narrowing instead.
- **No lint disables**: Do not use `eslint-disable` or `ts-ignore`; fix issues properly.

## Testing Patterns

- **Mock types**: Use `jest.Mocked<T>` or `as unknown as T`; never `any`.
- **Enums**: Use enum values (e.g. `AppointmentStatus.UPCOMING`) not string literals where the type is an enum.
- **DTOs**: Ensure test data includes all required fields expected by DTOs.
- **Repository mocks**: Mock every repository method used by the code under test (`findOne`, `create`, `save`, `findAndCount`, `createQueryBuilder`, etc.).

## Common Test Issues

| Problem                           | Solution                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| Service method name mismatch      | Check implementation and mock the methods actually called.                                 |
| Error message mismatch            | Use exact messages from shared constants (e.g. `ErrorMessages`).                           |
| Mock missing required properties  | Provide full mocks or use `as unknown as Type` for complex cases.                          |
| `CurrentUser` incomplete in mocks | Include all required fields (`id`, `email`, `subscriptionTier`, `createdAt`, `updatedAt`). |
| Auth/guard mocks failing          | Provide complete service mocks (e.g. `logger`, `userRepository`) or cast via `unknown`.    |
| Wrong controller params           | Match decorators (e.g. `@CurrentUserDecorator()`) and pass the correct types.              |

## Quick Reference

```typescript
// Branded type
type UserId = string & { __brand: "Id" };

// satisfies: validate shape and infer
const cfg = { port: 3000 } satisfies Record<string, number>;

// Discriminated union
type Result<T> = { kind: "ok"; data: T } | { kind: "err"; error: Error };
```

## Additional Resources

For advanced type patterns and utility types, see [reference.md](reference.md).
