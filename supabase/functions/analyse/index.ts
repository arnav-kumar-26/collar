import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─────────────────────────────────────────────────────────────────────────────
// Collar — analyse Edge Function
//
// Receives:  file_contents, file_path, branch, commit_sha, trigger
// Returns:   { violations: LLMViolation[], snapshot_id: string | null }
//
// Writes to Supabase only when trigger is 'commit', 'manual', or 'rule_update'.
// Debounced saves ('save') return the violations but write nothing.
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514'
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

interface AnalysisPayload {
  file_contents: string
  file_path: string
  branch: string
  commit_sha: string | null
  trigger: 'commit' | 'rule_update' | 'manual' | 'save'
}

interface LLMViolation {
  rule_id: string
  line_start: number
  line_end: number
  code_excerpt: string
  explanation: string
  severity: 'critical' | 'major' | 'minor'
}

serve(async (req: Request) => {
  // ── CORS ────────────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      }
    })
  }

  try {
    // ── Auth ───────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonError('Missing Authorization header', 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    // Verify the caller is an authenticated team member
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return jsonError('Unauthorised', 401)

    const { data: userRecord } = await supabase
      .from('users')
      .select('id')
      .eq('id', user.id)
      .single()

    if (!userRecord) return jsonError('Not a team member', 403)

    // ── Parse payload ──────────────────────────────────────────────────────
    const payload: AnalysisPayload = await req.json()
    const { file_contents, file_path, branch, commit_sha, trigger } = payload

    // ── Fetch active rules ─────────────────────────────────────────────────
    const { data: rules, error: rulesError } = await supabase
      .from('rules')
      .select('id, category, name, description, severity')
      .eq('status', 'active')

    if (rulesError || !rules) return jsonError('Failed to fetch rules', 500)

    // ── Build prompt ───────────────────────────────────────────────────────
    const prompt = buildPrompt(rules, file_path, file_contents)

    // ── Call Claude ────────────────────────────────────────────────────────
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return jsonError('LLM not configured', 500)

    const llmResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!llmResponse.ok) {
      const err = await llmResponse.text()
      return jsonError(`LLM call failed: ${err}`, 502)
    }

    const llmData = await llmResponse.json()
    const rawText: string = llmData.content[0]?.text ?? '{}'

    // ── Parse LLM response ─────────────────────────────────────────────────
    let violations: LLMViolation[] = []
    try {
      const parsed = JSON.parse(rawText)
      violations = parsed.violations ?? []
    } catch {
      console.error('[Collar] Failed to parse LLM response:', rawText)
      violations = []
    }

    // ── Write to Supabase (only on persistent triggers) ────────────────────
    let snapshotId: string | null = null

    if (trigger !== 'save' && violations !== undefined) {
      // Write commit record if this is a real commit
      let commitId: string | null = null

      if (trigger === 'commit' && commit_sha) {
        const { data: commitRecord } = await supabase
          .from('commits')
          .upsert({
            sha: commit_sha,
            branch,
            author_id: user.id,
            committed_at: new Date().toISOString(),
          }, { onConflict: 'sha' })
          .select('id')
          .single()

        commitId = commitRecord?.id ?? null
      }

      // Count violations by severity
      const counts = violations.reduce(
        (acc, v) => {
          acc[v.severity] = (acc[v.severity] ?? 0) + 1
          acc.total++
          return acc
        },
        { total: 0, critical: 0, major: 0, minor: 0 }
      )

      // Write snapshot
      const { data: snapshot } = await supabase
        .from('snapshots')
        .insert({
          commit_id: commitId,
          trigger,
          total: counts.total,
          critical: counts.critical,
          major: counts.major,
          minor: counts.minor,
        })
        .select('id')
        .single()

      snapshotId = snapshot?.id ?? null

      // Write violations
      if (snapshotId && violations.length > 0) {
        await supabase.from('violations').insert(
          violations.map(v => ({
            snapshot_id: snapshotId,
            rule_id: v.rule_id,
            file_path,
            line_start: v.line_start,
            line_end: v.line_end,
            code_excerpt: v.code_excerpt,
            explanation: v.explanation,
            status: 'active',
            authored_by: user.id,
            first_seen_sha: commit_sha,
          }))
        )
      }
    }

    // ── Respond ────────────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({ violations, snapshot_id: snapshotId }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      }
    )

  } catch (err) {
    console.error('[Collar] Edge Function error:', err)
    return jsonError('Internal server error', 500)
  }
})

// ─── Prompt Builder ───────────────────────────────────────────────────────────

function buildPrompt(rules: any[], filePath: string, fileContents: string): string {
  const rulesText = rules.map(r =>
    `[${r.id}] (${r.category}, ${r.severity})\n${r.name}: ${r.description}`
  ).join('\n\n')

  return `You are a code validation agent. Your job is to identify violations of the given rules in the provided code.

## Rules to enforce

${rulesText}

## File to validate

File path: ${filePath}

\`\`\`
${fileContents}
\`\`\`

## Instructions

Analyse the code carefully against each rule. For each violation found:
- Identify the exact line range
- Quote the violating code
- Explain clearly and concisely why it violates the rule
- Use the rule's own severity level

If no violations are found, return an empty violations array.

Respond with ONLY a valid JSON object. No preamble, no explanation, no markdown fences.

## Response format

{
  "violations": [
    {
      "rule_id": "BR-001",
      "line_start": 42,
      "line_end": 42,
      "code_excerpt": "processPayment(user, cart)",
      "explanation": "processPayment is called without first checking the consent flag. Line 38 sets consentFlag but it is never verified before this call.",
      "severity": "critical"
    }
  ]
}`
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    }
  )
}
