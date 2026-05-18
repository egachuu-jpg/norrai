# Client Onboarding SOP

_Run this checklist for every new client._

---

## Week 0 — Contract signed

- [ ] Contract signed, setup fee collected
- [ ] Add client to Neon `clients` table (tier, vertical, contact info)
- [ ] Add client email to Cloudflare Access → clients group
- [ ] Create Twilio subaccount, provision local number
- [ ] Create n8n workflow group for client
- [ ] Send welcome email with portal URL (norrai.co/clients/)

## Week 1 — Build & configure

- [ ] Import relevant workflow JSON files into n8n
- [ ] Wire Neon `client_id` and Twilio credentials into workflows
- [ ] Set up webhook URLs in client's source system (CRM, website form, etc.)
- [ ] Configure SendGrid sender for client (if custom domain)
- [ ] Test each workflow end-to-end with dummy data
- [ ] Create client note in [[clients/]] folder

## Week 2 — Handoff

- [ ] Walkthrough call: show client the portal tools
- [ ] Confirm first live workflow fired correctly
- [ ] Share monitoring dashboard access (if Growth/Pro)
- [ ] Set check-in cadence (monthly for Starter, weekly first month)

## Ongoing

- Monthly: pull workflow_events summary from Neon, check for failures
- Monthly: send client a one-paragraph health update
- Quarterly: review tier fit — upsell opportunity?

---

## Offboarding

- [ ] Export client data from Neon (leads, appointments, workflow_events)
- [ ] Deactivate n8n workflows
- [ ] Release Twilio number (or transfer to client)
- [ ] Remove from Cloudflare Access
- [ ] Final invoice
