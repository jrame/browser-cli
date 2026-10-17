# Inspecting Element Attributes

When the snapshot doesn't show an element's `id`, `class`, `data-*` attributes, or other DOM properties, use `eval` to inspect them.

## Examples

```bash
browser snapshot
# snapshot shows a button as :7 but doesn't reveal its id or data attributes

# get the element's id
browser eval "el => el.id" :7

# get all CSS classes
browser eval "el => el.className" :7

# get a specific attribute
browser eval "el => el.getAttribute('data-testid')" :7
browser eval "el => el.getAttribute('aria-label')" :7

# get a computed style property
browser eval "el => getComputedStyle(el).display" :7
```
