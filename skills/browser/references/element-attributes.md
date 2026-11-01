# Inspecting Element Attributes

When the snapshot doesn't show an element's `id`, `class`, `data-*` attributes, or other DOM properties, use `eval` to inspect them.

## Examples

```bash
browser snapshot default
# snapshot shows a button as :7 but doesn't reveal its id or data attributes

# get the element's id
browser eval default "el => el.id" :7

# get all CSS classes
browser eval default "el => el.className" :7

# get a specific attribute
browser eval default "el => el.getAttribute('data-testid')" :7
browser eval default "el => el.getAttribute('aria-label')" :7

# get a computed style property
browser eval default "el => getComputedStyle(el).display" :7
```
