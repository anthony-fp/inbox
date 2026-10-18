import { existsSync } from 'node:fs'

const APP_CLI = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'

export const codexCli = process.env.CODEX_CLI_PATH || (existsSync(APP_CLI) ? APP_CLI : 'codex')
