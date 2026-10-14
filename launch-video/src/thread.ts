// The drawn thread in beats 1 to 6: the lines an agent writes while it works, and when each one appears.
//
// The text is written for the animatic. Before the final, replace it with text from a real session in the sample
// project.

export type LineKind = 'user' | 'say' | 'tool' | 'out' | 'add' | 'del' | 'think' | 'blank'

/** What the video marks on a line: a question to you, a side note, or something the agent noticed and never said. */
export type Mark = 'question' | 'note' | 'unsaid'

export type Line = { kind: LineKind; text: string; mark?: Mark }

const line = (kind: LineKind, text = '', mark?: Mark): Line => ({ kind, text, ...(mark ? { mark } : {}) })
const blank = line('blank')

export const FIRST_PROMPT = 'Add Apple Pay to the checkout page.'

const OPENING: Line[] = [
  line('user', FIRST_PROMPT),
  blank,
  line('say', "I'll add Apple Pay as a second payment option, next to the card form."),
  blank,
]

const FLOOD: Line[] = [
  line('tool', 'Read(src/checkout.js)'),
  line('out', 'Read 142 lines'),
  line('tool', 'Read(src/payments/stripe.js)'),
  line('out', 'Read 84 lines'),
  blank,
  line('say', 'The checkout page builds its payment options in renderPayment(). I will add an'),
  line('say', 'applePay() option beside cardForm(), with the same shape.'),
  blank,
  line('tool', 'Write(src/payments/applepay.js)'),
  line('out', 'Wrote 3 lines to src/payments/applepay.js'),
  line('add', ' 1 + export function applePay(total) {'),
  line('add', " 2 +   return { kind: 'applepay', label: 'Pay', total }"),
  line('add', ' 3 + }'),
  line('tool', 'Update(src/checkout.js)'),
  line('out', 'Added 2 lines, removed 1 line'),
  line('del', '18 -  const payment = [cardForm()]'),
  line('add', '18 +  const payment = [cardForm(), applePay(page.summary.total)]'),
  line('add', '19 +  // Apple Pay shows only where the browser supports it'),
  blank,
  line('say', 'The button can say "Pay" or "Pay $65.22". Should the Apple Pay button show the', 'question'),
  line('say', 'order total, like the card button does? I left it as "Pay" for now.', 'question'),
  blank,
  line('tool', 'Bash(npm test)'),
  line('out', '> storefront@0.4.0 test'),
  line('out', '✔ checkout renders the card form (3.1ms)'),
  line('out', '✖ checkout lists payment kinds (2.4ms)'),
  line('out', "  expected [ 'card' ] to equal [ 'card', 'applepay' ]"),
  line('tool', 'Update(test/checkout.test.js)'),
  line('del', "41 -  assert.deepEqual(kinds, ['card'])"),
  line('add', "41 +  assert.deepEqual(kinds, ['card', 'applepay'])"),
  line('tool', 'Bash(npm test)'),
  line('out', '✔ 2 tests passed'),
  blank,
  line('think', '∴ Thinking…'),
  line('think', 'tax.js looks up the rate by region, and "CA" matches California, so orders', 'unsaid'),
  line('think', "to Canada get the US tax table. That's not part of this task. I'll leave it.", 'unsaid'),
  blank,
  line('tool', 'Read(src/tax.js)'),
  line('out', 'Read 57 lines'),
  line('tool', 'Read(src/payments/card.js)'),
  line('out', 'Read 63 lines'),
  blank,
  line('say', 'Card payments go through chargeCard() in stripe.js. Apple Pay needs the same call'),
  line('say', 'with a wallet token, so I will rename it to createPayment() and pass the kind.'),
  blank,
  line('tool', 'Update(src/payments/stripe.js)'),
  line('out', 'Added 3 lines, removed 2 lines'),
  line('del', '12 - export async function chargeCard(card, amount) {'),
  line('add', '12 + export async function createPayment(payment, amount) {'),
  line('add', "13 +   const source = payment.kind === 'applepay' ? payment.token : payment.card"),
  line('del', '14 -   const res = await stripe.charges.create({ amount, source: card })'),
  line('add', '14 +   const res = await stripe.charges.create({ amount, source })'),
  line('tool', 'Update(src/checkout.js)'),
  line('out', 'Added 1 line, removed 1 line'),
  line('del', '20 -  const charge = await chargeCard(payment, page.summary.total)'),
  line('add', '20 +  const charge = await createPayment(payment, page.summary.total)'),
  line('tool', 'Bash(grep -rn "chargeCard" src test)'),
  line('out', 'src/payments/stripe.js:31: export const chargeCard = createPayment'),
  blank,
  line('say', 'I kept chargeCard as an alias at the bottom of stripe.js. Keep it as a deprecated', 'question'),
  line('say', 'alias for one release, or drop it now?', 'question'),
  blank,
  line('tool', 'Read(src/summary.js)'),
  line('out', 'Read 40 lines'),
  line('tool', 'Bash(npm test)'),
  line('out', '✔ 2 tests passed'),
  blank,
  line('say', 'Side note: subtotal, shipping and total are summed as floats and never rounded', 'note'),
  line('say', 'to cents, so a total can read 65.22000000000001.', 'note'),
  blank,
  line('tool', 'Read(src/styles/checkout.css)'),
  line('out', 'Read 118 lines'),
  line('tool', 'Update(src/styles/checkout.css)'),
  line('out', 'Added 14 lines'),
  line('add', '88 + .applepay-button {'),
  line('add', '89 +   -webkit-appearance: -apple-pay-button;'),
  line('add', '90 +   -apple-pay-button-type: plain;'),
  line('add', '91 +   -apple-pay-button-style: black;'),
  line('add', '92 +   height: 44px;'),
  line('add', '93 + }'),
  line('add', '94 + @media (prefers-color-scheme: dark) {'),
  line('add', '95 +   .applepay-button { -apple-pay-button-style: white; }'),
  line('add', '96 + }'),
  blank,
  line('tool', 'Bash(ls public/.well-known)'),
  line('out', 'ls: public/.well-known: No such file or directory'),
  blank,
  line('say', 'Apple Pay on the web needs a domain verification file under /.well-known/.', 'question'),
  line('say', 'Should it live in public/, or should the API serve it?', 'question'),
  blank,
  line('tool', 'Read(src/server/routes.js)'),
  line('out', 'Read 96 lines'),
  line('tool', 'Read(src/server/webhooks.js)'),
  line('out', 'Read 74 lines'),
  line('say', 'Webhooks verify the Stripe signature with STRIPE_WEBHOOK_SECRET, which .env sets.'),
  line('tool', 'Update(src/server/webhooks.js)'),
  line('out', 'Added 6 lines'),
  line('add', "31 +    case 'payment_intent.succeeded':"),
  line('add', '32 +      await markPaid(event.data.object.metadata.orderId)'),
  line('add', '33 +      break'),
  line('add', "34 +    case 'payment_intent.payment_failed':"),
  line('add', '35 +      await markFailed(event.data.object.metadata.orderId)'),
  line('add', '36 +      break'),
  blank,
  line('say', 'A failed payment now marks the order failed. Should the order stay as a draft', 'question'),
  line('say', 'so the customer can retry, or be discarded?', 'question'),
  blank,
  line('tool', 'Bash(npm test)'),
  line('out', '✔ checkout renders the card form (2.9ms)'),
  line('out', '✔ checkout lists payment kinds (2.2ms)'),
  line('out', '✔ webhooks mark paid orders (4.0ms)'),
  line('out', '✔ webhooks mark failed orders (3.7ms)'),
  line('out', '✔ 4 tests passed'),
  blank,
  line('tool', 'Update(README.md)'),
  line('out', 'Added 9 lines'),
  line('add', '42 + ## Apple Pay'),
  line('add', '43 + Apple Pay shows on the checkout page in Safari and on iOS.'),
  line('add', '44 + Set STRIPE_APPLE_PAY_MERCHANT_ID before you deploy.'),
  blank,
  line('say', 'Done. Apple Pay is a second payment option on the checkout page, the tests pass,'),
  line('say', "and the README says how to set it up. I haven't committed anything."),
  blank,
]

/** Your reply typed point by point in beat 5. */
export const NUMBERED_REPLY = [
  '1. Yes, show the total on the button',
  '2. Drop chargeCard now',
  '3. Round the totals, and add a test',
  '4. Put the file in public/',
]

const FOLLOW_UP: Line[] = [
  line('say', '1. The button now reads "Pay $65.22". Should the card button match it?', 'question'),
  line('say', '2. I removed the alias. Two tests in test/legacy/ still import chargeCard.', 'question'),
  line('say', '   Update them, or delete them?', 'question'),
  line('tool', 'Update(src/summary.js)'),
  line('out', 'Added 3 lines, removed 1 line'),
  line('say', '3. Totals round to cents now. One snapshot changed. Accept it?', 'question'),
  line('say', '4. The file is in public/.well-known/. It needs uploading to staging too.'),
  blank,
]

/** Where each beat of the thread starts, in seconds of the video, by beat id. */
export type ThreadStarts = {
  'starts-simple': number
  'replies-pile-up': number
  buried: number
  'never-said': number
  'by-hand': number
  again: number
}

/** Seconds per character as you type at the prompt. */
const TYPE_RATE = 1 / 30
/** How long a line takes to fade in and push the thread up. */
export const LINE_IN = 0.12
/** Lines a second at the start of the flood, which then grows so the flood ends 0.2 s before beat 3. */
const FLOOD_START_RATE = 3

export type TimedLine = Line & { appear: number }

/** Every line of the thread, with the second it appears. */
export function threadLines(s: ThreadStarts): TimedLine[] {
  const sentAt = s['starts-simple'] + 1.8
  const opening = OPENING.map((l, i) => ({ ...l, appear: i < 2 ? sentAt : sentAt + 0.5 + 0.4 * (i - 2) }))

  const floodFrom = s['replies-pile-up']
  const floodLength = s.buried - 0.2 - floodFrom
  const growth = growthFor(FLOOD.length, floodLength)
  // The flood's rate grows as e^(growth·t), so line i appears when the lines streamed so far reach i + 1.
  const flood = FLOOD.map((l, i) => ({
    ...l,
    appear: floodFrom + Math.log(1 + ((i + 1) * growth) / FLOOD_START_RATE) / growth,
  }))

  const replySent = numberedReplyTyping(s).sentAt
  const reply = NUMBERED_REPLY.map(text => ({ kind: 'user' as const, text, appear: replySent }))
  const followFrom = Math.max(replySent + 0.5, s.again + 0.2)
  const followUp = [blank, ...FOLLOW_UP].map((l, i) => ({ ...l, appear: followFrom + 0.14 * i }))

  return [...opening, ...flood, ...reply, ...followUp]
}

/** The growth rate at which a flood starting at FLOOD_START_RATE lines a second streams `count` lines in `seconds`. */
function growthFor(count: number, seconds: number): number {
  const streamed = (k: number) => (FLOOD_START_RATE / k) * (Math.exp(k * seconds) - 1)
  let low = 1e-6
  let high = 5
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2
    if (streamed(mid) < count) low = mid
    else high = mid
  }
  return (low + high) / 2
}

/** The flood's lines, as indexes into threadLines, which beat 3 fits on screen. */
export const floodRange = () => ({ from: OPENING.length, to: OPENING.length + FLOOD.length })

function numberedReplyTyping(s: ThreadStarts) {
  const text = NUMBERED_REPLY.join('\n')
  const from = s['by-hand'] + 0.6
  const doneAt = from + text.length * TYPE_RATE
  return { text, from, doneAt, sentAt: doneAt + 0.4 }
}

/** What the prompt holds at second `t`: typed text, cleared when it is sent. */
export function promptText(s: ThreadStarts, t: number): string {
  const typed = (text: string, from: number) => text.slice(0, Math.max(0, Math.floor((t - from) / TYPE_RATE)))
  const firstFrom = s['starts-simple'] + 0.4
  if (t < s['starts-simple'] + 1.8) return typed(FIRST_PROMPT, firstFrom)
  const reply = numberedReplyTyping(s)
  if (t >= reply.from && t < reply.sentAt) return typed(reply.text, reply.from)
  const againFrom = s.again + 3.2
  if (t >= againFrom) return typed('1. ', againFrom)
  return ''
}
