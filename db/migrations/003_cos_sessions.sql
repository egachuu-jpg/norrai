-- COS conversation sessions
-- Keyed by user_id (Slack user ID or E.164 phone) + channel (slack | sms)
-- Messages stored as jsonb array in Claude API format

CREATE TABLE cos_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL,
  channel    text NOT NULL CHECK (channel IN ('slack', 'sms')),
  messages   jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel)
);

CREATE TRIGGER cos_sessions_updated_at
  BEFORE UPDATE ON cos_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
