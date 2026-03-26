-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
);

-- Create tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    done BOOLEAN DEFAULT false NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    due TIMESTAMP,
    "createdAt" TIMESTAMP DEFAULT now() NOT NULL,
    "authorId" TEXT NOT NULL REFERENCES users(id)
);

-- Create index on tasks.authorId
CREATE INDEX IF NOT EXISTS tasks_author_id_idx ON tasks("authorId");

-- Create gh_links table
CREATE TABLE IF NOT EXISTS gh_links (
    id SERIAL PRIMARY KEY,
    owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    "taskId" TEXT UNIQUE NOT NULL REFERENCES tasks(id) ON DELETE CASCADE
);

-- Create comments table
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    text TEXT NOT NULL,
    "createdAt" TIMESTAMP DEFAULT now() NOT NULL,
    "senderId" TEXT NOT NULL REFERENCES users(id),
    "taskId" TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE
);

-- Create indexes on comments
CREATE INDEX IF NOT EXISTS comments_task_id_idx ON comments("taskId");
CREATE INDEX IF NOT EXISTS comments_sender_id_idx ON comments("senderId");
