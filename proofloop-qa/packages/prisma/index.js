const prismaClientModule = require('@prisma/client');

const { PrismaClient } = prismaClientModule;
const globalForPrisma = globalThis;
const prisma = globalForPrisma.__proofloopPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__proofloopPrisma = prisma;

// Re-export everything from @prisma/client (Prisma namespace, enums like Role) plus the singleton.
module.exports = { ...prismaClientModule, prisma };
module.exports.default = prisma;
