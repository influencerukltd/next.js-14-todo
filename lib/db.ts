import { neon } from '@neondatabase/serverless';

// Database client using Neon serverless driver
const sql = neon(process.env.DATABASE_URL!);

// Type definitions based on Prisma schema
export type User = {
  id: string;
  username: string;
  password: string;
};

export type Task = {
  id: string;
  done: boolean;
  title: string;
  description: string | null;
  due: Date | null;
  createdAt: Date;
  authorId: string;
};

export type Repo = {
  id: number;
  owner: string;
  repoName: string;
  fullName: string;
  taskId: string;
};

export type Comment = {
  id: string;
  text: string;
  createdAt: Date;
  senderId: string;
  taskId: string;
};

// Helper to generate cuid-like IDs
function generateId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).substring(2, 9)}`;
}

// Database query helpers that mimic Prisma's API
export const db = {
  user: {
    findUnique: async ({ where }: { where: { username?: string; id?: string } }) => {
      let result;
      if (where.username) {
        result = await sql`SELECT * FROM users WHERE username = ${where.username} LIMIT 1`;
      } else if (where.id) {
        result = await sql`SELECT * FROM users WHERE id = ${where.id} LIMIT 1`;
      }
      return result?.[0] as User | undefined;
    },
    create: async ({ data }: { data: { username: string; password: string } }) => {
      const id = generateId();
      await sql`INSERT INTO users (id, username, password) VALUES (${id}, ${data.username}, ${data.password})`;
      return { id, ...data } as User;
    },
  },
  task: {
    findMany: async ({
      where,
      orderBy,
      include,
    }: {
      where: { authorId: string; OR?: Array<{ title?: { contains: string }; description?: { contains: string } }> };
      orderBy?: { createdAt: 'asc' | 'desc' };
      include?: { gh?: { select: { fullName: boolean } }; _count?: { select: { comments: boolean } } };
    }) => {
      const searchValue = where.OR?.[0]?.title?.contains || '';
      const order = orderBy?.createdAt === 'asc' ? sql`ASC` : sql`DESC`;
      
      const tasks = await sql`
        SELECT 
          t.*,
          g.full_name as "ghFullName",
          (SELECT COUNT(*) FROM comments c WHERE c."taskId" = t.id) as "commentCount"
        FROM tasks t
        LEFT JOIN gh_links g ON g."taskId" = t.id
        WHERE t."authorId" = ${where.authorId}
          AND (t.title ILIKE ${'%' + searchValue + '%'} OR t.description ILIKE ${'%' + searchValue + '%'})
        ORDER BY t."createdAt" DESC
      `;
      
      return tasks.map((task: any) => ({
        ...task,
        gh: task.ghFullName ? { fullName: task.ghFullName } : null,
        _count: { comments: parseInt(task.commentCount || '0', 10) },
      }));
    },
    findUnique: async ({
      where,
      include,
    }: {
      where: { id: string; author?: { username: string } };
      include?: {
        gh?: { select: { owner: boolean; repoName: boolean; fullName: boolean } };
        comments?: { select: { sender: { select: { username: boolean } }; id: boolean; text: boolean; createdAt: boolean } };
      };
    }) => {
      let task;
      if (where.author?.username) {
        const result = await sql`
          SELECT t.*, u.username as "authorUsername"
          FROM tasks t
          JOIN users u ON u.id = t."authorId"
          WHERE t.id = ${where.id} AND u.username = ${where.author.username}
          LIMIT 1
        `;
        task = result[0];
      } else {
        const result = await sql`SELECT * FROM tasks WHERE id = ${where.id} LIMIT 1`;
        task = result[0];
      }
      
      if (!task) return null;
      
      // Get related gh_link
      const ghResult = await sql`SELECT owner, repo_name as "repoName", full_name as "fullName" FROM gh_links WHERE "taskId" = ${task.id} LIMIT 1`;
      const gh = ghResult[0] || null;
      
      // Get comments with sender info
      const comments = await sql`
        SELECT c.id, c.text, c."createdAt", u.username
        FROM comments c
        JOIN users u ON u.id = c."senderId"
        WHERE c."taskId" = ${task.id}
        ORDER BY c."createdAt" ASC
      `;
      
      return {
        ...task,
        gh,
        comments: comments.map((c: any) => ({
          id: c.id,
          text: c.text,
          createdAt: c.createdAt,
          sender: { username: c.username },
        })),
      };
    },
    create: async ({
      data,
    }: {
      data: { title: string; description?: string | null; due?: string | null; authorId: string };
    }) => {
      const id = generateId();
      await sql`
        INSERT INTO tasks (id, title, description, due, "authorId", done, "createdAt")
        VALUES (${id}, ${data.title}, ${data.description || null}, ${data.due || null}, ${data.authorId}, false, NOW())
      `;
      return { id, ...data, done: false };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { title?: string; description?: string | null; due?: string | null; done?: boolean };
    }) => {
      if (data.done !== undefined) {
        await sql`UPDATE tasks SET done = ${data.done} WHERE id = ${where.id}`;
      } else {
        await sql`
          UPDATE tasks 
          SET title = COALESCE(${data.title}, title),
              description = ${data.description},
              due = ${data.due}
          WHERE id = ${where.id}
        `;
      }
      const result = await sql`SELECT * FROM tasks WHERE id = ${where.id} LIMIT 1`;
      return result[0] as Task;
    },
    delete: async ({ where, select }: { where: { id: string }; select?: { id: boolean } }) => {
      const result = await sql`DELETE FROM tasks WHERE id = ${where.id} RETURNING id`;
      return { id: result[0]?.id };
    },
  },
  comment: {
    create: async ({
      data,
    }: {
      data: { taskId: string; senderId: string; text: string };
    }) => {
      const id = generateId();
      await sql`
        INSERT INTO comments (id, "taskId", "senderId", text, "createdAt")
        VALUES (${id}, ${data.taskId}, ${data.senderId}, ${data.text}, NOW())
      `;
      return { id, ...data };
    },
  },
  repo: {
    upsert: async ({
      where,
      update,
      create,
    }: {
      where: { taskId: string };
      update: { repoName: string; owner: string; fullName: string };
      create: { taskId: string; repoName: string; owner: string; fullName: string };
    }) => {
      // Check if exists
      const existing = await sql`SELECT * FROM gh_links WHERE "taskId" = ${where.taskId} LIMIT 1`;
      
      if (existing[0]) {
        await sql`
          UPDATE gh_links 
          SET repo_name = ${update.repoName}, owner = ${update.owner}, full_name = ${update.fullName}
          WHERE "taskId" = ${where.taskId}
        `;
        return { ...existing[0], ...update };
      } else {
        await sql`
          INSERT INTO gh_links ("taskId", repo_name, owner, full_name)
          VALUES (${create.taskId}, ${create.repoName}, ${create.owner}, ${create.fullName})
        `;
        return create;
      }
    },
  },
};
