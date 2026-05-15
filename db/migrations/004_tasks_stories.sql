-- Adds stories + tasks tables for Mission Control

CREATE TABLE stories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  outcome     text,
  status      text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'done', 'cancelled')),
  priority    text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  client_id   uuid REFERENCES clients(id),
  tags        text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER stories_updated_at
  BEFORE UPDATE ON stories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_stories_status   ON stories(status);
CREATE INDEX idx_stories_priority ON stories(priority);


CREATE TABLE tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id    uuid REFERENCES stories(id) ON DELETE SET NULL,
  title       text NOT NULL,
  description text,
  context     text,
  output      text,
  category    text NOT NULL
    CHECK (category IN ('research', 'analysis', 'dev', 'testing', 'ops')),
  priority    text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status      text NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'ready', 'in_progress', 'agent_working', 'review', 'done')),
  assigned_to text,
  seq         int,
  client_id   uuid REFERENCES clients(id),
  tags        text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_tasks_story    ON tasks(story_id);
CREATE INDEX idx_tasks_status   ON tasks(status);
CREATE INDEX idx_tasks_category ON tasks(category);
