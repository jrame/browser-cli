// Self-contained so the exact same function can run directly or through run-code.
module.exports = async function insertionScenario(page, options) {
  const { target, source } = options;
  await page.evaluate(() => ++window.insertionProbe.executions);
  const locator = page.locator(target === 'monaco' ? '.monaco-editor textarea' : '#' + target);
  if (target === 'monaco')
    await page.waitForFunction(() => !!window.editor);
  const read = () => page.evaluate(target => {
    if (target === 'monaco') return window.editor.getModel().getValue();
    const element = document.getElementById(target);
    return target === 'textarea' ? element.value : element.innerText;
  }, target);
  const states = [];
  // Seed real old text so select-all must replace, rather than insert into empty text.
  await locator.focus();
  await page.keyboard.insertText('old text\nà remplacer');
  await locator.press('ControlOrMeta+a');
  await page.evaluate(() => { window.insertionProbe.events = []; });
  for (const phase of ['replace', 'append', 'replace-again']) {
    if (phase === 'replace-again') await locator.press('ControlOrMeta+a');
    const start = await page.evaluate(() => window.insertionProbe.events.length);
    await page.keyboard.insertText(source);
    // Include delayed editor processing before reading the complete model.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    states.push({
      phase, value: await read(),
      dom: target === 'contenteditable' ? await locator.evaluate(element => ({
        html: element.innerHTML, textContent: element.textContent,
        anchorOffset: getSelection().anchorOffset, focusOffset: getSelection().focusOffset,
      })) : null,
      events: await page.evaluate(start => window.insertionProbe.events.slice(start), start),
    });
  }
  return {
    states,
    probe: await page.evaluate(() => ({ executions: window.insertionProbe.executions, listenerInstallations: window.insertionProbe.listenerInstallations })),
    userAgent: await page.evaluate(() => navigator.userAgent),
    modelEOL: target === 'monaco' ? await page.evaluate(() => window.editor.getModel().getEOL()) : null,
  };
};
