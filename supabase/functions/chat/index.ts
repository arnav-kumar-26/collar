import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'qwen/qwen3-coder:free',
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  },
}

interface ChatRule {
  id: string
  name: string
  severity: string
  description: string
}

interface ChatViolation {
  rule_id: string
  file_path: string
  line_start: number
  severity: string
  explanation: string
  code_excerpt: string
}

interface ChatPayload {
  message: string
  history: { role: 'user' | 'assistant'; content: string }[]
  context: {
    codebase_summary: string
    rules: ChatRule[]
    violations: ChatViolation[]
  }
  provider?: 'openrouter' | 'groq' | 'gemini'
}

serve(async (req: Request) => {
  console.log('[Collar Chat] Request received')

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      }
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('Missing Authorization header', 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return jsonError('Unauthorised', 401)

    const { data: userRecord } = await supabase
      .from('users').select('id').eq('id', user.id).single()
    if (!userRecord) return jsonError('Not a team member', 403)

    const payload: ChatPayload = await req.json()
    const { message, history, context, provider = 'groq' } = payload

    console.log(`[Collar Chat] Message: "${message.substring(0, 60)}..." (history: ${history.length} turns)`)

    const systemPrompt = buildSystemPrompt(context)
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message },
    ]

    let responseText: string
    try {
      responseText = await callLLM(provider, messages)
    } catch (err) {
      console.error('[Collar Chat] LLM call failed:', err.message)
      return jsonError(`LLM call failed: ${err.message}`, 502)
    }

    return new Response(
      JSON.stringify({ response: responseText }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )

  } catch (err) {
    console.error('[Collar Chat] Error:', err)
    return jsonError('Internal server error', 500)
  }
})

function buildSystemPrompt(context: ChatPayload['context']): string {
  const rulesList = context.rules.length > 0
    ? context.rules.map(r => `- ${r.id} (${r.severity}): ${r.name}\n  ${r.description}`).join('\n')
    : 'No rules configured.'

  const violationsList = context.violations.length > 0
    ? context.violations.map(v =>
        `- ${v.rule_id} (${v.severity}) in ${v.file_path}:${v.line_start}\n` +
        `  Explanation: ${v.explanation}\n` +
        `  Code: \`${v.code_excerpt.substring(0, 200)}\``
      ).join('\n\n')
    : 'No violations currently detected.'

  const summary = context.codebase_summary || 'No codebase summary available yet.'

  return `You are Collar, a code validation assistant. You help developers understand rule violations and how to fix them.

Be concise and specific. Reference rule IDs, file paths, and line numbers when relevant. When asked how to fix something, give concrete steps based on the actual code provided. You only explain and advise — you do not take actions.

CODEBASE SUMMARY:
${summary}

ACTIVE RULES:
${rulesList}

CURRENT VIOLATIONS:
${violationsList}`
}

async function callLLM(provider: string, messages: { role: string; content: string }[]): Promise<string> {
  switch (provider) {
    case 'openrouter': return callWithFallback(messages)
    case 'groq':       return callGroq(messages)
    case 'gemini':     return callGemini(messages)
    default:           throw new Error(`Unknown provider: "${provider}"`)
  }
}

async function callGroq(messages: { role: string; content: string }[]): Promise<string> {
  const apiKey = Deno.env.get('GROQ_API_KEY_CHAT')
  if (!apiKey) throw new Error('GROQ_API_KEY_CHAT not set')

  const res = await fetch(PROVIDERS.groq.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: PROVIDERS.groq.model,
      messages,
      temperature: 0.3,
    }),
  })

  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.choices[0]?.message?.content ?? 'No response.'
}

async function callWithFallback(messages: { role: string; content: string }[]): Promise<string> {
  const providers = [
    { name: 'Qwen3 Coder',   fn: () => callOpenRouter(messages, 'qwen/qwen3-coder:free') },
    { name: 'Llama 3.3 70B', fn: () => callOpenRouter(messages, 'meta-llama/llama-3.3-70b-instruct:free') },
    { name: 'Gemini',        fn: () => callGemini(messages) },
  ]

  for (const provider of providers) {
    try {
      console.log(`[Collar Chat] Trying ${provider.name}`)
      return await provider.fn()
    } catch (err) {
      console.warn(`[Collar Chat] ${provider.name} failed: ${err.message} — trying next`)
    }
  }

  throw new Error('All providers exhausted')
}

async function callOpenRouter(messages: { role: string; content: string }[], model: string): Promise<string> {
  const apiKey = Deno.env.get('OPENROUTER_KEY')
  if (!apiKey) throw new Error('OPENROUTER_KEY not set')

  const res = await fetch(PROVIDERS.openrouter.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
    }),
  })

  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.choices[0]?.message?.content ?? 'No response.'
}

async function callGemini(messages: { role: string; content: string }[]): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  const systemMessage = messages.find(m => m.role === 'system')
  const conversation = messages.filter(m => m.role !== 'system')

  const prompt = (systemMessage ? systemMessage.content + '\n\n' : '') +
    conversation.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')

  const res = await fetch(`${PROVIDERS.gemini.url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  })

  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response.'
}

function jsonError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    }
  )
}