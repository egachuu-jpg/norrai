#!/usr/bin/env node
/**
 * Generates n8n workflow JSON files for the Email Triage Assistant.
 * Run: node scripts/generate_email_triage_workflows.js
 * Then import the resulting files from n8n/workflows/ into n8n Cloud.
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'n8n', 'workflows');

// ─── Shared constants ──────────────────────────────────────────────────────

const NEON_CRED    = { id: 'NEON_CREDENTIAL_ID', name: 'Neon Postgres' };
const ANTHROPIC    = { id: 'gXqu8TiqvDY4mUPZ',  name: 'Anthropic account 2' };
const TELEGRAM_CRED = { id: 'TELEGRAM_CREDENTIAL_ID', name: 'Telegram — Norr AI Email Bot' };
const TELEGRAM_CHAT_ID = '8792529492';
const NORRAI_INTERNAL  = 'e2f9934c-4d28-4bb4-ac90-4284c1123517';

const CLASSIFIER_PROMPT = `You are an email triage classifier. Classify the email below into exactly one category.

INBOX: {{ $json.inbox }}
FROM: {{ $json.sender }}
SUBJECT: {{ $json.subject }}
SNIPPET: {{ $json.snippet }}

CATEGORIES:
- newsletter: Marketing emails, digests, Substack, promotional content, sale announcements
- automated_notification: System-generated alerts (GitHub, Notion, Slack, receipts, shipping confirmations, bank alerts, app notifications)
- cold_outreach: Unsolicited sales or partnership emails from people you do not know
- norrai_business: Client inquiries, leads, vendor emails, or business proposals for Norr AI — use this for any email to hello@norrai.co that could be from a real person with business intent
- personal: Emails from real people you know (friends, family, colleagues) or that need a personal reply
- uncertain: Does not clearly fit any category above

RULES:
- If inbox is hello@norrai.co and the email could be a lead or client, classify as norrai_business (not newsletter or cold_outreach)
- Prefer uncertain over a wrong confident guess
- Return ONLY valid JSON, no extra text

{"category":"<category>","confidence":<0.0-1.0>,"proposed_action":"<mark_read_archive|mark_read|trash|mark_important|queue_for_review>","reason":"<one sentence>"}`;

// ─── Helper: uuid-ish IDs ──────────────────────────────────────────────────
let _seq = 1;
const uid = (prefix) => `${prefix}-${String(_seq++).padStart(4, '0')}-4000-8000-000000000000`;

// ─── Inbox sub-workflow factory ────────────────────────────────────────────

function makeInboxWorkflow(inboxEmail, gmailCredName, workflowName) {
  const gmailCred = { id: 'GMAIL_CREDENTIAL_ID', name: gmailCredName };

  const nodes = [
    // 1. Trigger
    {
      id: uid('et'),
      name: 'When Called By Another Workflow',
      type: 'n8n-nodes-base.executeWorkflowTrigger',
      typeVersion: 1.1,
      position: [240, 300],
      parameters: {}
    },

    // 2. Log Run Start
    {
      id: uid('et'),
      name: 'Log Run Start',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5,
      position: [440, 300],
      continueOnFail: true,
      parameters: {
        operation: 'executeQuery',
        query: `INSERT INTO email_triage_runs (run_id, inbox, started_at) VALUES ('{{ $execution.id }}', '${inboxEmail}', NOW())`,
        options: {}
      },
      credentials: { postgres: NEON_CRED }
    },

    // 3. Get Unread Messages
    {
      id: uid('et'),
      name: 'Get Unread Messages',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [640, 300],
      parameters: {
        resource: 'message',
        operation: 'getAll',
        returnAll: false,
        limit: 50,
        filters: {
          labelIds: ['UNREAD'],
          receivedAfter: '={{ DateTime.now().minus({hours: 24}).toISO() }}'
        },
        options: { downloadAttachments: false }
      },
      credentials: { gmailOAuth2: gmailCred }
    },

    // 4. Loop Over Emails
    {
      id: uid('et'),
      name: 'Loop Over Emails',
      type: 'n8n-nodes-base.splitInBatches',
      typeVersion: 3,
      position: [840, 300],
      parameters: { batchSize: 1, options: {} }
    },

    // 5. Dedup Check
    {
      id: uid('et'),
      name: 'Dedup Check',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5,
      position: [1040, 300],
      continueOnFail: true,
      parameters: {
        operation: 'executeQuery',
        query: `SELECT id FROM email_triage_queue WHERE message_id = '{{ $json.id }}' AND inbox = '${inboxEmail}' LIMIT 1`,
        options: {}
      },
      credentials: { postgres: NEON_CRED }
    },

    // 6. Already Processed?
    {
      id: uid('et'),
      name: 'Already Processed?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1240, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{
            id: 'dedup-check-001',
            leftValue: '={{ $json.id }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty' }
          }],
          combinator: 'and'
        },
        options: {}
      }
    },

    // 7. Build Classifier Input
    {
      id: uid('et'),
      name: 'Build Classifier Input',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [1440, 480],
      parameters: {
        assignments: {
          assignments: [
            { id: 'f1', name: 'inbox',      value: inboxEmail,                                               type: 'string' },
            { id: 'f2', name: 'message_id', value: '={{ $json.id }}',                                       type: 'string' },
            { id: 'f3', name: 'sender',     value: '={{ $json.from }}',                                     type: 'string' },
            { id: 'f4', name: 'subject',    value: '={{ $json.subject }}',                                  type: 'string' },
            { id: 'f5', name: 'snippet',    value: '={{ ($json.snippet ?? \'\').slice(0, 200) }}',           type: 'string' }
          ]
        },
        options: {}
      }
    },

    // 8. Build Prompt
    {
      id: uid('et'),
      name: 'Build Prompt',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [1640, 480],
      parameters: {
        assignments: {
          assignments: [
            { id: 'p1', name: 'prompt', value: `=${CLASSIFIER_PROMPT}`, type: 'string' },
            { id: 'p2', name: 'inbox',      value: '={{ $json.inbox }}',      type: 'string' },
            { id: 'p3', name: 'message_id', value: '={{ $json.message_id }}', type: 'string' },
            { id: 'p4', name: 'sender',     value: '={{ $json.sender }}',     type: 'string' },
            { id: 'p5', name: 'subject',    value: '={{ $json.subject }}',    type: 'string' },
            { id: 'p6', name: 'snippet',    value: '={{ $json.snippet }}',    type: 'string' }
          ]
        },
        options: {}
      }
    },

    // 9. Claude Classify
    {
      id: uid('et'),
      name: 'Claude Classify',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.4,
      position: [1840, 480],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 3000,
      parameters: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'anthropicApi',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'anthropic-version', value: '2023-06-01' },
            { name: 'content-type',      value: 'application/json' }
          ]
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={\n  "model": "claude-haiku-4-5-20251001",\n  "max_tokens": 256,\n  "messages": [{ "role": "user", "content": {{ JSON.stringify($json.prompt) }} }]\n}',
        options: {}
      },
      credentials: { anthropicApi: ANTHROPIC }
    },

    // 10. Parse + Gate
    {
      id: uid('et'),
      name: 'Parse + Gate',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2040, 480],
      parameters: {
        jsCode: `const raw = $input.first().json.content[0].text.trim();
let c;
try { c = JSON.parse(raw); }
catch (e) { c = { category: 'uncertain', confidence: 0, proposed_action: 'queue_for_review', reason: 'parse error' }; }
if ((c.confidence ?? 0) < 0.80) {
  c.category = 'uncertain';
  c.proposed_action = 'queue_for_review';
}
const prev = {
  inbox:      '{{ $('Build Classifier Input').item.json.inbox }}',
  message_id: '{{ $('Build Classifier Input').item.json.message_id }}',
  sender:     '{{ $('Build Classifier Input').item.json.sender }}',
  subject:    '{{ $('Build Classifier Input').item.json.subject }}',
  snippet:    '{{ $('Build Classifier Input').item.json.snippet }}'
};
return [{ json: { ...prev, ...c } }];`
      }
    },

    // 11. Route by Category
    {
      id: uid('et'),
      name: 'Route by Category',
      type: 'n8n-nodes-base.switch',
      typeVersion: 3.2,
      position: [2240, 480],
      parameters: {
        mode: 'rules',
        rules: {
          values: ['newsletter', 'automated_notification', 'cold_outreach', 'norrai_business', 'personal'].map((cat, i) => ({
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
              conditions: [{ id: `cat-${i}`, leftValue: '={{ $json.category }}', rightValue: cat, operator: { type: 'string', operation: 'equals' } }],
              combinator: 'and'
            }
          }))
        },
        fallbackOutput: 'extra',
        options: {}
      }
    },

    // 12a. Gmail: Mark Read + Archive (newsletter)
    {
      id: uid('et'),
      name: 'Mark Read (newsletter)',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [2440, 200],
      parameters: { resource: 'message', operation: 'markAsRead', messageId: '={{ $json.message_id }}' },
      credentials: { gmailOAuth2: gmailCred }
    },
    {
      id: uid('et'),
      name: 'Archive (newsletter)',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [2640, 200],
      parameters: {
        resource: 'message',
        operation: 'removeLabels',
        messageId: '={{ $json.message_id }}',
        labelIds: ['INBOX']
      },
      credentials: { gmailOAuth2: gmailCred }
    },

    // 12b. Gmail: Mark Read only (automated_notification)
    {
      id: uid('et'),
      name: 'Mark Read (notification)',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [2440, 380],
      parameters: { resource: 'message', operation: 'markAsRead', messageId: '={{ $json.message_id }}' },
      credentials: { gmailOAuth2: gmailCred }
    },

    // 12c. Gmail: Trash (cold_outreach)
    {
      id: uid('et'),
      name: 'Trash (cold outreach)',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [2440, 560],
      parameters: { resource: 'message', operation: 'delete', messageId: '={{ $json.message_id }}' },
      credentials: { gmailOAuth2: gmailCred }
    },

    // 12d. Gmail: Mark Important (norrai_business)
    {
      id: uid('et'),
      name: 'Mark Important (business)',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [2440, 740],
      parameters: {
        resource: 'message',
        operation: 'addLabels',
        messageId: '={{ $json.message_id }}',
        labelIds: ['IMPORTANT']
      },
      credentials: { gmailOAuth2: gmailCred }
    },

    // 12e. Gmail: Mark Important (personal)
    {
      id: uid('et'),
      name: 'Mark Important (personal)',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [2440, 920],
      parameters: {
        resource: 'message',
        operation: 'addLabels',
        messageId: '={{ $json.message_id }}',
        labelIds: ['IMPORTANT']
      },
      credentials: { gmailOAuth2: gmailCred }
    },

    // 13. Merge all category outputs
    {
      id: uid('et'),
      name: 'Merge Actions',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3,
      position: [2840, 560],
      parameters: { mode: 'append', options: {} }
    },

    // 14. Log to Queue
    {
      id: uid('et'),
      name: 'Log to Queue',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5,
      position: [3040, 560],
      continueOnFail: true,
      parameters: {
        operation: 'executeQuery',
        query: `INSERT INTO email_triage_queue (message_id, inbox, sender, subject, snippet, category, proposed_action, status)
VALUES (
  '{{ $json.message_id }}',
  '${inboxEmail}',
  '{{ $json.sender }}',
  '{{ $json.subject }}',
  '{{ $json.snippet }}',
  '{{ $json.category }}',
  '{{ $json.proposed_action }}',
  '{{ $json.category === "uncertain" ? "pending" : "auto_actioned" }}'
)
ON CONFLICT (message_id, inbox) DO NOTHING`,
        options: {}
      },
      credentials: { postgres: NEON_CRED }
    },

    // 15. Log Run Complete (done branch of loop)
    {
      id: uid('et'),
      name: 'Log Run Complete',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5,
      position: [1040, 560],
      continueOnFail: true,
      parameters: {
        operation: 'executeQuery',
        query: `UPDATE email_triage_runs
SET
  completed_at      = NOW(),
  emails_processed  = (SELECT count(*) FROM email_triage_queue WHERE inbox = '${inboxEmail}' AND created_at > NOW() - INTERVAL '2 hours'),
  auto_actioned     = (SELECT count(*) FROM email_triage_queue WHERE inbox = '${inboxEmail}' AND status = 'auto_actioned' AND created_at > NOW() - INTERVAL '2 hours'),
  queued_for_review = (SELECT count(*) FROM email_triage_queue WHERE inbox = '${inboxEmail}' AND status = 'pending' AND created_at > NOW() - INTERVAL '2 hours')
WHERE run_id = '{{ $execution.id }}' AND inbox = '${inboxEmail}'`,
        options: {}
      },
      credentials: { postgres: NEON_CRED }
    }
  ];

  // Node name map for connections
  const n = (name) => name;

  const connections = {
    [n('When Called By Another Workflow')]: { main: [[{ node: 'Log Run Start', type: 'main', index: 0 }]] },
    [n('Log Run Start')]:        { main: [[{ node: 'Get Unread Messages', type: 'main', index: 0 }]] },
    [n('Get Unread Messages')]:  { main: [[{ node: 'Loop Over Emails', type: 'main', index: 0 }]] },
    // Loop output 0 = next batch, output 1 = done
    [n('Loop Over Emails')]:     { main: [
      [{ node: 'Log Run Complete', type: 'main', index: 0 }],  // output 0 = done
      [{ node: 'Dedup Check',      type: 'main', index: 0 }]   // output 1 = loop (each item)
    ]},
    [n('Dedup Check')]:          { main: [[{ node: 'Already Processed?', type: 'main', index: 0 }]] },
    // IF: true (already processed) → back to loop; false → classify
    [n('Already Processed?')]:   { main: [
      [{ node: 'Loop Over Emails', type: 'main', index: 0 }],
      [{ node: 'Build Classifier Input', type: 'main', index: 0 }]
    ]},
    [n('Build Classifier Input')]: { main: [[{ node: 'Build Prompt', type: 'main', index: 0 }]] },
    [n('Build Prompt')]:           { main: [[{ node: 'Claude Classify', type: 'main', index: 0 }]] },
    [n('Claude Classify')]:        { main: [[{ node: 'Parse + Gate', type: 'main', index: 0 }]] },
    [n('Parse + Gate')]:           { main: [[{ node: 'Route by Category', type: 'main', index: 0 }]] },
    // Switch outputs: 0=newsletter, 1=automated_notification, 2=cold_outreach, 3=norrai_business, 4=personal, extra=uncertain
    [n('Route by Category')]:      { main: [
      [{ node: 'Mark Read (newsletter)',   type: 'main', index: 0 }],
      [{ node: 'Mark Read (notification)', type: 'main', index: 0 }],
      [{ node: 'Trash (cold outreach)',    type: 'main', index: 0 }],
      [{ node: 'Mark Important (business)',type: 'main', index: 0 }],
      [{ node: 'Mark Important (personal)',type: 'main', index: 0 }],
      [{ node: 'Merge Actions',            type: 'main', index: 0 }]  // uncertain → direct to merge
    ]},
    [n('Mark Read (newsletter)')]:    { main: [[{ node: 'Archive (newsletter)', type: 'main', index: 0 }]] },
    [n('Archive (newsletter)')]:      { main: [[{ node: 'Merge Actions', type: 'main', index: 0 }]] },
    [n('Mark Read (notification)')]:  { main: [[{ node: 'Merge Actions', type: 'main', index: 1 }]] },
    [n('Trash (cold outreach)')]:     { main: [[{ node: 'Merge Actions', type: 'main', index: 2 }]] },
    [n('Mark Important (business)')]: { main: [[{ node: 'Merge Actions', type: 'main', index: 3 }]] },
    [n('Mark Important (personal)')]: { main: [[{ node: 'Merge Actions', type: 'main', index: 4 }]] },
    [n('Merge Actions')]:             { main: [[{ node: 'Log to Queue', type: 'main', index: 0 }]] },
    [n('Log to Queue')]:              { main: [[{ node: 'Loop Over Emails', type: 'main', index: 0 }]] }
  };

  return {
    name: workflowName,
    nodes,
    connections,
    settings: { executionOrder: 'v1' },
    staticData: null
  };
}

// ─── Sweep workflow ────────────────────────────────────────────────────────

function makeSweepWorkflow() {
  const nodes = [
    {
      id: uid('sw'),
      name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [240, 300],
      parameters: {
        rule: {
          interval: [{ field: 'cronExpression', expression: '0 2 * * *' }]
        }
      }
    },
    {
      id: uid('sw'),
      name: 'Lookup Client',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5,
      position: [440, 300],
      continueOnFail: true,
      parameters: {
        operation: 'executeQuery',
        query: `SELECT id FROM clients WHERE id = '${NORRAI_INTERNAL}'`,
        options: {}
      },
      credentials: { postgres: NEON_CRED }
    },
    {
      id: uid('sw'),
      name: 'Log Triggered',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5,
      position: [640, 300],
      continueOnFail: true,
      parameters: {
        operation: 'executeQuery',
        query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
VALUES ('${NORRAI_INTERNAL}', 'email_triage_sweep', 'triggered', '{"execution_id": "{{ $execution.id }}"}'::jsonb)`,
        options: {}
      },
      credentials: { postgres: NEON_CRED }
    },
    {
      id: uid('sw'),
      name: 'Process egachuu',
      type: 'n8n-nodes-base.executeWorkflow',
      typeVersion: 1.1,
      position: [840, 300],
      parameters: {
        workflowId: { mode: 'name', value: 'Email Triage — Inbox egachuu' },
        waitForSubWorkflow: true,
        workflowInputs: {
          mappingMode: 'defineBelow',
          value: {
            inbox: 'egachuu@gmail.com',
            label: 'personal'
          }
        }
      }
    },
    {
      id: uid('sw'),
      name: 'Process eganbonde',
      type: 'n8n-nodes-base.executeWorkflow',
      typeVersion: 1.1,
      position: [1040, 300],
      parameters: {
        workflowId: { mode: 'name', value: 'Email Triage — Inbox eganbonde' },
        waitForSubWorkflow: true,
        workflowInputs: {
          mappingMode: 'defineBelow',
          value: {
            inbox: 'eganbonde@gmail.com',
            label: 'persona'
          }
        }
      }
    },
    {
      id: uid('sw'),
      name: 'Process hello',
      type: 'n8n-nodes-base.executeWorkflow',
      typeVersion: 1.1,
      position: [1240, 300],
      parameters: {
        workflowId: { mode: 'name', value: 'Email Triage — Inbox hello' },
        waitForSubWorkflow: true,
        workflowInputs: {
          mappingMode: 'defineBelow',
          value: {
            inbox: 'hello@norrai.co',
            label: 'business'
          }
        }
      }
    },
    {
      id: uid('sw'),
      name: 'Fetch Pending Queue',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5,
      position: [1440, 300],
      parameters: {
        operation: 'executeQuery',
        query: `SELECT id, inbox, sender, subject, snippet, proposed_action
FROM email_triage_queue
WHERE status = 'pending'
ORDER BY created_at ASC`,
        options: {}
      },
      credentials: { postgres: NEON_CRED }
    },
    {
      id: uid('sw'),
      name: 'Any Pending?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1640, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{
            id: 'pending-check',
            leftValue: '={{ $json.id }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty' }
          }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: uid('sw'),
      name: 'Build Telegram Digest',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1840, 200],
      parameters: {
        jsCode: `const items = $input.all();
const verb = { mark_read_archive: 'archive', mark_read: 'mark read', trash: 'trash', queue_for_review: 'review' };
let msg = \`📬 \${items.length} email\${items.length > 1 ? 's' : ''} need your review:\\n\\n\`;
items.forEach((item, i) => {
  const a = verb[item.json.proposed_action] ?? 'review';
  msg += \`\${i + 1}. \${item.json.sender} — "\${item.json.subject}" → \${a}?\\n\`;
});
msg += \`\\nReply with numbers to approve (e.g. "1 3") or "all"\\nSkip any by not including its number.\`;
return [{ json: { message: msg } }];`
      }
    },
    {
      id: uid('sw'),
      name: 'Send Telegram Digest',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [2040, 200],
      parameters: {
        resource: 'message',
        operation: 'sendMessage',
        chatId: TELEGRAM_CHAT_ID,
        text: '={{ $json.message }}',
        additionalFields: {}
      },
      credentials: { telegramApi: TELEGRAM_CRED }
    },
    {
      id: uid('sw'),
      name: 'Log Completed',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5,
      position: [2240, 300],
      continueOnFail: true,
      parameters: {
        operation: 'executeQuery',
        query: `INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
VALUES ('${NORRAI_INTERNAL}', 'email_triage_sweep', 'completed', '{"execution_id": "{{ $execution.id }}"}'::jsonb)`,
        options: {}
      },
      credentials: { postgres: NEON_CRED }
    }
  ];

  const connections = {
    'Schedule Trigger':    { main: [[{ node: 'Lookup Client',      type: 'main', index: 0 }]] },
    'Lookup Client':       { main: [[{ node: 'Log Triggered',       type: 'main', index: 0 }]] },
    'Log Triggered':       { main: [[{ node: 'Process egachuu',     type: 'main', index: 0 }]] },
    'Process egachuu':     { main: [[{ node: 'Process eganbonde',   type: 'main', index: 0 }]] },
    'Process eganbonde':   { main: [[{ node: 'Process hello',       type: 'main', index: 0 }]] },
    'Process hello':       { main: [[{ node: 'Fetch Pending Queue', type: 'main', index: 0 }]] },
    'Fetch Pending Queue': { main: [[{ node: 'Any Pending?',        type: 'main', index: 0 }]] },
    'Any Pending?':        { main: [
      [{ node: 'Build Telegram Digest', type: 'main', index: 0 }],
      [{ node: 'Log Completed',         type: 'main', index: 0 }]
    ]},
    'Build Telegram Digest': { main: [[{ node: 'Send Telegram Digest', type: 'main', index: 0 }]] },
    'Send Telegram Digest':  { main: [[{ node: 'Log Completed',        type: 'main', index: 0 }]] }
  };

  return {
    name: 'Email Triage Sweep',
    nodes,
    connections,
    settings: { executionOrder: 'v1', errorWorkflow: 'Norr AI Workflow Error Logger' },
    staticData: null
  };
}

// ─── Reply Handler workflow ────────────────────────────────────────────────

function makeReplyWorkflow() {
  const nodes = [
    {
      id: uid('rh'),
      name: 'Telegram Trigger',
      type: 'n8n-nodes-base.telegramTrigger',
      typeVersion: 1.1,
      position: [240, 300],
      parameters: { updates: ['message'], additionalFields: {} },
      credentials: { telegramApi: TELEGRAM_CRED },
      webhookId: 'email-triage-telegram-reply-001'
    },
    {
      id: uid('rh'),
      name: 'Is My Chat?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [440, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{
            id: 'chat-id-check',
            leftValue: '={{ $json.message.chat.id.toString() }}',
            rightValue: TELEGRAM_CHAT_ID,
            operator: { type: 'string', operation: 'equals' }
          }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: uid('rh'),
      name: 'Parse Reply',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [640, 200],
      parameters: {
        jsCode: `const text = ($input.first().json.message.text ?? '').trim().toLowerCase();
const approvedNumbers = text === 'all' ? 'all' : text.split(/\\s+/).map(Number).filter(n => !isNaN(n) && n > 0);
return [{ json: { approvedNumbers, rawText: text } }];`
      }
    },
    {
      id: uid('rh'),
      name: 'Fetch Pending',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5,
      position: [840, 200],
      parameters: {
        operation: 'executeQuery',
        query: `SELECT id, message_id, inbox, sender, subject, proposed_action
FROM email_triage_queue
WHERE status = 'pending'
ORDER BY created_at ASC`,
        options: {}
      },
      credentials: { postgres: NEON_CRED }
    },
    {
      id: uid('rh'),
      name: 'Build Action Plan',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1040, 200],
      parameters: {
        jsCode: `const pending = $input.all().map((item, i) => ({ ...item.json, position: i + 1 }));
const approved = $('Parse Reply').first().json.approvedNumbers;
const toAct  = approved === 'all' ? pending : pending.filter(p => approved.includes(p.position));
const toSkip = pending.filter(p => !toAct.find(a => a.id === p.id));

const verb = { mark_read_archive: 'archived', mark_read: 'marked read', trash: 'trashed', mark_important: 'marked important', queue_for_review: 'reviewed' };
const parts = [];
if (toAct.length)  parts.push(\`✓ Done — \${toAct.map(i => \`\${verb[i.proposed_action] ?? 'actioned'} \${i.position}\`).join(', ')}.\`);
if (toSkip.length) parts.push(\`Skipped \${toSkip.map(i => i.position).join(', ')}.\`);
const confirmMsg = parts.join(' ') || '✓ No actions taken.';

return [
  ...toAct.map(i  => ({ json: { ...i, skip: false } })),
  ...toSkip.map(i => ({ json: { ...i, skip: true  } })),
  { json: { __is_summary: true, __confirm_msg: confirmMsg } }
];`
      }
    },
    {
      id: uid('rh'),
      name: 'Loop Over Actions',
      type: 'n8n-nodes-base.splitInBatches',
      typeVersion: 3,
      position: [1240, 200],
      parameters: { batchSize: 1, options: {} }
    },
    {
      id: uid('rh'),
      name: 'Is Summary?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1440, 200],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{
            id: 'is-summary',
            leftValue: '={{ $json.__is_summary }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' }
          }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: uid('rh'),
      name: 'Send Confirmation',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [1640, 80],
      parameters: {
        resource: 'message',
        operation: 'sendMessage',
        chatId: TELEGRAM_CHAT_ID,
        text: '={{ $json.__confirm_msg }}',
        additionalFields: {}
      },
      credentials: { telegramApi: TELEGRAM_CRED }
    },
    {
      id: uid('rh'),
      name: 'Skip or Act?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1640, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{
            id: 'skip-check',
            leftValue: '={{ $json.skip }}',
            rightValue: false,
            operator: { type: 'boolean', operation: 'equals' }
          }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: uid('rh'),
      name: 'Route by Action',
      type: 'n8n-nodes-base.switch',
      typeVersion: 3.2,
      position: [1840, 200],
      parameters: {
        mode: 'rules',
        rules: {
          values: ['mark_read_archive', 'mark_read', 'trash'].map((act, i) => ({
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
              conditions: [{ id: `act-${i}`, leftValue: '={{ $json.proposed_action }}', rightValue: act, operator: { type: 'string', operation: 'equals' } }],
              combinator: 'and'
            }
          }))
        },
        fallbackOutput: 'extra',
        options: {}
      }
    },
    // Gmail action nodes — inbox routing via a nested IF
    // For simplicity we include all 3 credential variants per action and use IF to pick the right one
    // Using a Code node to determine which Gmail operation to call is cleaner but requires custom nodes
    // These will need manual credential assignment in n8n after import
    {
      id: uid('rh'),
      name: 'Gmail Mark Read + Archive',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [2040, 80],
      parameters: { resource: 'message', operation: 'removeLabels', messageId: '={{ $json.message_id }}', labelIds: ['INBOX'] },
      credentials: { gmailOAuth2: { id: 'GMAIL_CREDENTIAL_ID', name: 'Gmail — egachuu' } }
    },
    {
      id: uid('rh'),
      name: 'Gmail Mark Read Only',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [2040, 260],
      parameters: { resource: 'message', operation: 'markAsRead', messageId: '={{ $json.message_id }}' },
      credentials: { gmailOAuth2: { id: 'GMAIL_CREDENTIAL_ID', name: 'Gmail — egachuu' } }
    },
    {
      id: uid('rh'),
      name: 'Gmail Trash',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [2040, 440],
      parameters: { resource: 'message', operation: 'delete', messageId: '={{ $json.message_id }}' },
      credentials: { gmailOAuth2: { id: 'GMAIL_CREDENTIAL_ID', name: 'Gmail — egachuu' } }
    },
    {
      id: uid('rh'),
      name: 'Gmail Mark Important',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [2040, 620],
      parameters: { resource: 'message', operation: 'addLabels', messageId: '={{ $json.message_id }}', labelIds: ['IMPORTANT'] },
      credentials: { gmailOAuth2: { id: 'GMAIL_CREDENTIAL_ID', name: 'Gmail — egachuu' } }
    },
    {
      id: uid('rh'),
      name: 'Update Queue Approved',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5,
      position: [2240, 300],
      continueOnFail: true,
      parameters: {
        operation: 'executeQuery',
        query: `UPDATE email_triage_queue SET status = 'approved', resolved_at = NOW() WHERE id = '{{ $json.id }}'`,
        options: {}
      },
      credentials: { postgres: NEON_CRED }
    },
    {
      id: uid('rh'),
      name: 'Update Queue Skipped',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.5,
      position: [1840, 420],
      continueOnFail: true,
      parameters: {
        operation: 'executeQuery',
        query: `UPDATE email_triage_queue SET status = 'skipped', resolved_at = NOW() WHERE id = '{{ $json.id }}'`,
        options: {}
      },
      credentials: { postgres: NEON_CRED }
    },
    {
      id: uid('rh'),
      name: 'No Op (not my chat)',
      type: 'n8n-nodes-base.noOp',
      typeVersion: 1,
      position: [640, 400],
      parameters: {}
    }
  ];

  const connections = {
    'Telegram Trigger':        { main: [[{ node: 'Is My Chat?',         type: 'main', index: 0 }]] },
    'Is My Chat?':             { main: [
      [{ node: 'Parse Reply',         type: 'main', index: 0 }],
      [{ node: 'No Op (not my chat)', type: 'main', index: 0 }]
    ]},
    'Parse Reply':             { main: [[{ node: 'Fetch Pending',       type: 'main', index: 0 }]] },
    'Fetch Pending':           { main: [[{ node: 'Build Action Plan',   type: 'main', index: 0 }]] },
    'Build Action Plan':       { main: [[{ node: 'Loop Over Actions',   type: 'main', index: 0 }]] },
    'Loop Over Actions':       { main: [[{ node: 'Is Summary?',         type: 'main', index: 0 }]] },
    'Is Summary?':             { main: [
      [{ node: 'Send Confirmation', type: 'main', index: 0 }],
      [{ node: 'Skip or Act?',      type: 'main', index: 0 }]
    ]},
    'Send Confirmation':       { main: [] },
    'Skip or Act?':            { main: [
      [{ node: 'Route by Action',    type: 'main', index: 0 }],
      [{ node: 'Update Queue Skipped', type: 'main', index: 0 }]
    ]},
    'Route by Action':         { main: [
      [{ node: 'Gmail Mark Read + Archive', type: 'main', index: 0 }],
      [{ node: 'Gmail Mark Read Only',      type: 'main', index: 0 }],
      [{ node: 'Gmail Trash',               type: 'main', index: 0 }],
      [{ node: 'Gmail Mark Important',      type: 'main', index: 0 }]
    ]},
    'Gmail Mark Read + Archive': { main: [[{ node: 'Update Queue Approved', type: 'main', index: 0 }]] },
    'Gmail Mark Read Only':      { main: [[{ node: 'Update Queue Approved', type: 'main', index: 0 }]] },
    'Gmail Trash':               { main: [[{ node: 'Update Queue Approved', type: 'main', index: 0 }]] },
    'Gmail Mark Important':      { main: [[{ node: 'Update Queue Approved', type: 'main', index: 0 }]] },
    'Update Queue Approved':     { main: [[{ node: 'Loop Over Actions',     type: 'main', index: 0 }]] },
    'Update Queue Skipped':      { main: [[{ node: 'Loop Over Actions',     type: 'main', index: 0 }]] }
  };

  return {
    name: 'Email Triage Reply Handler',
    nodes,
    connections,
    settings: {
      executionOrder: 'v1',
      errorWorkflow: 'Norr AI Workflow Error Logger'
    },
    staticData: null
  };
}

// ─── Generate all files ────────────────────────────────────────────────────

const inboxConfigs = [
  { email: 'egachuu@gmail.com',  cred: 'Gmail — egachuu',       name: 'Email Triage — Inbox egachuu'   },
  { email: 'eganbonde@gmail.com', cred: 'Gmail — eganbonde',    name: 'Email Triage — Inbox eganbonde' },
  { email: 'hello@norrai.co',    cred: 'Gmail — hello@norrai.co', name: 'Email Triage — Inbox hello'   }
];

inboxConfigs.forEach(cfg => {
  const wf = makeInboxWorkflow(cfg.email, cfg.cred, cfg.name);
  const file = path.join(OUT_DIR, `${cfg.name}.json`);
  fs.writeFileSync(file, JSON.stringify(wf, null, 2));
  console.log(`✓ ${cfg.name}.json`);
});

const sweep = makeSweepWorkflow();
fs.writeFileSync(path.join(OUT_DIR, 'Email Triage Sweep.json'), JSON.stringify(sweep, null, 2));
console.log('✓ Email Triage Sweep.json');

const reply = makeReplyWorkflow();
fs.writeFileSync(path.join(OUT_DIR, 'Email Triage Reply Handler.json'), JSON.stringify(reply, null, 2));
console.log('✓ Email Triage Reply Handler.json');

console.log('\nDone. Import all 5 files into n8n Cloud.');
console.log('After import, assign credentials where n8n prompts you:');
console.log('  - "Neon Postgres" → your Neon connection');
console.log('  - "Gmail — egachuu/eganbonde/hello@norrai.co" → the matching Gmail OAuth2 credential');
console.log('  - "Telegram — Norr AI Email Bot" → your Telegram API credential');
console.log('  - "Anthropic account 2" → should auto-link (already used in other workflows)');
console.log('\nFor the Reply Handler Gmail nodes: after import, set each to the correct inbox credential');
console.log('(the handler needs to act on messages from any inbox — see plan notes).');
