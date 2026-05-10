import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROVIDERS = {
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
  }
}

interface FileInput {
  path: string
  contents: string
}

interface BatchPayload {
  files: FileInput[]
  branch: string
  commit_sha: string | null
  trigger: string
  provider?: 'gemini' | 'anthropic' | 'groq'
}

interface LLMViolation {
  rule_id: string
  file_path: string
  line_start: number
  line_end: number
  code_excerpt: string
  explanation: string
  severity: 'critical' | 'major' | 'minor'
}

serve(async (req: Request) => {
  console.log('[Collar Batch] Request received')
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
    console.log('[Collar Batch] Auth header found')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    console.log('[Collar Batch] Auth result:', !!user, authError?.message)
    if (authError || !user) return jsonError('Unauthorised', 401)

    const { data: userRecord } = await supabase
      .from('users').select('id').eq('id', user.id).single()
    console.log('[Collar Batch] User record:', !!userRecord)
    if (!userRecord) return jsonError('Not a team member', 403)

    const payload: BatchPayload = await req.json()
    console.log('[Collar Batch] Payload received, files:', payload.files?.length)
    const { files } = payload

    // Fetch active rules once for all files
    const { data: rules } = await supabase
      .from('rules')
      .select('id, category, name, description, severity')
      .eq('status', 'active')
      console.log('[Collar Batch] Rules fetched:', rules?.length)

    if (!rules) return jsonError('Failed to fetch rules', 500)

    // Build one prompt covering all files
    const prompt = buildBatchPrompt(rules, files)

    // Call Gemini once
    const activeProvider = payload.provider ?? 'gemini'
    let rawText: string
    try {
      rawText = await callLLM(activeProvider, prompt)
    } catch (err) {
      console.error('[Collar Batch] LLM call failed:', err.message)
      return jsonError(`LLM call failed: ${err.message}`, 502)
    }

    let violations: LLMViolation[] = []
    let summary: string = ''
    try {
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
        const parsed = JSON.parse(cleaned)
        violations = (parsed.violations ?? []).map((v: LLMViolation) => ({
          ...v,
          code_excerpt: v.code_excerpt.replace(/^\d+:\s*/, '')
        }))
        summary = parsed.summary ?? ''
    } catch {
        console.error('[Collar Batch] Failed to parse response:', rawText)
    }
    return new Response(
      JSON.stringify({ violations, summary }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )
    } catch (err) {
        console.error('[Collar Batch] Error:', err)
        return jsonError('Internal server error', 500)
  }
})

async function callLLM(provider: string, prompt: string): Promise<string> {
  switch (provider) {
    case 'gemini': return callGemini(prompt)
    case 'groq':   return callGroq(prompt)
    default:       throw new Error(`Unknown provider: "${provider}". Valid options: gemini, groq`)
  }
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY secret is not set in Supabase')

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
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
}

async function callGroq(prompt: string): Promise<string> {
  const apiKey = Deno.env.get('GROQ_API_KEY')
  if (!apiKey) throw new Error('GROQ_API_KEY secret is not set in Supabase')

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
  return data.choices[0]?.message?.content ?? '{}'
}

function buildBatchPrompt(rules: any[], files: FileInput[]): string {
  const rulesText = rules.map((r: any) =>
    `[${r.id}] (${r.category}, ${r.severity})\n${r.name}: ${r.description}`
  ).join('\n\n')

  const filesText = files.map(f => {
  const numberedContents = f.contents
    .split('\n')
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n')
    return `### File: ${f.path}\n\`\`\`\n${numberedContents}\n\`\`\``
      }).join('\n\n')

  return `You are a code validation agent analysing a codebase.

## Rules to enforce
${rulesText}

## Files to validate
${filesText}

## Instructions

1. Identify all violations across all files — point to the VIOLATING CODE ONLY, never comment lines above it
2. Line numbers start at 1 and must refer to the exact line where the violating code appears, not the comment describing it
3. Write a brief codebase summary (3-5 sentences) describing the project's purpose, architecture, and key patterns you observed

Respond with ONLY a valid JSON object. No preamble, no markdown fences.

## Response format

{
  "summary": "This is a VS Code extension called Collar that validates code against rules using an LLM backend. It uses a React sidebar, Supabase for persistence, and an event bus for feature isolation...",
  "violations": [
    {
      "rule_id": "SC-001",
      "file_path": "src/config.ts",
      "line_start": 3,
      "line_end": 3,
      "code_excerpt": "const API_KEY = 'sk-secret'",
      "explanation": "API key hardcoded as string literal.",
      "severity": "critical"
    }
  ]
}`
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