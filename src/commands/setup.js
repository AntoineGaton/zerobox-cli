/**
 * @module commands/setup
 * `zerobox setup`: a short guided flow that connects ZeroBox to the user's
 * own Google OAuth client and writes credentials.json in ZEROBOX_HOME.
 *
 * Plain readline (no Ink) so it works over SSH and in Windows terminals.
 * The Client secret is read without echo and never printed.
 */

import fs from 'fs';
import os from 'os';
import readline from 'readline';
import { Writable } from 'stream';
import chalk from 'chalk';

import { HOME_CREDENTIALS_PATH, TOKEN_PATH, ZEROBOX_HOME } from '../paths.js';
import { SETUP_STEPS, buildCredentials, checkClientId, checkClientSecret, cleanPath, parseClientJson } from '../setup.js';
import { isHeadless } from '../oauth-code.js';

const TRIES = 3;

/**
 * A line reader whose echo can be switched off (for the secret).
 * Lines that arrive early (a paste, piped input) are buffered, not dropped.
 */
function createPrompter() {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const rl = readline.createInterface({ input: process.stdin, output, terminal });
  const lines = rl[Symbol.asyncIterator]();
  let closed = false;
  rl.on('close', () => { closed = true; });

  async function ask(question, { hidden = false } = {}) {
    if (closed) throw new SetupCancelled();
    // Through readline, so redrawing the line (e.g. after Backspace) keeps the question
    rl.setPrompt(question);
    rl.prompt();
    muted = hidden;
    try {
      const { value, done } = await lines.next();
      if (done) throw new SetupCancelled();
      return value.trim();
    } finally {
      muted = false;
      // The Enter key was not echoed either
      if (hidden && terminal) process.stdout.write('\n');
    }
  }

  // Ctrl-C at a prompt: stop cleanly, nothing written
  rl.on('SIGINT', () => {
    process.stdout.write('\n');
    rl.close();
  });

  return { ask, close: () => rl.close() };
}

class SetupCancelled extends Error {
  constructor() {
    super('Setup cancelled. Nothing was saved. Run `zerobox setup` to start again.');
  }
}

async function yesNo(ask, question, def) {
  const hint = def ? 'Y/n' : 'y/N';
  const answer = (await ask(`  ${question} ${chalk.dim(`[${hint}]`)} `)).toLowerCase();
  if (!answer) return def;
  return answer.startsWith('y');
}

function printIntro() {
  console.log('');
  console.log(chalk.bold('  ZeroBox setup') + chalk.dim('  (about 5 minutes, once)'));
  console.log('');
  console.log('  During the beta, ZeroBox signs in to Gmail with your own Google client.');
  console.log('  It is free, takes a few clicks, and means your mail goes only between');
  console.log('  this computer and Google. There is no ZeroBox account or server.');
  console.log('');
  SETUP_STEPS.forEach((step, i) => {
    console.log(`  ${chalk.bold(`${i + 1}.`)} ${step.title}`);
    console.log(`     ${chalk.cyan(step.url)}`);
  });
  console.log('');
  console.log(chalk.dim('  Google will call the app "unverified" when you sign in. That is expected:'));
  console.log(chalk.dim('  it is your own app. Choose Continue.'));
  console.log('');
}

async function clientFromFile(ask) {
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const input = await ask(`  Path to the downloaded JSON ${chalk.dim('(drag the file here)')}: `);
    if (!input) { console.log(chalk.yellow('  Nothing entered.')); continue; }
    let text;
    if (input.startsWith('{')) {
      text = input; // the JSON itself was pasted
    } else {
      const file = cleanPath(input, os.homedir());
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch (err) {
        console.log(chalk.yellow(`  Could not read ${file}: ${err.code === 'ENOENT' ? 'no such file' : err.message}`));
        continue;
      }
    }
    const result = parseClientJson(text);
    if (result.ok) return result;
    if (result.kind === 'web') {
      console.log('');
      console.log(chalk.yellow.bold('  Wrong client type: this is a "Web application" client.'));
      console.log(chalk.yellow('  ZeroBox needs a "Desktop app" client. Create one here, then download its JSON:'));
      console.log(`  ${chalk.cyan(SETUP_STEPS[3].url)}`);
      console.log('');
    } else {
      console.log(chalk.yellow(`  ${result.message}`));
    }
  }
  throw new Error('No usable client after 3 tries. Nothing was saved. Run `zerobox setup` to try again.');
}

async function clientFromTyping(ask) {
  let clientId;
  for (let attempt = 1; !clientId; attempt++) {
    if (attempt > TRIES) throw new Error('No valid Client ID after 3 tries. Nothing was saved.');
    const value = await ask('  Client ID: ');
    const problem = checkClientId(value);
    if (problem) console.log(chalk.yellow(`  ${problem}`));
    else clientId = value;
  }
  let clientSecret;
  for (let attempt = 1; !clientSecret; attempt++) {
    if (attempt > TRIES) throw new Error('No valid Client secret after 3 tries. Nothing was saved.');
    const value = await ask(`  Client secret ${chalk.dim('(hidden as you type)')}: `, { hidden: true });
    const problem = checkClientSecret(value);
    if (problem) console.log(chalk.yellow(`  ${problem}`));
    else clientSecret = value;
  }
  return { clientId, clientSecret };
}

/** Write credentials.json readable only by this user. */
export function saveCredentials(client, file = HOME_CREDENTIALS_PATH) {
  const body = JSON.stringify(buildCredentials(client), null, 2) + '\n';
  fs.writeFileSync(file, body, { mode: 0o600 });
  // mode only applies when the file is created; tighten a replaced one too
  try { fs.chmodSync(file, 0o600); } catch { /* Windows: ACLs, not modes */ }
}

/**
 * Run the wizard.
 * @param {{signIn?: boolean}} [opts]  signIn: false when the caller signs in next anyway
 * @returns {Promise<boolean>} true when a client is saved and ready to use
 */
export async function runSetup({ signIn = true } = {}) {
  if (!process.stdin.isTTY) {
    throw new Error('zerobox setup needs an interactive terminal.');
  }
  const prompter = createPrompter();
  const { ask } = prompter;
  let saved = false;
  let wantSignIn = false;
  let noBrowser = false;
  try {
    printIntro();

    if (fs.existsSync(HOME_CREDENTIALS_PATH)) {
      console.log(`  A Google client is already saved in ${chalk.dim(HOME_CREDENTIALS_PATH)}.`);
      if (!await yesNo(ask, 'Replace it?', false)) {
        console.log(chalk.dim('  Kept the saved client.'));
        saved = true;
      }
    }

    if (!saved) {
      await ask(chalk.dim('  Press Enter once you have the client from step 4. '));
      console.log('');
      console.log('  How do you want to add the client?');
      console.log(`    ${chalk.bold('1')}  Paste the path to the downloaded JSON file ${chalk.dim('(recommended)')}`);
      console.log(`    ${chalk.bold('2')}  Type the Client ID and Client secret`);
      const choice = await ask(`  Choice ${chalk.dim('[1]')}: `);
      console.log('');
      const client = choice === '2' ? await clientFromTyping(ask) : await clientFromFile(ask);

      saveCredentials(client);
      // A token from an older client would fail to refresh: sign in again
      try { fs.unlinkSync(TOKEN_PATH); } catch { /* none */ }
      saved = true;
      console.log('');
      console.log(chalk.green(`  Saved your Google client to ${HOME_CREDENTIALS_PATH}`) + chalk.dim(' (only you can read it).'));
    }

    if (signIn && fs.existsSync(TOKEN_PATH)) {
      console.log(chalk.dim('  You are already signed in. To sign in again, run `zerobox auth`.'));
    } else if (signIn) {
      console.log('');
      if (await yesNo(ask, 'Sign in to Gmail now?', true)) {
        wantSignIn = true;
        const headless = isHeadless();
        console.log('');
        console.log('  How do you want to sign in?');
        console.log(`    ${chalk.bold('1')}  Open a browser on this computer`);
        console.log(`    ${chalk.bold('2')}  Use another device ${chalk.dim('(over SSH, or no browser here)')}`);
        const pick = await ask(`  Choice ${chalk.dim(`[${headless ? 2 : 1}]`)}: `);
        noBrowser = pick ? pick === '2' : headless;
      }
    }
  } catch (err) {
    if (err instanceof SetupCancelled) {
      console.log(chalk.yellow(`\n  ${err.message}\n`));
      return saved;
    }
    throw err;
  } finally {
    prompter.close();
  }

  if (wantSignIn) {
    // '0' also overrides the SSH / no-display detection
    process.env.ZEROBOX_NO_BROWSER = noBrowser ? '1' : '0';
    const { getAuthClient } = await import('../auth.js');
    await getAuthClient();
    console.log(chalk.green('  ZeroBox is connected. Run `zerobox` to scan your inbox.\n'));
  } else if (signIn && saved && !fs.existsSync(TOKEN_PATH)) {
    console.log(chalk.dim(`\n  Next: run \`zerobox\` and press Ctrl-R to scan. You will sign in then.\n  Data folder: ${ZEROBOX_HOME}\n`));
  }
  return saved;
}
