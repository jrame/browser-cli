# Complex editors and keyboard focus

An editor's visible code and its keyboard input can be different DOM elements.
A technical textarea can have `display: block`, `visibility: visible` and a
tab index while measuring 0 × 0 pixels. It can receive focus without providing
a pointer surface. This alone does not indicate a bug in click or a stale ref.

Capture a current snapshot and use the reference for the intended input:

```powershell
browser snapshot editor --inline
# Example: :editor-input textarea label="Editor input" value [pointer-box=none]
browser focus editor :editor-input --then type 'Hello' --inline
browser focus editor :editor-input --then press ControlOrMeta+a --then type 'Replacement' --inline
```

`focus` uses the same reference, selector, session and stale-element rules as
other targeted commands. It verifies that the target received focus; a failed
focus stops the chain before typing. `type` and `press` operate on current
keyboard focus. Page scripts can move focus between commands, so inspect the
result when the page manages focus dynamically. For editors with their own
document model, use their supported keyboard or editor APIs and verify the
rendered result.

On native inputs, textboxes and contenteditable elements, `[pointer-box=none]`
is a snapshot observation: no client rectangle has both
positive width and height. It is not a full capability test. The snapshot does
not test occlusion, stability, focusability or whether an editor accepts changes.
Ordinary controls keep their existing representation. Disabled controls retain
references; display/visibility-hidden inputs are omitted. Offscreen and covered
controls may have ordinary boxes. A click can scroll an offscreen control into
view or wait for a temporary cover to disappear.

Click retains Playwright's actionability checks and retries. On timeout, its
original error is followed by DOM observations taken after failure when the
target still resolves: dimensions, pointer box presence, computed display and
visibility, native disabled state, inert ancestry and focus. These observations
describe that moment; they do not prove the cause of every retry. A resolved
target without a pointer box is different from a stale reference. Capture a new
snapshot after a stale-ref error.

Choose `focus` explicitly for keyboard input when appropriate. Click does not
fall back to focus, redirect to an editor container, or force pointer actions.
For further measurements or editor-specific APIs, see
[running custom Playwright code](running-code.md).
