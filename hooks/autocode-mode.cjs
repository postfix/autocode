const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const reminders = {
  keyword: 'The user included "ultracode", opting this turn into multi-agent orchestration. Use the Autocode skill to fulfill the substantive request.',
  full: 'Autocode is on: optimize for the most exhaustive, correct answer, not the fastest or cheapest. Author and run a workflow for every substantive task. Use independent verification and the Autocode quality patterns. Solo work is for conversational or trivial turns.',
  sparse: 'Autocode is still on. Use a workflow for substantive work and check the Autocode quality patterns.',
  exit: 'Autocode is off. Use a workflow again when the user explicitly opts in.',
};

function hasUltracodeKeyword(prompt) {
  if (typeof prompt !== 'string' || prompt.trimStart().startsWith('/')) return false;
  const closing = { '`': '`', '"': '"', '<': '>', '{': '}', '[': ']', '(': ')', "'": "'" };
  const word = char => !!char && /[\p{L}\p{N}_]/u.test(char);
  const spans = [];
  let opener = null, start = 0;
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt[i];
    if (opener) {
      if (opener === '[' && char === '[') start = i;
      if (char === closing[opener] && !(opener === "'" && word(prompt[i + 1]))) {
        spans.push([start, i + 1]);
        opener = null;
      }
    } else if ((char === '<' && /[a-zA-Z/]/.test(prompt[i + 1] ?? '')) ||
      (char === "'" && !word(prompt[i - 1])) ||
      (char !== '<' && char !== "'" && closing[char])) {
      opener = char;
      start = i;
    }
  }
  for (const match of prompt.matchAll(/\bultracode\b/gi)) {
    const start = match.index, end = start + match[0].length;
    if (spans.some(([left, right]) => start >= left && start < right)) continue;
    if (/[\/\\-]/.test(prompt[start - 1] ?? '') || /[\/\\?\-]/.test(prompt[end] ?? '')) continue;
    if (prompt[end] === '.' && word(prompt[end + 1])) continue;
    return true;
  }
  return false;
}

function transition(event, input, state = { on: false, turns: 0 }) {
  if (event === 'SessionStart') {
    if (['startup', 'clear', 'fork'].includes(input.source)) return { state: { on: false, turns: 0 }, message: '' };
    return { state, message: state.on ? reminders.sparse : '' };
  }
  if (event !== 'UserPromptSubmit' || input.source && input.source !== 'user')
    return { state, message: '' };
  if (input.prompt_id && state.lastPromptId === input.prompt_id)
    return { state, message: state.lastMessage ?? '' };

  const prompt = String(input.prompt ?? '').trim();
  let next = { ...state }, message = '';
  if (/^(?:[/@$]?)(?:auto|ultra)code\s+on\b/i.test(prompt)) {
    next = { on: true, turns: 0 };
    message = reminders.full;
  } else if (/^(?:(?:[/@$]?)(?:auto|ultra)code\s+off\b|stop\s+(?:auto|ultra)code\b)/i.test(prompt)) {
    next = { on: false, turns: 0 };
    message = state.on ? reminders.exit : '';
  } else {
    if (state.on) {
      next.turns = (state.turns ?? 0) + 1;
      if (next.turns >= 10) {
        message = reminders.sparse;
        next.turns = 0;
      }
    }
    if (hasUltracodeKeyword(prompt)) message = [reminders.keyword, message].filter(Boolean).join('\n\n');
  }
  if (input.prompt_id) {
    next.lastPromptId = input.prompt_id;
    next.lastMessage = message;
  }
  return { state: next, message };
}

function statePath(input) {
  const session = input.session_id || input.thread_id || input.transcript_path;
  if (typeof session !== 'string' || !session) return null;
  const base = process.env.PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA ||
    path.join(os.homedir(), '.claude', 'autocode-hook-state');
  return path.join(base, 'sessions', createHash('sha256').update(session).digest('hex') + '.json');
}

function formatOutput(event, message, codex = !!process.env.PLUGIN_DATA) {
  return codex
    ? message ? { hookSpecificOutput: { hookEventName: event, additionalContext: message } } : {}
    : message;
}

function handle(event, input) {
  const file = statePath(input);
  let state = { on: false, turns: 0 };
  if (file) try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const outcome = transition(event, input, state);
  if (file && JSON.stringify(outcome.state) !== JSON.stringify(state)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(outcome.state), { mode: 0o600 });
  }
  if (!file && outcome.state.on) outcome.message = 'Autocode session mode needs a hook session ID. Invoke $autocode for this turn.';
  const output = formatOutput(event, outcome.message);
  fs.writeSync(1, typeof output === 'string' ? output : JSON.stringify(output));
}

function run(event) {
  let raw = '', done = false;
  const timer = setTimeout(finish, 1000);
  function finish() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try { handle(event, JSON.parse(raw.replace(/^\uFEFF/, ''))); }
    catch (error) {
      fs.writeSync(2, `Autocode hook: ${error.message}\n`);
      fs.writeSync(1, process.env.PLUGIN_DATA ? '{}' : '');
    }
  }
  process.stdin.on('data', chunk => { if (done) return; raw += chunk; if (raw.length > 1048576) finish(); });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
}

module.exports = { hasUltracodeKeyword, transition, formatOutput, run };
if (require.main === module) run(process.argv[2]);
