import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const connectionString =
  process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL이 설정되지 않았습니다."
  );
}

const adapter =
  new PrismaPg({
    connectionString,
  });

const globalForPrisma =
  globalThis as unknown as {
    prisma:
      | PrismaClient
      | undefined;
  };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (
  process.env.NODE_ENV !==
  "production"
) {
  globalForPrisma.prisma =
    prisma;
}