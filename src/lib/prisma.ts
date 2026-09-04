import { PrismaClient } from "@prisma/client";

/**
 * One Prisma client for the whole app.
 *
 * In development Next.js reloads modules on every edit. Creating a new client
 * each time opens a new pool of database connections each time, and Supabase's
 * free tier runs out of connections within a few minutes of editing. Stashing
 * the client on `globalThis` survives the reload.
 *
 * In production the module is only evaluated once, so the global isn't used.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
