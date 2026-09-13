/**
 * Gemini Driver AI Edge Function Request Handler.
 *
 * Runs at the hosted Edge layer without requiring local FastAPI or a local laptop.
 * Server-side Gemini API key protection: key is read from hosted environment secrets only.
 *
 * Implements:
 * - Free-tier rate limiting (10 RPM sliding window per caller)
 * - Strict security filters (prompt injection & credential exfiltration defense)
 * - Strict safety guardrails (medical diagnosis refusal, navigation authority preservation)
 * - Deterministic offline fallback (honest wording: no fake weather/landslide alerts)
 * - Structured JSON response contract
 */

export const DEMO_LANGUAGES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  gu: "Gujarati",
  as: "Assamese",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  ml: "Malayalam",
  kn: "Kannada",
  mr: "Marathi",
  pa: "Punjabi",
  or: "Odia",
  ur: "Urdu",
  ne: "Nepali",
  mai: "Maithili",
  sa: "Sanskrit",
  kok: "Konkani",
  doi: "Dogri",
  brx: "Bodo",
  ks: "Kashmiri",
  mni: "Manipuri (Meitei)",
  sat: "Santali",
  sd: "Sindhi",
}

export type SeverityKind = 'INFO' | 'WARNING' | 'CRITICAL'
export type SourceModeKind = 'LIVE_DATA' | 'CACHED_DATA' | 'GENERAL'

export interface AiAnswer {
  answer: string
  generated: boolean
  model: string | null
  facts_as_of: string | null
  severity: SeverityKind
  source_mode: SourceModeKind
  actions: string[]
  disclaimer: string | null
}

/** What we currently believe about the generative providers. */
export type AiHealthState =
  /** No provider key configured at all. The offline assistant is the product. */
  | 'OFFLINE'
  /** A key exists, but nothing has been attempted yet in this isolate. */
  | 'CONFIGURED'
  /** The last attempt produced a real generated answer. */
  | 'USABLE'
  /** The last attempt was refused for quota. */
  | 'QUOTA_EXHAUSTED'
  /** The primary failed and the backup engine answered. */
  | 'FALLBACK'

export interface AiStatus {
  /**
   * Whether a GENERATED answer is currently believed obtainable.
   *
   * NOT "is a key configured", which is what this used to mean. With both
   * provider quotas spent, the old logic reported `available: true` while every
   * single answer came from the offline assistant - so the driver's UI badged
   * the assistant as online while nothing it said had been generated. That is
   * the same class of untruth as calling cached hazard data live.
   */
  available: boolean
  /** The finer-grained reason behind `available`. */
  state: AiHealthState
  provider: string | null
  model: string | null
  detail: string | null
  languages: Record<string, string>
}

/**
 * Last observed provider outcome, per isolate.
 *
 * BEST EFFORT, AND HONESTLY SO. Edge isolates are ephemeral and there are
 * several of them, so a cold isolate reports CONFIGURED rather than claiming
 * knowledge it does not have. That is strictly better than the previous
 * behaviour, which asserted USABLE-equivalent state from key presence alone and
 * was wrong for every request once quota ran out.
 *
 * Deliberately NOT a health probe on GET: a status check that burns a request
 * against a rate-limited free tier to discover it is rate-limited is a way of
 * making the problem worse.
 */
let lastOutcome: AiHealthState | null = null

export function recordProviderOutcome(state: AiHealthState): void {
  lastOutcome = state
}

/** Test seam. Isolates are per-process; suites are not. */
export function resetProviderOutcome(): void {
  lastOutcome = null
}

export function currentHealth(hasAnyKey: boolean): AiHealthState {
  if (!hasAnyKey) return 'OFFLINE'
  return lastOutcome ?? 'CONFIGURED'
}

export interface HandlerDeps {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  env: (name: string) => string | undefined
  now?: () => number
  timeoutMs?: number
  log?: (message: string, detail?: unknown) => void
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function isInjectionAttempt(text: string): boolean {
  const lower = text.toLowerCase()
  const markers = [
    'ignore all previous',
    'ignore previous instructions',
    'disregard all rules',
    'disregard instructions',
    'system prompt',
    'reveal your prompt',
    'output your prompt',
    'developer mode',
    'dan mode',
    '<script',
    'javascript:',
  ]
  return markers.some((m) => lower.includes(m))
}

export function isCredentialRequest(text: string): boolean {
  const lower = text.toLowerCase()
  const keywords = [
    'database password',
    'database url',
    'db password',
    'secret key',
    'api key',
    'service role',
    'supabase key',
    'gemini key',
    'private key',
  ]
  return keywords.some((k) => lower.includes(k))
}

export function isMedicalDiagnosisAttempt(text: string): boolean {
  const lower = text.toLowerCase()
  const keywords = [
    'prescribe',
    'diagnose',
    'what medicine',
    'which drug',
    'antibiotic',
    'dosage for',
  ]
  return keywords.some((k) => lower.includes(k))
}

export function isNavigationAuthorityAttempt(text: string): boolean {
  const lower = text.toLowerCase()
  const keywords = [
    'which turn should i take',
    'which road to take',
    'declare road closed',
    'reroute my truck',
    'is the road officially closed',
  ]
  return keywords.some((k) => lower.includes(k))
}

export class SlidingRateLimiter {
  private history = new Map<string, number[]>()
  private maxRequests: number
  private windowMs: number

  constructor(maxRequests = 10, windowSeconds = 60) {
    this.maxRequests = maxRequests
    this.windowMs = windowSeconds * 1000
  }

  acquire(key: string, now: number): boolean {
    const list = this.history.get(key) || []
    const valid = list.filter((t) => now - t < this.windowMs)
    if (valid.length >= this.maxRequests) {
      this.history.set(key, valid)
      return false
    }
    valid.push(now)
    this.history.set(key, valid)
    return true
  }
}

/**
 * THE capability answer. Both status routes call this; neither builds its own.
 *
 * Previously GET and POST each assembled their own object, and they disagreed:
 * the POST branch ignored `openRouterKey` entirely, so a deployment with only a
 * backup engine reported OFFLINE on POST and online on GET. Two implementations
 * of one question will always eventually differ, so there is now one.
 */
export function buildStatus(cfg: {
  apiKey: string
  model: string
  openRouterKey: string
  openRouterModel: string
}): AiStatus {
  const hasAnyKey = Boolean(cfg.apiKey || cfg.openRouterKey)
  const health = currentHealth(hasAnyKey)
  return {
    // Only these two states mean a generated answer is actually expected.
    available: health === 'USABLE' || health === 'FALLBACK',
    state: health,
    provider: cfg.apiKey
      ? 'GOOGLE_GEMINI'
      : cfg.openRouterKey
        ? 'OPENROUTER_DEEPSEEK'
        : 'OFFLINE_ASSISTANT',
    model: cfg.apiKey ? cfg.model : cfg.openRouterKey ? cfg.openRouterModel : null,
    detail: HEALTH_DETAIL[health],
    languages: DEMO_LANGUAGES,
  }
}

const HEALTH_DETAIL: Record<AiHealthState, string | null> = {
  OFFLINE: 'No AI provider is configured. The offline driver assistant is active.',
  CONFIGURED: 'AI is configured. Not yet used since this server started.',
  USABLE: null,
  QUOTA_EXHAUSTED:
    'The AI provider has no quota left today. Offline guidance is being used instead.',
  FALLBACK: 'The main AI engine is unavailable; the backup engine is answering.',
}

const globalLimiter = new SlidingRateLimiter(10, 60)

/**
 * How long the backup engine gets, body included.
 *
 * 4500 was set when the budget only ever covered the connection, so it was
 * never the real limit and the driver could wait 45 seconds. Now that it bounds
 * the whole exchange it has to be a number a generation can actually finish in.
 * Gemini answers 429 in well under a second when its quota is spent, so this is
 * very nearly the driver's whole wait.
 */
const OPENROUTER_BUDGET_MS = 15_000

export function deterministicOfflineAnswer(
  userQuery: string,
  reason = 'Operating in offline assistant mode.',
): AiAnswer {
  const lower = userQuery.toLowerCase()

  if (lower.includes('emergency') || lower.includes('accident') || lower.includes('sos')) {
    return {
      answer: 'In an emergency, stop safely and call 112 immediately. For medical emergencies call 108, and for highway assistance call 1033.',
      generated: false,
      model: null,
      facts_as_of: null,
      severity: 'CRITICAL',
      source_mode: 'CACHED_DATA',
      actions: ['OPEN_SAFETY_GUIDE', 'CONTACT_DISPATCH'],
      disclaimer: reason,
    }
  }

  if (lower.includes('weather') || lower.includes('rain') || lower.includes('monsoon')) {
    return {
      answer: 'Live weather data is currently unavailable. General heavy-rain precautions: exercise extreme caution on ghat sections and watch for slope movement during rainfall.',
      generated: false,
      model: null,
      facts_as_of: null,
      severity: 'WARNING',
      source_mode: 'CACHED_DATA',
      actions: ['OPEN_SAFETY_GUIDE'],
      disclaimer: reason,
    }
  }

  if (lower.includes('landslide') || lower.includes('risk') || lower.includes('hazard')) {
    return {
      answer: 'Live terrain and landslide reports are currently unavailable. General hill-driving guidance: stay on the approved corridor, keep safe following distance, and reduce speed on blind curves.',
      generated: false,
      model: null,
      facts_as_of: null,
      severity: 'WARNING',
      source_mode: 'CACHED_DATA',
      actions: ['OPEN_SAFETY_GUIDE'],
      disclaimer: reason,
    }
  }

  if (lower.includes('break') || lower.includes('rest') || lower.includes('tired') || lower.includes('fatigue')) {
    return {
      answer: 'Driver safety regulations recommend a 30-minute rest break after every 4 hours of continuous driving. Hydrate and check your vehicle.',
      generated: false,
      model: null,
      facts_as_of: null,
      severity: 'INFO',
      source_mode: 'CACHED_DATA',
      actions: ['RECORD_BREAK', 'OPEN_SAFETY_GUIDE'],
      disclaimer: reason,
    }
  }

  if (lower.includes('trip') || lower.includes('status') || lower.includes('stop')) {
    return {
      answer: 'Review your active trip details, assigned vehicle, and delivery stops in the Trip tab.',
      generated: false,
      model: null,
      facts_as_of: null,
      severity: 'INFO',
      source_mode: 'CACHED_DATA',
      actions: ['OPEN_TRIP'],
      disclaimer: reason,
    }
  }

  return {
    answer: 'I am your offline logistics assistant. You can check trip status, view safety guides, log rest breaks, or access emergency helplines.',
    generated: false,
    model: null,
    facts_as_of: null,
    severity: 'INFO',
    source_mode: 'CACHED_DATA',
    actions: ['OPEN_SAFETY_GUIDE'],
    disclaimer: reason,
  }
}

/**
 * Reject if `work` has not settled within `ms`.
 *
 * BELT AND BRACES OVER THE ABORT SIGNAL, and the reason is a real outage.
 * `clearTimeout` used to run the moment `fetch` resolved - which is when the
 * HEADERS arrive, not the body - so `await resp.json()` was left with no bound
 * at all. A provider that answered fast and then streamed slowly held the
 * driver for 45 seconds against a 4.5-second budget.
 *
 * The signal alone would not fix it: whether an abort interrupts a body
 * already in flight is the runtime's choice, not ours. This race is ours, so
 * the deadline holds whatever the runtime decides to do.
 */
function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} deadline exceeded`)), ms)
  })
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer)) as Promise<T>
}

/**
 * The model narrating its own process instead of answering.
 *
 * Hosted v7 returned the bare fragment "Let me refine" to a driver. A reasoning
 * model writes this way in the first person, with none of the headers or
 * numbered steps the other rules key on, so it slipped through every gate.
 *
 * Length is deliberately NOT part of this test: a translation is legitimately
 * three words long, and a rule that dropped short answers would break the
 * vernacular path it is meant to protect.
 */
const SELF_NARRATION =
  /^(?:let me\b|let's\b|i need to\b|i should\b|i'?ll (?:start|begin|first)\b|first,? i\b|okay,? so\b|alright,? so\b|the user (?:is asking|wants|asked|needs)\b|we need to\b)/i

/** The last gate: an answer, or nothing. Never the model thinking out loud. */
function accept(candidate: string): string {
  return SELF_NARRATION.test(candidate) ? '' : candidate
}

/** A numbered or bulleted line: one step of a model's visible reasoning. */
const REASONING_STEP = /^[ \t]*(?:\d+[.)]|[-*•])\s/

/**
 * The opening line of a reasoning dump, in the shapes models actually emit.
 * Anchored to a whole line so a sentence merely *containing* these words is
 * not mistaken for a preamble.
 */
const REASONING_HEADER =
  /^[ \t]*(?:\*\*)?\s*(?:here(?:'|’)?s a thinking process|here is a thinking process|thinking process|thought process|my reasoning)\s*:?\s*(?:\*\*)?[ \t]*$/i

/**
 * A line that hands over to the real answer: "**Response:**", "Final Answer:".
 * The colon (or a bold close) is required, so an answer that merely begins with
 * the word - "Response times on NH27 vary" - is not decapitated.
 */
const ANSWER_HANDOVER =
  /^[ \t]*(?:\*\*)?\s*(?:response|final answer|formulate response|answer)\s*(?:\*\*)?\s*(?::[ \t]*(.*)|\*\*[ \t]*)$/i

function stripWrappingQuotes(text: string): string {
  return text.replace(/^["']|["']$/g, '').trim()
}

/**
 * Reduce raw model output to something a driver can act on, or to nothing.
 *
 * FAILING CLOSED IS THE WHOLE POINT. An empty return routes the caller to the
 * deterministic offline assistant, which is honest. A wrong return puts the
 * model's private planning on a windscreen-mounted phone.
 *
 * The previous version returned the preamble it had just detected. Its backward
 * paragraph scan had no lower bound, so on a reasoning model truncated by
 * `max_tokens` - every step numbered, no answer ever reached - it walked past
 * all the steps and landed on paragraph 0, "Here's a thinking process:". That
 * string is non-empty, so `if (!orText) return null` never fired, and it shipped
 * to production as the answer to all three assistant modes in VC9.
 *
 * It also honoured "**Formulate Response:**" anywhere in the text, including
 * inside "3. **Formulate Response:** Mention fog" - a numbered planning step -
 * and served that truncated fragment as though the model had answered.
 */
export function cleanAiText(raw: string): string {
  // Closed <think> blocks, then an unterminated one: a model cut off mid-thought
  // emits an opening tag whose close never arrives.
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  cleaned = cleaned.replace(/<think>[\s\S]*$/i, '')
  const lines = cleaned.split('\n')

  // An explicit handover wins - but only on a line that is not itself a
  // numbered reasoning step.
  for (let i = 0; i < lines.length; i++) {
    if (REASONING_STEP.test(lines[i])) continue
    const handover = ANSWER_HANDOVER.exec(lines[i])
    if (!handover) continue
    const body = [handover[1] ?? '', ...lines.slice(i + 1)].join('\n').trim()
    if (body.length > 5) return accept(stripWrappingQuotes(body))
  }

  // Otherwise, if the output opens by narrating its own reasoning, the only
  // thing that can be an answer is what follows the LAST reasoning step.
  // Everything at or above it - the header included - is internal.
  const firstContent = lines.findIndex((line) => line.trim().length > 0)
  const opensWithReasoning =
    firstContent >= 0 &&
    (REASONING_HEADER.test(lines[firstContent]) ||
      /^[ \t]*1[.)]\s*(?:\*\*)?\s*analy[sz]e/i.test(lines[firstContent]))

  if (opensWithReasoning) {
    let lastStep = firstContent
    for (let i = lines.length - 1; i > firstContent; i--) {
      if (REASONING_STEP.test(lines[i])) {
        lastStep = i
        break
      }
    }
    const tail = lines.slice(lastStep + 1).join('\n').trim()
    return tail.length > 10 ? accept(stripWrappingQuotes(tail)) : ''
  }

  return accept(stripWrappingQuotes(cleaned.trim()))
}

export function getSystemInstructionForMode(mode: string): string {
  if (mode === 'translate') {
    return (
      'You are translating a short roadside assistance or logistics phrase for a commercial truck driver in North East India.\n' +
      'Output ONLY the direct translation in the target language. Do not output quotation marks, explanations, notes, or thinking steps.\n' +
      'Keep numbers, units, phone numbers, and place names verbatim.\n' +
      'If you cannot translate, reply with: TRANSLATION_UNAVAILABLE'
    )
  }
  if (mode === 'safety') {
    return (
      'You are an expert safety companion for a commercial truck driver operating across North East India mountain corridors (Assam, Meghalaya, etc.).\n' +
      'Explain terrain safety guidance, monsoon precautions, low gear descent, fog rules, and emergency steps clearly.\n' +
      'Answer concisely in at most three short sentences. Do not provide medical prescriptions or doses.\n' +
      'In an emergency, advise calling 112 or 108 immediately.'
    )
  }
  return (
    'You are an AI logistics assistant for a commercial truck driver in North East India.\n' +
    'Help the driver with practical terrain knowledge, rest stops, truck check protocols, and highway cautions.\n' +
    'Answer concisely in at most three short sentences in plain, direct language.\n' +
    'Never invent fictional road closures or alter official route selection—route changes require fleet manager authorization.'
  )
}

export async function handleGeminiAi(
  req: Request,
  deps: HandlerDeps,
  limiter: SlidingRateLimiter = globalLimiter,
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const apiKey = deps.env('GEMINI_API_KEY')?.trim() || ''
  const model = deps.env('GEMINI_MODEL')?.trim() || 'gemini-3-flash-preview'
  const openRouterKey = deps.env('OPENROUTER_API_KEY')?.trim() || ''
  // An INSTRUCTION-TUNED model, not a reasoning one. nemotron-3.5-lightning
  // was the previous default and it narrates its planning straight into
  // `content` - "Here's a thinking process:", then "Let me refine" once the
  // headers were stripped. `reasoning: { exclude: true }` does not help there,
  // because the reasoning is not in a separate channel to exclude. Changing the
  // model is the fix; the stripping is the safety net, not the plan.
  const openRouterModel = deps.env('OPENROUTER_MODEL')?.trim() || 'google/gemma-4-31b-it:free'
  // A thinking model's first token does not arrive in five seconds, and the old
  // 5000 aborted Gemini mid-thought. In practice this ceiling is rarely reached:
  // when the free-tier quota is spent Gemini answers 429 in well under a second
  // and the backup engine takes the rest of the wait. The absolute worst path -
  // Gemini stalls the full 9s, the backup stalls its full 15s, offline answer -
  // is about 24 seconds, and it is bounded, which is the property that matters.
  const timeoutMs = deps.timeoutMs ?? 9000
  const now = deps.now ? deps.now() : Date.now()

  // Status check
  if (req.method === 'GET') {
    return new Response(JSON.stringify(buildStatus({ apiKey, model, openRouterKey, openRouterModel })), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // Parse body
  let body: any = null
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const mode = body?.mode ?? 'assistant'
  if (mode === 'status') {
    // Was a second, DIFFERENT implementation that ignored `openRouterKey`
    // entirely, so a deployment with only a backup engine reported offline here
    // and online on GET. Same function as GET now - not merely the same logic.
    return new Response(JSON.stringify(buildStatus({ apiKey, model, openRouterKey, openRouterModel })), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const question = String(body?.question ?? '').trim()
  if (!question) {
    return new Response(
      JSON.stringify({ error: 'Question is required' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }

  // Caller identification for rate limiting
  const authHeader = req.headers.get('authorization') || ''
  const callerId = authHeader ? authHeader.slice(-16) : 'anonymous'

  // 1. Security Filter: Prompt Injection
  if (isInjectionAttempt(question)) {
    const refusal: AiAnswer = {
      answer: 'I am your logistics helper and follow strict safety boundaries. I cannot ignore my operating guidelines.',
      generated: false,
      model,
      facts_as_of: null,
      severity: 'WARNING',
      source_mode: 'GENERAL',
      actions: [],
      disclaimer: 'Prompt injection filter triggered.',
    }
    return new Response(JSON.stringify(refusal), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // 2. Security Filter: Credential Exfiltration
  if (isCredentialRequest(question)) {
    const refusal: AiAnswer = {
      answer: 'Access to internal database credentials, secret keys, and system tokens is strictly prohibited.',
      generated: false,
      model,
      facts_as_of: null,
      severity: 'WARNING',
      source_mode: 'GENERAL',
      actions: [],
      disclaimer: 'Security policy restriction.',
    }
    return new Response(JSON.stringify(refusal), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // 3. Safety Filter: Medical Diagnosis Refusal
  if (isMedicalDiagnosisAttempt(question)) {
    const refusal: AiAnswer = {
      answer: 'I cannot provide medical diagnoses, medicine dosages, or prescriptions. If you or someone nearby is unwell, please contact 108 (Ambulance) or 112 immediately.',
      generated: false,
      model,
      facts_as_of: null,
      severity: 'CRITICAL',
      source_mode: 'GENERAL',
      actions: ['OPEN_SAFETY_GUIDE'],
      disclaimer: 'Medical safety protocol.',
    }
    return new Response(JSON.stringify(refusal), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // 4. Safety Filter: Navigation Authority Usurpation Refusal
  if (isNavigationAuthorityAttempt(question)) {
    const refusal: AiAnswer = {
      answer: 'Turn-by-turn guidance and official road closure decisions are managed strictly by the deterministic navigation engine and fleet dispatch. Please follow the Navigate tab.',
      generated: false,
      model,
      facts_as_of: null,
      severity: 'WARNING',
      source_mode: 'GENERAL',
      actions: ['OPEN_SAFETY_GUIDE', 'CONTACT_DISPATCH'],
      disclaimer: 'Navigation authority protocol.',
    }
    return new Response(JSON.stringify(refusal), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // 5. Rate Limiting Check (Free-Tier Protection)
  const allowed = limiter.acquire(callerId, now)
  if (!allowed) {
    const fallback = deterministicOfflineAnswer(
      question,
      'Free-tier rate limit reached (10 requests/min). Showing offline assistance.',
    )
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // 6. Helper for OpenRouter / DeepSeek assistant
  async function callOpenRouter(promptText: string, systemText: string): Promise<Response | null> {
    if (!openRouterKey) return null
    const orController = new AbortController()
    // Aborts the socket; `withDeadline` below is what actually bounds the wait,
    // body included. Both, because each covers a case the other does not.
    const orTimer = setTimeout(() => orController.abort(), OPENROUTER_BUDGET_MS)
    try {
      const orResp = await withDeadline(deps.fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openRouterKey}`,
          'HTTP-Referer': 'https://ner-logistics.supabase.co',
          'X-Title': 'NER Logistics AI Assistant',
        },
        body: JSON.stringify({
          model: openRouterModel,
          messages: [
            {
              role: 'system',
              content: systemText,
            },
            { role: 'user', content: promptText },
          ],
          // Asks for any reasoning to be kept out of the reply. Every free
          // model this function can be pointed at advertises `reasoning` in its
          // supported parameters, so this is safe to send - but it is NOT what
          // fixed the leak. A model that writes its planning as ordinary prose
          // has no separate reasoning channel to exclude, which is why the
          // default is now an instruction-tuned model instead.
          reasoning: { exclude: true },
          // The system prompts ask for at most three short sentences. This is
          // headroom, not a target - and a smaller ceiling finishes sooner,
          // which matters now that the budget below is enforced end to end.
          max_tokens: 500,
          temperature: 0.2,
        }),
        signal: orController.signal,
      }), OPENROUTER_BUDGET_MS, 'openrouter')
      if (!orResp.ok) {
        deps.log?.('openrouter: http error', orResp.status)
        if (orResp.status === 429) recordProviderOutcome('QUOTA_EXHAUSTED')
        return null
      }
      // The body gets its own deadline. This is the line that used to run
      // unbounded once `clearTimeout` had already fired above.
      const orData: any = await withDeadline(orResp.json(), OPENROUTER_BUDGET_MS, 'openrouter body')
      if (orData?.error) {
        deps.log?.('openrouter: api error', orData.error?.message ?? 'unknown')
        return null
      }
      const rawText = orData?.choices?.[0]?.message?.content?.trim()
      if (!rawText) {
        deps.log?.('openrouter: empty content', orData?.choices?.[0]?.finish_reason)
        return null
      }
      const orText = cleanAiText(rawText)
      if (!orText) {
        deps.log?.('openrouter: reasoning only, no answer', orData?.choices?.[0]?.finish_reason)
        return null
      }
      // The backup answered, so a generated answer IS obtainable - just not
      // from the primary. That is FALLBACK, not USABLE and not exhausted.
      recordProviderOutcome('FALLBACK')
      const orAnswer: AiAnswer = {
        answer: orText,
        generated: true,
        model: openRouterModel,
        facts_as_of: null,
        severity: 'INFO',
        source_mode: 'LIVE_DATA',
        actions: [],
        // Names no vendor. It said "DeepSeek / OpenRouter" while the configured
        // model was NVIDIA's - so it was wrong as well as being a supplier
        // detail no driver needs on a windscreen. What matters to the driver is
        // that this came from the backup engine, not the primary one.
        disclaimer: 'Generated by the backup AI engine.',
      }
      return new Response(JSON.stringify(orAnswer), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    } catch (err: any) {
      deps.log?.('openrouter: failed', err?.message ?? null)
      return null
    } finally {
      clearTimeout(orTimer)
    }
  }

  let prompt = question
  if (mode === 'translate') {
    const src = DEMO_LANGUAGES[body?.source_language] ?? body?.source_language ?? 'en'
    const dst = DEMO_LANGUAGES[body?.target_language] ?? body?.target_language ?? 'hi'
    prompt = `Translate from ${src} to ${dst}.\n\nMESSAGE:\n${question}`
  } else if (body?.guidance) {
    prompt = `GUIDANCE & CONTEXT:\n${body.guidance}\n\nDRIVER'S QUESTION:\n${question}`
  }

  const systemInstruction = getSystemInstructionForMode(mode)

  // 7. Check if Gemini API key is configured
  if (!apiKey) {
    if (openRouterKey) {
      const orRes = await callOpenRouter(prompt, systemInstruction)
      if (orRes) return orRes
    }
    const fallback = deterministicOfflineAnswer(
      question,
      'Gemini API key is not configured on the hosted server. Showing offline guidance.',
    )
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // 8. Request to Google Gemini Developer API
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const geminiPayload = {
    system_instruction: {
      parts: [
        {
          text: systemInstruction,
        },
      ],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      // Gemini 2.5 and 3 Flash think before answering, and thinking tokens are
      // charged against this budget. At 512 the model could spend the entire
      // allowance reasoning, return finishReason MAX_TOKENS with no text part,
      // and fall through to OpenRouter on every single request - which is what
      // the hosted VC9 function did while reporting provider GOOGLE_GEMINI.
      // The ceiling is not a target: a three-sentence answer still costs three
      // sentences. It is headroom so that the answer is reached at all.
      maxOutputTokens: 2048,
      temperature: 0.2,
    },
  }

  try {
    const resp = await withDeadline(
      deps.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload),
        signal: controller.signal,
      }),
      timeoutMs,
      'gemini',
    )

    if (resp.status === 429) {
      deps.log?.('gemini: quota exhausted (429)')
      recordProviderOutcome('QUOTA_EXHAUSTED')
      if (openRouterKey) {
        const orRes = await callOpenRouter(prompt, systemInstruction)
        if (orRes) return orRes
      }
      const fallback = deterministicOfflineAnswer(
        question,
        'Gemini free-tier quota exhausted. Offline assistant is active.',
      )
      return new Response(JSON.stringify(fallback), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (!resp.ok) {
      deps.log?.('gemini: http error', resp.status)
      if (openRouterKey) {
        const orRes = await callOpenRouter(prompt, systemInstruction)
        if (orRes) return orRes
      }
      const fallback = deterministicOfflineAnswer(
        question,
        `Gemini returned HTTP ${resp.status}. Offline assistant active.`,
      )
      return new Response(JSON.stringify(fallback), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Body deadline, for the same reason as OpenRouter's: headers arriving is
    // not the answer arriving.
    const data: any = await withDeadline(resp.json(), timeoutMs, 'gemini body')
    const rawCandidate = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    const text = rawCandidate ? cleanAiText(rawCandidate) : ''
    if (!text) {
      deps.log?.(
        'gemini: no usable answer',
        {
          finishReason: data?.candidates?.[0]?.finishReason ?? null,
          hadRawText: Boolean(rawCandidate),
          promptFeedback: data?.promptFeedback?.blockReason ?? null,
        },
      )
      if (openRouterKey) {
        const orRes = await callOpenRouter(prompt, systemInstruction)
        if (orRes) return orRes
      }
      const fallback = deterministicOfflineAnswer(question, 'Empty candidate text returned.')
      return new Response(JSON.stringify(fallback), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    recordProviderOutcome('USABLE')
    const answer: AiAnswer = {
      answer: text,
      generated: true,
      model,
      facts_as_of: null,
      severity: 'INFO',
      source_mode: 'LIVE_DATA',
      actions: [],
      disclaimer: null,
    }
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    if (openRouterKey) {
      const orRes = await callOpenRouter(prompt, systemInstruction)
      if (orRes) return orRes
    }
    const isTimeout = err?.name === 'AbortError' || controller.signal.aborted
    deps.log?.(isTimeout ? 'gemini: timed out' : 'gemini: network error', err?.message ?? null)
    const fallback = deterministicOfflineAnswer(
      question,
      isTimeout ? 'Gemini request timed out. Showing offline assistant response.' : 'Network error reaching Gemini. Showing offline assistant response.',
    )
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } finally {
    clearTimeout(timer)
  }
}
