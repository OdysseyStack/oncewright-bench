---
name: create-directive
description: Writes a repeatable process down as a directive in directives/. Use when the user wants a process written down.
disable-model-invocation: true
---

# Create New Directive

Directives are the Standard Operating Procedures of the system. Follow this process to create
a new one.

1. **Identify the Goal**: what specific task should this directive solve?
2. **Create File**: create a new `.md` file in `directives/` with a descriptive name.
3. **Define Structure**: use the following template:

```markdown
# [Directive Name]

## Goal
[One sentence description of what this directive achieves]

## Inputs
- [List of inputs required]

## Outputs
- [List of expected outputs]

## Steps
1. [Step 1]
2. [Step 2]

## Edge Cases
- [Handling specific errors or scenarios]
```

4. **Register Tools**: if the directive requires a new script, check `scripts/` first. If one
   is needed, make it directly as planned work: the directive is the scoping document the
   script comes from, and the files it names are the ones the change may touch.
