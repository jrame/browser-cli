"""Regenerate the oracle from the original Python renderer.

Usage: python tests/fixtures/generate-legacy-atml.py <renderer.py> <unit-tests-directory>
Requires Python's standard library, Node and the checkout's Playwright Chromium.
Application imports are excluded via AST; original methods execute unchanged.
"""

import ast
import hashlib
import html
import json
from pathlib import Path
import re
import sys
import subprocess
from typing import List, Optional


source = Path(sys.argv[1])
unit_tests = Path(sys.argv[2])
module = ast.parse(source.read_text(encoding="utf-8"))
module.body = [node for node in module.body if not isinstance(node, (ast.Import, ast.ImportFrom))]
generator_class = next(node for node in module.body if isinstance(node, ast.ClassDef))
extract_method = next(node for node in generator_class.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "_extract_dom_tree")
extract_js = next(node.value for node in ast.walk(extract_method) if isinstance(node, ast.Constant) and isinstance(node.value, str) and "const parser = new DOMParser()" in node.value)
generator_class.body = [node for node in generator_class.body
                        if not isinstance(node, ast.AsyncFunctionDef)]
namespace = {"re": re, "json": json, "List": List, "Optional": Optional,
             "get_config": lambda: {}}
exec(compile(module, str(source), "exec"), namespace)
generator = namespace["HtmlAtmlGenerator"]


def serialize(node):
    if "_text" in node:
        return html.escape(node["_text"], quote=False)
    tag = node["tag"]
    attrs = dict(node.get("attrs", {}))
    if node.get("_tooltip"):
        attrs["title"] = "Oracle tooltip"
    if node.get("_listeners"):
        attrs["data-has-listener"] = node["_listeners"]
    attribute_text = "".join(f' {key}="{html.escape(value, quote=True)}"' for key, value in attrs.items())
    children = "".join(serialize(child) for child in node.get("children", []))
    return f"<{tag}{attribute_text}>{children}" + ("" if tag in {"input", "img", "br"} else f"</{tag}>")


cases = []


def adapt_render_tree(node, config):
    if "_text" in node:
        return {"text": node["_text"]}
    attrs = node.get("attrs", {})
    allowed = namespace["ATML_ATTRS"] | set(config.get("keep_attrs", [])) | {"onclick"}
    filtered = {key: value for key, value in attrs.items() if key in allowed}
    if node.get("_listeners"):
        filtered["on"] = node["_listeners"]
    return {"tag": node["tag"], "attrs": filtered,
            "kept": not generator._should_flatten(node, config),
            "classes": generator._filter_classes(attrs.get("class", ""), node["tag"] in {"a", "button"}, config),
            "tooltip": bool(node.get("_tooltip")),
            "showTag": node["tag"] in namespace["ALWAYS_KEEP_TAGS"] or node["tag"] in config.get("keep_tags", []),
            "children": [adapt_render_tree(child, config) for child in node.get("children", [])]}


def add(name, tree, origin, config=None, browser=True):
    lines = []
    for child in tree.get("children", []) if tree.get("tag") == "body" else [tree]:
        generator._render_node(child, 1, lines, config or {})
    cases.append({"name": name, "origin": origin, "html": serialize(tree),
                  "config": config or {}, "browser": browser,
                  "tree": tree, "renderTree": adapt_render_tree(tree, config or {}), "expected": "\n".join(lines)})


for filename in ["test_monaco_span_merge.py", "test_atml_steam.py",
                 "test_html_generators.py", "test_html_special_chars.py",
                 "test_html_visible_div_processing.py"]:
    test_path = unit_tests / filename
    parsed = ast.parse(test_path.read_text(encoding="utf-8"))
    # Reuse literal body trees from both AsyncMock(return_value=...) and local
    # assignments. This deliberately avoids reimplementing their expected text.
    index = 0
    for node in ast.walk(parsed):
        if not isinstance(node, ast.Dict):
            continue
        try:
            tree = ast.literal_eval(node)
        except (ValueError, TypeError):
            continue
        if not isinstance(tree, dict) or tree.get("tag") != "body":
            continue
        index += 1
        add(f"{Path(filename).stem}-{index}", tree, f"tests/unit/{filename}")

# Small, explicit probes for formatting rules whose old tests only asserted
# substrings. Expectations still come exclusively from the Python implementation.
add("inline-tag-list-and-css", {"tag": "body", "children": [{"tag": "div", "children": [
    {"tag": "span", "attrs": {"style": "display:block"}, "children": [{"_text": "A"}]},
    {"tag": "span", "children": [{"_text": "B"}]},
    {"tag": "div", "attrs": {"style": "display:inline"}, "children": [{"_text": "C"}]},
    {"tag": "span", "children": [{"_text": "D"}]},
    {"tag": "u", "children": [{"_text": "E"}]},
    {"tag": "span", "children": [{"_text": "F"}]},
]}]}, "html_atml_generator.py::_render_node inline tag list")
add("raw-special-characters", {"tag": "body", "children": [{"tag": "button", "attrs": {"id": "special"},
    "children": [{"_text": '  Été & <code> "你好" \\ fin\u00a0\u00a0'}]}]},
    "tests/unit/test_html_special_chars.py (extended character probe)")
add("onclick-and-listeners", {"tag": "body", "children": [
    {"tag": "div", "attrs": {"onclick": ""}, "_listeners": "click,keydown", "children": [{"_text": "Action"}]},
    {"tag": "span", "attrs": {"role": "button", "onclick": ""}, "_listeners": "click", "children": [{"_text": "Role"}]},
    {"tag": "button", "attrs": {"onclick": ""}, "_listeners": "click", "children": [{"_text": "Native"}]},
]}, "html_atml_generator.py::_render_node event suppression")
add("configured-attrs-and-tags", {"tag": "body", "children": [
    {"tag": "section", "children": [{"_text": "Details"}]},
    {"tag": "button", "attrs": {"data-action": "save"}, "children": [{"_text": "Save"}]},
    {"tag": "div", "attrs": {"data-business": "42", "class": "business-row"}, "children": [{"_text": "Business"}]},
]}, "tests/unit/test_html_generators.py::test_generate_uses_url_specific_atml_config",
    {"keep_attrs": ["data-action", "data-business"], "keep_tags": ["section"], "class_regex": "business"})
add("redundant-and-presentation-roles-renderer-input", {"tag": "body", "children": [
    {"tag": "button", "attrs": {"role": "tab"}, "children": [{"_text": "Button"}]},
    {"tag": "span", "attrs": {"role": "presentation"}, "children": [{"_text": "Presentation"}]},
    {"tag": "span", "attrs": {"role": "button"}, "children": [{"_text": "Click"}]},
]}, "html_atml_generator.py::_render_node role suppression and extraction filtering")
add("configured-shortened-aria", {"tag": "body", "children": [
    {"tag": "div", "attrs": {"id": "anchor", "aria-custom": "secret metadata", "aria-label": "Accessible"},
     "children": [{"_text": "Content"}]},
]}, "html_atml_generator.py attribute filtering before/after aria shortening",
    {"keep_attrs": ["aria-custom"]})

node_script = r"""
const {chromium} = require('playwright');
let input=''; process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  const {cases, extractor} = JSON.parse(input);
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    const trees=[];
    for (const fixture of cases) {
      if (!fixture.browser) { trees.push(null); continue; }
      await page.setContent(fixture.html);
      trees.push(await page.evaluate(({extractor,args}) => (0,eval)('(' + extractor + ')')(args),
        {extractor, args:[fixture.config.keep_attrs || [], fixture.config.remove_selectors || []]}));
    }
    process.stdout.write(JSON.stringify(trees));
  } finally { await browser.close(); }
}).on('error', error => { console.error(error); process.exitCode=1; });
"""
extracted = subprocess.run(["node", "-e", node_script], input=json.dumps({"cases": cases, "extractor": extract_js}),
                           encoding="utf-8", capture_output=True, check=True)
for fixture, tree in zip(cases, json.loads(extracted.stdout)):
    if not fixture["browser"]:
        continue
    lines = []
    for child in tree.get("children", []):
        generator._render_node(child, 1, lines, fixture["config"])
    fixture["browserExpected"] = "\n".join(lines)

output = {"generator": "html_atml_generator.py",
          "generatorSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "cases": cases}
Path(__file__).with_name("legacy-atml.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Generated {len(cases)} fixtures from the original Python renderer")
