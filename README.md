# Collar

LLM-powered code validation agent for VS Code. Validates code against business, architectural, security, and test rules in real time using Claude as the analysis engine.

## Prerequisites

- Node.js 18+
- A Supabase project (see setup below)
- VS Code

## Getting Started

```bash
git clone <repo-url>
cd collar
npm install
npm run build
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Supabase Setup (first time only)

1. Create a new Supabase project at supabase.com
2. In the SQL editor, run the contents of `supabase/schema.sql`
3. Deploy the Edge Function:
   ```bash
   npx supabase functions deploy analyse
   ```
4. Add your Anthropic API key to Supabase Secrets:
   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```
5. In the Supabase dashboard, insert a row into the `invitations` table for each developer's GitHub email before they sign in

## Inviting a Developer

Insert a row directly into the `invitations` table in the Supabase dashboard:

| field | value |
|---|---|
| email | their GitHub email |
| role | `developer` (or `admin` / `author`) |
| status | `pending` |

They cannot sign in until this row exists.

## Project Structure

```
src/
├── types/          Shared TypeScript types
├── core/           Event bus, file watcher, git tracker, Supabase client
├── services/       Abstraction layer — db.ts, auth.ts, realtime.ts
│   └── interfaces/ IDatabase, IAuth, IRealtime
├── features/       Self-contained features, communicate via event bus only
│   ├── violation-detection/
│   ├── notifications/
│   └── git-integration/
├── sidebar/        React sidebar — App shell + 4 tabs
│   └── tabs/       Chat, Violations, Rules, History
└── extension.ts    Entry point — wires everything together

supabase/
├── schema.sql                    All tables, RLS policies, invitation trigger, seed rules
└── functions/analyse/index.ts    Edge Function — calls Claude, writes violations
```

## Development

```bash
npm run watch    # rebuild on every file change
```

## Architecture Rules

- Features must never import from `@supabase/supabase-js` directly
- Features must never import from other feature folders directly
- All cross-feature communication goes through `eventBus`
- Only `core/supabase.ts` instantiates the Supabase client
- Only `services/` files import from `core/supabase.ts`

Violating these rules breaks the migration path to AWS.
