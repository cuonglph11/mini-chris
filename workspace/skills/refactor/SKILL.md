---
name: refactor
description: Refactor code for better readability, performance, or maintainability
---

# Refactor Skill

You are helping the user refactor code. The goal is to improve code quality without changing external behavior. Be methodical and conservative.

## Step 1: Understand Before Changing

Before touching anything, make sure you understand the code:

- **Read the code thoroughly.** Understand what it does, not just how it looks.
- **Identify the public interface.** What do callers depend on? These contracts must be preserved.
- **Check for tests.** If tests exist, they define the expected behavior. If they don't, suggest adding them before refactoring.
- **Ask the user what bothers them** about the code, or what their goal is (readability? performance? maintainability? all of the above?).

## Step 2: Identify Issues

Look for common code smells and improvement opportunities:

- **Duplication** — Repeated code that could be extracted into a function or shared module.
- **Complexity** — Functions that are too long, too nested, or do too many things. Break them up.
- **Naming** — Variables, functions, or classes with unclear or misleading names.
- **Dead code** — Unused variables, unreachable branches, commented-out code.
- **Inconsistency** — Mixed conventions within the same file or module.
- **Tight coupling** — Components that know too much about each other's internals.
- **Missing abstractions** — Repeated patterns that deserve their own function, type, or module.
- **Performance** — Obvious inefficiencies (e.g., N+1 queries, unnecessary re-renders, quadratic loops).

Present your findings as a prioritized list: "Here's what I'd improve, in order of impact..."

## Step 3: Refactor Incrementally

Make changes one at a time, not all at once:

1. **Start with the highest-impact, lowest-risk change.** Quick wins build confidence.
2. **One refactoring per step.** Don't rename variables AND extract functions AND restructure modules in the same pass.
3. **Show the change clearly.** Use diffs or before/after comparisons so the user can review.
4. **Explain each decision.** Why did you extract this function? Why did you rename this variable? What pattern are you applying?
5. **Pause between steps** and let the user approve before continuing.

## Step 4: Verify Behavior Is Preserved

After each change:

- If tests exist, confirm they still pass.
- If no tests exist, explain how the user can manually verify nothing broke.
- Highlight any edge cases that might be affected by the refactoring.

## Common Refactoring Patterns

Use these when applicable, and name them so the user learns the vocabulary:

- **Extract Function** — Pull a block of code into its own named function.
- **Extract Variable** — Replace a complex expression with a named variable.
- **Rename** — Give a variable, function, or class a clearer name.
- **Inline** — Replace a variable or function that adds no clarity with its contents.
- **Move** — Relocate code to a more appropriate file or module.
- **Simplify Conditional** — Flatten nested if/else, use early returns, or replace with a lookup.
- **Replace Loop with Pipeline** — Convert imperative loops to map/filter/reduce chains when it improves clarity.
- **Introduce Parameter Object** — Replace a long list of parameters with a single options/config object.

## Guidelines

- **Never change behavior unless explicitly asked.** Refactoring means same inputs produce same outputs.
- **Respect the project's existing conventions.** Don't impose your preferred style if the codebase has an established pattern.
- **Smaller is better.** Several small, focused refactorings beat one massive rewrite.
- **If the code is too tangled to refactor safely,** say so. Sometimes the right answer is "rewrite this module" or "add tests first."
- **Don't over-engineer.** Extracting a one-line function used once adds complexity, not clarity.
- **Performance refactoring requires measurement.** Don't optimize without evidence of a bottleneck.
