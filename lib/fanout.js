/**
 * Pure helpers for the deterministic fan-out entry point.
 *
 * Separated from `bin/roster-fanout.mjs` so they can be tested without spawning
 * a headless run: one builds the forced prompt, the other reads the child's
 * answer out of a run's NDJSON event stream.
 */

/**
 * The one prompt each run receives. It names the role and the tool, and
 * delimits the item so a weak parent cannot fold the instruction into the task.
 * @param {object} input - role, item, contract, index, total.
 * @returns the prompt text.
 */
export function taskFor({ role, item, contract = '', index = 0, total = 1 }) {
  return [
    `Call the delegate tool exactly once, with role "${role}".`,
    'The child must receive the item below as its task, verbatim. Do not paraphrase it and do not add labels.',
    '',
    '--- item (verbatim) ---',
    item,
    '--- end item ---',
    '',
    contract === '' ? '' : `The child must return exactly this output contract: ${contract}`,
    'Do not do any of the work yourself. Do not call any other tool.',
    `This is item ${index + 1} of ${total}; other items run in separate runs.`,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

const STOP_REASON = /\((error|aborted|refusal|max-tokens)\)/

/**
 * Read the completed `delegate` tool result out of a run's NDJSON events.
 *
 * A run counts as succeeded only when its `delegate` call completed *and* the
 * child finished: the tool result carries the child's stop reason in its first
 * line, so an errored or empty child is a failed item rather than a pass.
 *
 * @param {string} stdout - the run's NDJSON event stream.
 * @param {object} [options] - `expectJson` requires the answer to parse as JSON.
 * @returns {{ok: boolean, output?: string, error?: string}}
 */
export function readChildResult(stdout, { expectJson = false } = {}) {
  let callId
  let result
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'tool_call' && event.tool === 'delegate') callId = event.callId
    if (event.type === 'tool_result' && event.callId === callId) result = event
  }
  if (result === undefined) return { ok: false, error: 'no delegate tool_result in the run' }
  if (result.status !== 'completed') return { ok: false, error: String(result.result ?? result.status) }

  const text = String(result.result ?? '')
  if (STOP_REASON.test(text)) return { ok: false, output: text, error: 'child did not complete' }
  if (/\(no output\)/.test(text)) return { ok: false, output: text, error: 'child produced no output' }

  if (expectJson) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return { ok: false, output: text, error: 'output is not JSON' }
    try {
      JSON.parse(text.slice(start, end + 1))
    } catch {
      return { ok: false, output: text, error: 'output is not JSON' }
    }
  }
  return { ok: true, output: text }
}
