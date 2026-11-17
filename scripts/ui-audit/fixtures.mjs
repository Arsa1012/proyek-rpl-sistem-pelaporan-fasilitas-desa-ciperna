import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const env = {};
for (const line of (await fs.readFile(path.join(ROOT, '.env'), 'utf8')).split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const [users, report, citizenReport, assignment, officerAssignment, announcement] = await Promise.all([
  prisma.user.findMany({
    where: { email: { in: ['admin@ciperna.id', 'citizen1@example.com', 'officer1@example.com'] } },
    select: { id: true, email: true, role: true, name: true, isActive: true, mustChangePassword: true },
  }),
  prisma.report.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, title: true, status: true, userId: true } }),
  prisma.report.findFirst({ where: { user: { email: 'citizen1@example.com' } }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, status: true } }),
  prisma.assignment.findFirst({ orderBy: { assignedAt: 'desc' }, select: { id: true, reportId: true, officer: { select: { email: true } } } }),
  prisma.assignment.findFirst({ where: { officer: { email: 'officer1@example.com' } }, orderBy: { assignedAt: 'desc' }, select: { id: true, reportId: true, completedAt: true, cancelledAt: true } }),
  prisma.villageAnnouncement.findFirst({ where: { publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' }, select: { id: true, slug: true, title: true } }),
]);

console.log(JSON.stringify({ users, report, citizenReport, assignment, officerAssignment, announcement }, null, 2));
await prisma.$disconnect();
