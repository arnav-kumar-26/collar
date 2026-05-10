import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROVIDERS = {
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
  },
    openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'anthropic/claude-3.5-sonnet',  // best for code fixing
  }
}

interface AutofixViolation {
  rule_id: string
  code_excerpt: string
  explanation: string
  severity: string
}

interface AutofixPayload {
  file_path: string
  file_contents: string
  violations: AutofixViolation[]
  provider?: 'gemini' | 'groq' | 'openrouter'
}

interface Fix {
  original: string
  replacement: string
}

serve(async (req: Request) => {
  console.log('[Collar Autofix] Request received')

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

    const payload: AutofixPayload = await req.json()
    const { file_path, file_contents, violations, provider = 'gemini' } = payload

    console.log(`[Collar Autofix] Fixing ${violations.length} violations in ${file_path}`)

    const prompt = buildAutofixPrompt(file_path, file_contents, violations)

    let rawText: string
    try {
      rawText = await callLLM(provider, prompt)
    } catch (err) {
      console.error('[Collar Autofix] LLM call failed:', err.message)
      return jsonError(`LLM call failed: ${err.message}`, 502)
    }

    let fixes: Fix[] = []
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/\n?```$/, '')
        .trim()
      fixes = JSON.parse(cleaned)
    } catch {
      console.error('[Collar Autofix] Failed to parse LLM response:', rawText)
      fixes = []
    }

    return new Response(
      JSON.stringify({ fixes }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )

  } catch (err) {
    console.error('[Collar Autofix] Error:', err)
    return jsonError('Internal server error', 500)
  }
})

function buildAutofixPrompt(
  filePath: string,
  fileContents: string,
  violations: AutofixViolation[]
): string {
  const violationList = violations.map(v =>
    `[${v.rule_id}] (${v.severity})\n${v.explanation}\nViolating code: ${v.code_excerpt}`
  ).join('\n\n')

  return `You are a code fix agent. Fix the violations listed below in the given file.

For each violation, identify the smallest self-contained code block that contains 
the violation and needs to change — this could be a single line, a full function, 
or a group of related lines. Return that block exactly as it appears in the file 
as "original", and the corrected version as "replacement".

Rules:
- "original" must be an exact substring of the file contents — copy it character for character
- "replacement" is the complete corrected version of that block
- Do not change any code outside the violating block
- If a violation is already fixed or not present, omit it from the response
- Return ONLY a valid JSON array. No explanation. No markdown fences.

Response format:
[
  {
    "original": "exact code block as it appears in the file",
    "replacement": "fixed version of that code block"
  }
]

Violations to fix:
${violationList}

File: ${filePath}
\`\`\`
${fileContents}
\`\`\``
}

async function callLLM(provider: string, prompt: string): Promise<string> {
  switch (provider) {
    case 'gemini':      return callGemini(prompt)
    case 'groq':        return callGroq(prompt)
    case 'openrouter':  return callOpenRouter(prompt)
    default:            throw new Error(`Unknown provider: "${provider}"`)
  }
}

async function callOpenRouter(prompt: string): Promise<string> {
  const apiKey = Deno.env.get('OPENROUTER_KEY')
  if (!apiKey) throw new Error('OPENROUTER_KEY not set')

  const res = await fetch(PROVIDERS.openrouter.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: PROVIDERS.openrouter.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    }),
  })

  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.choices[0]?.message?.content ?? '[]'
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  const res = await fetch(`${PROVIDERS.gemini.url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 },
    }),
  })

  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
}

async function callGroq(prompt: string): Promise<string> {
  const apiKey = Deno.env.get('GROQ_API_KEY')
  if (!apiKey) throw new Error('GROQ_API_KEY not set')

  const res = await fetch(PROVIDERS.groq.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: PROVIDERS.groq.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    }),
  })

  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  return data.choices[0]?.message?.content ?? '[]'
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